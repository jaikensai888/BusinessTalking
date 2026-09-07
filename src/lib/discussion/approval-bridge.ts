import { publish } from "./broadcast";

export type DiscussionApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";
export type UserApprovalOutcome = "allowed-once" | "rejected";

export interface ApprovalBridgeRequest {
  approvalId: string;
  discussionId: string;
  sessionId: string;
  toolName: string;
  callId?: string;
  reason?: string;
}

export interface PendingDiscussionApproval extends ApprovalBridgeRequest {
  status: "pending";
  requestedAt: number;
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

interface BridgeOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_REMEMBERED_DECISIONS = 10_000;

function keyOf(discussionId: string, approvalId: string): string {
  return `${discussionId}\u0000${approvalId}`;
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
    toolName: validateField(request.toolName, "toolName"),
  };
  if (request.callId !== undefined) safe.callId = validateField(request.callId, "callId");
  if (request.reason !== undefined) {
    if (typeof request.reason !== "string") throw new Error("reason 非法");
    safe.reason = request.reason.slice(0, 1000);
  }
  return safe;
}

/** In-memory, fail-closed approval rendezvous for the local DSH child. */
export class DiscussionApprovalBridge {
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingRecord>();
  private readonly decisions = new Map<string, { outcome: DiscussionApprovalOutcome; decidedAt: number }>();

  constructor(options: BridgeOptions = {}) {
    this.timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
      ? Math.min(options.timeoutMs as number, DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
  }

  wait(request: ApprovalBridgeRequest, signal?: AbortSignal): Promise<DiscussionApprovalOutcome> {
    const safe = validateRequest(request);
    const key = keyOf(safe.discussionId, safe.approvalId);
    const existing = this.pending.get(key);
    if (existing) return existing.promise;

    let resolve!: (outcome: DiscussionApprovalOutcome) => void;
    const promise = new Promise<DiscussionApprovalOutcome>((res) => { resolve = res; });
    const requestedAt = Date.now();
    const timer = setTimeout(() => this.finish(key, "unavailable"), this.timeoutMs);
    timer.unref?.();
    const record: PendingRecord = { request: safe, requestedAt, resolve, promise, timer, signal };
    if (signal) {
      const onAbort = () => this.finish(key, "cancelled");
      record.onAbort = onAbort;
      if (signal.aborted) {
        clearTimeout(timer);
        resolve("cancelled");
        this.remember(key, "cancelled");
        return promise;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    this.pending.set(key, record);
    publish(safe.discussionId, {
      type: "approval-request",
      approval: { ...safe, status: "pending", requestedAt },
    });
    return promise;
  }

  decide(
    discussionId: string,
    approvalId: string,
    outcome: UserApprovalOutcome,
  ): "accepted" | "already-decided" | "not-found" | "conflict" {
    const key = keyOf(discussionId, approvalId);
    const previous = this.decisions.get(key);
    if (previous) return previous.outcome === outcome ? "already-decided" : "conflict";
    const record = this.pending.get(key);
    if (!record) return "not-found";
    this.finish(key, outcome);
    return "accepted";
  }

  listPending(discussionId: string): PendingDiscussionApproval[] {
    const out: PendingDiscussionApproval[] = [];
    for (const record of this.pending.values()) {
      if (record.request.discussionId !== discussionId) continue;
      out.push({ ...record.request, status: "pending", requestedAt: record.requestedAt });
    }
    return out.sort((a, b) => a.requestedAt - b.requestedAt || a.approvalId.localeCompare(b.approvalId));
  }

  cancelDiscussion(discussionId: string, outcome: "cancelled" | "unavailable"): void {
    for (const [key, record] of this.pending) {
      if (record.request.discussionId === discussionId) this.finish(key, outcome);
    }
  }

  private finish(key: string, outcome: DiscussionApprovalOutcome): void {
    const record = this.pending.get(key);
    if (!record) {
      if (!this.decisions.has(key)) this.remember(key, outcome);
      return;
    }
    this.pending.delete(key);
    clearTimeout(record.timer);
    if (record.signal && record.onAbort) record.signal.removeEventListener("abort", record.onAbort);
    this.remember(key, outcome);
    record.resolve(outcome);
    publish(record.request.discussionId, {
      type: "approval-decision",
      approval: { approvalId: record.request.approvalId, outcome },
    });
  }

  private remember(key: string, outcome: DiscussionApprovalOutcome): void {
    this.decisions.set(key, { outcome, decidedAt: Date.now() });
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
