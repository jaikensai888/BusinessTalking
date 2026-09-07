import {
  DiscussionArchivedError,
  DshError,
  DshProtocolError,
  DshRuntimeProfileConflictError,
  DshSessionBusyError,
} from "@/lib/dsh/errors";
import type { DshNotification } from "@/lib/dsh/events";
import { getDiscussionApprovalBridge } from "@/lib/discussion/approval-bridge";
import { DshSessionProcess, type DshSessionProcessOptions } from "./session-process";
import type { RuntimeProfile, RuntimeRunResult } from "./types";

export interface DiscussionSessionRunInput {
  discussionId: string;
  participantId: string | null;
  sessionId: string;
  prompt: string;
  profile: RuntimeProfile;
  processOptions: DshSessionProcessOptions;
  onNotification: (notification: DshNotification) => Promise<void> | void;
}

export type SessionProcessLike = Pick<DshSessionProcess, "run" | "close">;
export type SessionProcessFactory = (options: DshSessionProcessOptions) => SessionProcessLike;
export type DiscussionSessionCloseReason = "archive" | "delete" | "shutdown";

interface DiscussionRecord {
  discussionId: string;
  profileHash: string;
  processOptions: DshSessionProcessOptions;
  process: SessionProcessLike;
  activeSessions: Set<string>;
  callbacks: Map<string, (notification: DshNotification) => Promise<void> | void>;
  fatalError: DshError | null;
  closeReason: DiscussionSessionCloseReason | null;
}

function protocolFailure(message: string): never {
  throw new DshProtocolError(message);
}

function validateInput(input: DiscussionSessionRunInput): void {
  if (!input.discussionId.trim()) protocolFailure("discussionId 不能为空");
  if (!input.sessionId.trim()) protocolFailure("DSH Session id 不能为空");
  if (!input.prompt.trim()) protocolFailure("DSH prompt 不能为空");
  if (!input.profile.profileHash.trim()) protocolFailure("Runtime profileHash 不能为空");
  if (typeof input.onNotification !== "function") protocolFailure("DSH notification callback 缺失");
}

/** Child environment is fixed at spawn time; detect bridge config drift before reuse. */
function sameBridgeOptions(left: DshSessionProcessOptions, right: DshSessionProcessOptions): boolean {
  return left.approvalUrl === right.approvalUrl
    && left.approvalToken === right.approvalToken
    && left.internalSearchUrl === right.internalSearchUrl
    && left.internalSearchToken === right.internalSearchToken;
}

/** Registry of one persistent DSH runner per Discussion. */
export class DiscussionSessionManager {
  private readonly records = new Map<string, DiscussionRecord>();

  constructor(
    private readonly createProcess: SessionProcessFactory = (options) => new DshSessionProcess(options),
  ) {}

  async run(input: DiscussionSessionRunInput): Promise<RuntimeRunResult> {
    validateInput(input);
    const record = await this.getOrCreateRecord(input);
    if (record.fatalError) {
      throw record.fatalError;
    }
    if (record.activeSessions.has(input.sessionId)) {
      throw new DshSessionBusyError(`DSH Session 正在运行：${input.sessionId}`);
    }

    record.activeSessions.add(input.sessionId);
    record.callbacks.set(input.sessionId, input.onNotification);
    try {
      let result: { sessionId: string; finalResponse: string };
      try {
        result = await record.process.run({ sessionId: input.sessionId, prompt: input.prompt });
      } catch (error) {
        // Closing a live runner as part of Discussion lifecycle termination is expected
        // lifecycle cancellation, not a protocol/runtime failure. Preserve a
        // stable error code so upper layers do not overwrite archived state.
        if (record.closeReason === "archive" || record.closeReason === "delete") {
          throw new DiscussionArchivedError();
        }
        throw error;
      }
      if (record.closeReason === "archive" || record.closeReason === "delete") {
        throw new DiscussionArchivedError();
      }
      if (result.sessionId !== input.sessionId) {
        throw new DshProtocolError(`DSH runner 返回 session 不匹配：${result.sessionId}`);
      }
      return {
        sessionId: result.sessionId,
        finalResponse: result.finalResponse,
        events: [],
        notifications: [],
      };
    } finally {
      record.callbacks.delete(input.sessionId);
      record.activeSessions.delete(input.sessionId);
    }
  }

  isBusy(discussionId: string, sessionId?: string): boolean {
    const record = this.records.get(discussionId);
    if (!record) return false;
    return sessionId ? record.activeSessions.has(sessionId) : record.activeSessions.size > 0;
  }

  async closeDiscussion(
    discussionId: string,
    options: { reason?: DiscussionSessionCloseReason } = {},
  ): Promise<void> {
    const record = this.records.get(discussionId);
    getDiscussionApprovalBridge().cancelDiscussion(discussionId, "unavailable");
    if (!record) return;
    record.closeReason = options.reason ?? "shutdown";
    this.records.delete(discussionId);
    record.callbacks.clear();
    record.activeSessions.clear();
    await record.process.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    const records = [...this.records.values()];
    this.records.clear();
    for (const record of records) {
      getDiscussionApprovalBridge().cancelDiscussion(record.discussionId, "unavailable");
    }
    await Promise.all(records.map(async (record) => {
      record.callbacks.clear();
      record.activeSessions.clear();
      await record.process.close().catch(() => undefined);
    }));
  }

  private async getOrCreateRecord(input: DiscussionSessionRunInput): Promise<DiscussionRecord> {
    let record = this.records.get(input.discussionId);
    if (record?.fatalError) {
      // A fatal process is terminal for this Discussion. Restarting here
      // would silently replay a prompt against a fresh runtime and hide the
      // original failure; only an explicit close/drain may clear the record.
      throw record.fatalError;
    }
    if (record && record.profileHash !== input.profile.profileHash) {
      if (record.activeSessions.size > 0) {
        throw new DshRuntimeProfileConflictError();
      }
      await this.closeDiscussion(input.discussionId);
      record = undefined;
    }
    if (record && !sameBridgeOptions(record.processOptions, input.processOptions)) {
      if (record.activeSessions.size > 0) {
        throw new DshSessionBusyError("DSH runner 配置已变化，当前回合结束后再重试");
      }
      await this.closeDiscussion(input.discussionId);
      record = undefined;
    }
    if (record) return record;

    const holder: { record?: DiscussionRecord } = {};
    const processOptions: DshSessionProcessOptions = {
      ...input.processOptions,
      onNotification: async (_requestId, notification) => {
        const sessionId = notification.params.sessionId;
        if (typeof sessionId !== "string") protocolFailure("DSH notification 缺少 sessionId");
        const record = holder.record;
        if (!record) protocolFailure("DSH notification 在 Session registry 建立前到达");
        const callback = record.callbacks.get(sessionId);
        if (!callback) protocolFailure(`DSH notification 没有活动 Session：${sessionId}`);
        await callback(notification);
      },
      onFatal: (error) => {
        const record = holder.record;
        if (record) record.fatalError = error;
        getDiscussionApprovalBridge().cancelDiscussion(input.discussionId, "unavailable");
      },
    };
    const process = this.createProcess(processOptions);
    const created: DiscussionRecord = {
      discussionId: input.discussionId,
      profileHash: input.profile.profileHash,
      processOptions: input.processOptions,
      process,
      activeSessions: new Set(),
      callbacks: new Map(),
      fatalError: null,
      closeReason: null,
    };
    holder.record = created;
    this.records.set(input.discussionId, created);
    return created;
  }
}
