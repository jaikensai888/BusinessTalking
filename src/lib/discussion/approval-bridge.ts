import { publish } from "./broadcast";
import {
  DISCUSSION_WEB_SEARCH_CAPABILITY,
  getDiscussionCapabilityGrant,
  saveDiscussionCapabilityGrant,
  type DiscussionCapabilityStatus,
} from "./capability-grant";

export type DiscussionApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";
export type UserApprovalOutcome = "allowed-once" | "allowed-discussion" | "rejected-discussion";
export type ApprovalScope = "discussion" | "session";

export interface ApprovalBridgeRequest {
  approvalId: string;
  discussionId: string;
  sessionId: string;
  sessionKind: "persona" | "moderator";
  toolName: string;
  callId?: string;
  reason?: string;
}

export interface PendingDiscussionApproval extends ApprovalBridgeRequest {
  status: "pending";
  scope: ApprovalScope;
  requestedAt: number;
}

export interface ApprovalPersistence {
  get: (discussionId: string, capability: string) => Promise<DiscussionCapabilityStatus | null>;
  save: (input: {
    discussionId: string;
    capability: string;
    status: DiscussionCapabilityStatus;
  }) => Promise<"created" | "already-decided" | "conflict">;
}

interface PendingRecord {
  request: ApprovalBridgeRequest;
  requestedAt: number;
  resolve: (outcome: DiscussionApprovalOutcome) => void;
  promise: Promise<DiscussionApprovalOutcome>;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface PendingGroup {
  key: string;
  scope: ApprovalScope;
  primaryApprovalId: string;
  records: Map<string, PendingRecord>;
}

interface RememberedDecision {
  outcome: DiscussionApprovalOutcome;
  userOutcome?: UserApprovalOutcome;
  decidedAt: number;
}

interface BridgeOptions {
  timeoutMs?: number;
  persistence?: ApprovalPersistence;
}

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_REMEMBERED_DECISIONS = 10_000;
const KEY_SEPARATOR = "\u0000";

function keyOf(discussionId: string, approvalId: string): string {
  return `${discussionId}${KEY_SEPARATOR}${approvalId}`;
}

function capabilityKeyOf(request: ApprovalBridgeRequest): string {
  return `${request.discussionId}${KEY_SEPARATOR}${request.toolName}`;
}

function groupKeyOf(request: ApprovalBridgeRequest): string {
  if (request.toolName === DISCUSSION_WEB_SEARCH_CAPABILITY) return capabilityKeyOf(request);
  return `${request.discussionId}${KEY_SEPARATOR}${request.sessionId}${KEY_SEPARATOR}${request.toolName}`;
}

function scopeOf(request: ApprovalBridgeRequest): ApprovalScope {
  return request.toolName === DISCUSSION_WEB_SEARCH_CAPABILITY ? "discussion" : "session";
}

function validateField(value: string, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw new Error(`${name} 非法`);
  }
  return value;
}

function validateRequest(request: ApprovalBridgeRequest): ApprovalBridgeRequest {
  const safe: ApprovalBridgeRequest = {
    approvalId: validateField(request.approvalId, "approvalId"),
    discussionId: validateField(request.discussionId, "discussionId"),
    sessionId: validateField(request.sessionId, "sessionId"),
    sessionKind: request.sessionKind,
    toolName: validateField(request.toolName, "toolName"),
  };
  if (safe.sessionKind !== "persona" && safe.sessionKind !== "moderator") {
    throw new Error("sessionKind 非法");
  }
  if (request.callId !== undefined) safe.callId = validateField(request.callId, "callId");
  if (request.reason !== undefined) {
    if (typeof request.reason !== "string") throw new Error("reason 非法");
    safe.reason = request.reason.slice(0, 1000);
  }
  return safe;
}

const defaultPersistence: ApprovalPersistence = {
  get: getDiscussionCapabilityGrant,
  save: ({ discussionId, capability, status }) => saveDiscussionCapabilityGrant({ discussionId, capability, status }),
};

/** In-memory pending rendezvous plus durable Discussion-scoped capability decisions. */
export class DiscussionApprovalBridge {
  private readonly timeoutMs: number;
  private readonly persistence: ApprovalPersistence;
  private readonly pendingGroups = new Map<string, PendingGroup>();
  private readonly pendingByApproval = new Map<string, PendingRecord>();
  private readonly decisionLoads = new Map<string, Promise<DiscussionCapabilityStatus | null>>();
  private readonly decisions = new Map<string, RememberedDecision>();

  constructor(options: BridgeOptions = {}) {
    this.timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
      ? Math.min(options.timeoutMs as number, DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
    this.persistence = options.persistence ?? defaultPersistence;
  }

  async wait(request: ApprovalBridgeRequest, signal?: AbortSignal): Promise<DiscussionApprovalOutcome> {
    const safe = validateRequest(request);
    if (safe.toolName === DISCUSSION_WEB_SEARCH_CAPABILITY && safe.sessionKind !== "persona") {
      return "rejected";
    }

    const remembered = this.decisions.get(keyOf(safe.discussionId, safe.approvalId));
    if (remembered) return remembered.outcome;

    const scope = scopeOf(safe);
    const groupKey = groupKeyOf(safe);
    if (scope === "discussion") {
      const decision = await this.loadDiscussionDecision(safe.discussionId);
      if (decision === "allowed") return "allowed-once";
      if (decision === "denied") return "rejected";
    }

    const existing = this.pendingGroups.get(groupKey);
    if (existing) return this.addPendingRecord(existing, safe, signal);
    return this.createPendingGroup(groupKey, scope, safe, signal);
  }

  async decide(
    discussionId: string,
    approvalId: string,
    outcome: UserApprovalOutcome,
  ): Promise<"accepted" | "already-decided" | "not-found" | "conflict"> {
    const key = keyOf(discussionId, approvalId);
    const previous = this.decisions.get(key);
    if (previous) return previous.userOutcome === outcome ? "already-decided" : "conflict";

    const record = this.pendingByApproval.get(key);
    if (!record) return "not-found";
    const group = this.pendingGroups.get(groupKeyOf(record.request));
    if (!group) return "not-found";

    if (outcome === "allowed-discussion" || outcome === "rejected-discussion") {
      if (record.request.toolName !== DISCUSSION_WEB_SEARCH_CAPABILITY || group.scope !== "discussion") {
        return "conflict";
      }
      const status = outcome === "allowed-discussion" ? "allowed" : "denied";
      const persisted = await this.persistence.save({
        discussionId,
        capability: DISCUSSION_WEB_SEARCH_CAPABILITY,
        status,
      });
      if (persisted === "conflict") return "conflict";
      this.finishGroup(group, status === "allowed" ? "allowed-once" : "rejected", outcome);
      return "accepted";
    }

    this.finishRecord(group, record.request.approvalId, "allowed-once", outcome);
    return "accepted";
  }

  listPending(discussionId: string): PendingDiscussionApproval[] {
    const out: PendingDiscussionApproval[] = [];
    for (const group of this.pendingGroups.values()) {
      const primary = group.records.get(group.primaryApprovalId);
      if (!primary || primary.request.discussionId !== discussionId) continue;
      out.push({
        ...primary.request,
        status: "pending",
        scope: group.scope,
        requestedAt: primary.requestedAt,
      });
    }
    return out.sort((a, b) => a.requestedAt - b.requestedAt || a.approvalId.localeCompare(b.approvalId));
  }

  cancelDiscussion(discussionId: string, outcome: "cancelled" | "unavailable"): void {
    for (const group of [...this.pendingGroups.values()]) {
      const primary = group.records.get(group.primaryApprovalId);
      if (primary?.request.discussionId === discussionId) this.finishGroup(group, outcome);
    }
    const prefix = `${discussionId}${KEY_SEPARATOR}`;
    for (const key of this.decisions.keys()) {
      if (key.startsWith(prefix)) this.decisions.delete(key);
    }
  }

  private async loadDiscussionDecision(discussionId: string): Promise<DiscussionCapabilityStatus | null> {
    const key = `${discussionId}${KEY_SEPARATOR}${DISCUSSION_WEB_SEARCH_CAPABILITY}`;
    const existing = this.decisionLoads.get(key);
    if (existing) return existing;
    const loading = this.persistence.get(discussionId, DISCUSSION_WEB_SEARCH_CAPABILITY);
    this.decisionLoads.set(key, loading);
    try {
      return await loading;
    } finally {
      if (this.decisionLoads.get(key) === loading) this.decisionLoads.delete(key);
    }
  }

  private createPendingGroup(
    groupKey: string,
    scope: ApprovalScope,
    request: ApprovalBridgeRequest,
    signal?: AbortSignal,
  ): Promise<DiscussionApprovalOutcome> {
    const group: PendingGroup = {
      key: groupKey,
      scope,
      primaryApprovalId: request.approvalId,
      records: new Map(),
    };
    this.pendingGroups.set(groupKey, group);
    const promise = this.addPendingRecord(group, request, signal);
    if (group.records.size === 0) this.pendingGroups.delete(groupKey);
    publish(request.discussionId, {
      type: "approval-request",
      approval: { ...request, scope, status: "pending", requestedAt: Date.now() },
    });
    return promise;
  }

  private addPendingRecord(
    group: PendingGroup,
    request: ApprovalBridgeRequest,
    signal?: AbortSignal,
  ): Promise<DiscussionApprovalOutcome> {
    const key = keyOf(request.discussionId, request.approvalId);
    const existing = this.pendingByApproval.get(key);
    if (existing) return existing.promise;

    let resolve!: (outcome: DiscussionApprovalOutcome) => void;
    const promise = new Promise<DiscussionApprovalOutcome>((res) => { resolve = res; });
    const requestedAt = Date.now();
    const timer = setTimeout(() => this.finishRecord(group, request.approvalId, "unavailable"), this.timeoutMs);
    timer.unref?.();
    const record: PendingRecord = { request, requestedAt, resolve, promise, timer, signal };
    if (signal) {
      const onAbort = () => this.finishRecord(group, request.approvalId, "cancelled");
      record.onAbort = onAbort;
      if (signal.aborted) {
        clearTimeout(timer);
        resolve("cancelled");
        this.remember(key, "cancelled");
        return promise;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    group.records.set(request.approvalId, record);
    this.pendingByApproval.set(key, record);
    return promise;
  }

  private finishGroup(
    group: PendingGroup,
    outcome: DiscussionApprovalOutcome,
    userOutcome?: UserApprovalOutcome,
  ): void {
    for (const approvalId of [...group.records.keys()]) {
      this.finishRecord(group, approvalId, outcome, userOutcome, false);
    }
    this.pendingGroups.delete(group.key);
  }

  private finishRecord(
    group: PendingGroup,
    approvalId: string,
    outcome: DiscussionApprovalOutcome,
    userOutcome?: UserApprovalOutcome,
    promote = true,
  ): void {
    const record = group.records.get(approvalId);
    if (!record) {
      const key = keyOf(group.key.split(KEY_SEPARATOR)[0] ?? "", approvalId);
      if (!this.decisions.has(key)) this.remember(key, outcome, userOutcome);
      return;
    }
    group.records.delete(approvalId);
    this.pendingByApproval.delete(keyOf(record.request.discussionId, approvalId));
    clearTimeout(record.timer);
    if (record.signal && record.onAbort) record.signal.removeEventListener("abort", record.onAbort);
    this.remember(keyOf(record.request.discussionId, approvalId), outcome, userOutcome);
    record.resolve(outcome);
    publish(record.request.discussionId, {
      type: "approval-decision",
      approval: { approvalId, outcome },
    });

    if (group.records.size === 0) {
      this.pendingGroups.delete(group.key);
      return;
    }
    if (promote && approvalId === group.primaryApprovalId) {
      const next = group.records.values().next().value as PendingRecord | undefined;
      if (next) {
        group.primaryApprovalId = next.request.approvalId;
        publish(next.request.discussionId, {
          type: "approval-request",
          approval: {
            ...next.request,
            scope: group.scope,
            status: "pending",
            requestedAt: next.requestedAt,
          },
        });
      }
    }
  }

  private remember(key: string, outcome: DiscussionApprovalOutcome, userOutcome?: UserApprovalOutcome): void {
    this.decisions.set(key, { outcome, userOutcome, decidedAt: Date.now() });
    if (this.decisions.size <= MAX_REMEMBERED_DECISIONS) return;
    const oldest = this.decisions.keys().next().value;
    if (oldest) this.decisions.delete(oldest);
  }
}

const bridgeGlobal = globalThis as typeof globalThis & {
  __businessTalkingDiscussionApprovalBridge?: DiscussionApprovalBridge;
};

export function getDiscussionApprovalBridge(): DiscussionApprovalBridge {
  if (!bridgeGlobal.__businessTalkingDiscussionApprovalBridge) {
    bridgeGlobal.__businessTalkingDiscussionApprovalBridge = new DiscussionApprovalBridge();
  }
  return bridgeGlobal.__businessTalkingDiscussionApprovalBridge;
}
