import type { DiscussionLiveEvent as LedgerDiscussionLiveEvent } from "@/lib/dsh/session-events";

export type DiscussionLiveEvent = LedgerDiscussionLiveEvent;

export interface DiscussionApprovalProjectionEvent {
  type: "approval-request" | "approval-decision";
  approvalId: string;
  discussionId: string;
  sessionId: string;
  scope?: "discussion" | "session";
  toolName: string;
  callId?: string;
  reason?: string;
  outcome?: string;
  requestedAt?: number;
}

export type DiscussionProjectionEvent = DiscussionLiveEvent | DiscussionApprovalProjectionEvent;

export interface DshToolView {
  callId: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "running" | "ok" | "error" | "stopped";
  startedAtMs: number | null;
  endedAtMs: number | null;
}

export interface DshStepView {
  id: string;
  status: "running" | "completed" | "failed";
  startedAtMs: number | null;
  endedAtMs: number | null;
}

export interface DshTurnView {
  key: string;
  sessionId: string;
  turnNumber?: number;
  status: "running" | "completed" | "failed";
  startedAtMs: number | null;
  endedAtMs: number | null;
  durationMs: number | null;
  reasoning: Array<{ id: string; text: string; streaming: boolean }>;
  tools: DshToolView[];
  steps: DshStepView[];
  liveAnswer: string;
  hasFinalMessage: boolean;
  collapsed: boolean;
  error?: string;
}

export interface PendingDiscussionApproval {
  approvalId: string;
  discussionId: string;
  sessionId: string;
  scope?: "discussion" | "session";
  toolName: string;
  callId?: string;
  reason?: string;
  status: "pending";
  requestedAt?: number;
}

export interface DshProcessState {
  cursor: number;
  turns: DshTurnView[];
  pendingApprovals: PendingDiscussionApproval[];
  needsResync: boolean;
  streamError?: string;
}

export function emptyProcessState(): DshProcessState {
  return { cursor: 0, turns: [], pendingApprovals: [], needsResync: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown, max = 12_000): string {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function finiteTime(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function contentBlocks(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = isRecord(data.message) ? data.message : data;
  return Array.isArray(message.content)
    ? message.content.filter(isRecord)
    : [];
}

function findTurnIndex(turns: DshTurnView[], event: DiscussionLiveEvent): number {
  if (event.eventType === "turn/start") {
    return -1;
  }
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].sessionId === event.sessionId && turns[i].status === "running") return i;
  }
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].sessionId === event.sessionId) return i;
  }
  return -1;
}

function newTurn(event: DiscussionLiveEvent): DshTurnView {
  return {
    key: `${event.sessionId}:${event.seq}`,
    sessionId: event.sessionId,
    status: "running",
    startedAtMs: event.eventType === "turn/start" ? finiteTime(event.eventTimeMs) : null,
    endedAtMs: null,
    durationMs: null,
    reasoning: [],
    tools: [],
    steps: [],
    liveAnswer: "",
    hasFinalMessage: false,
    collapsed: false,
  };
}

function turnForEvent(state: DshProcessState, event: DiscussionLiveEvent): { index: number; turn: DshTurnView; created: boolean } {
  const index = findTurnIndex(state.turns, event);
  if (index >= 0) return { index, turn: state.turns[index], created: false };
  return { index: state.turns.length, turn: newTurn(event), created: true };
}

function reasonKind(data: Record<string, unknown>): string {
  if (typeof data.status === "string") return data.status;
  if (typeof data.outcome === "string") return data.outcome;
  if (isRecord(data.reason) && typeof data.reason.kind === "string") return data.reason.kind;
  return "";
}

function errorText(data: Record<string, unknown>): string {
  if (typeof data.error === "string") return safeText(data.error, 2_000);
  if (isRecord(data.reason) && isRecord(data.reason.error)) {
    return safeText(data.reason.error.message ?? data.reason.error.code, 2_000);
  }
  return "DSH 回合未正常结束";
}

function isTurnProcessEvent(eventType: string): boolean {
  return eventType === "step/start"
    || eventType === "step/end"
    || eventType === "assistant/chunk"
    || eventType === "assistant/message"
    || eventType === "tool/call"
    || eventType === "tool/start"
    || eventType === "tool/result"
    || eventType === "tool/end"
    || eventType === "turn/end";
}

function withTurn(state: DshProcessState, event: DiscussionLiveEvent, mutate: (turn: DshTurnView) => void): DshProcessState {
  const selected = turnForEvent(state, event);
  const turn = {
    ...selected.turn,
    reasoning: selected.turn.reasoning.map((item) => ({ ...item })),
    tools: selected.turn.tools.map((item) => ({ ...item })),
    steps: selected.turn.steps.map((item) => ({ ...item })),
  };
  mutate(turn);
  const turns = [...state.turns];
  if (selected.created) turns.push(turn);
  else turns[selected.index] = turn;
  return { ...state, cursor: event.discussionSeq, turns };
}

function approvalFromDurableEvent(event: DiscussionLiveEvent): PendingDiscussionApproval | null {
  if (event.eventType !== "approval/asked") return null;
  const id = event.data.approvalId ?? event.data.id;
  if (typeof id !== "string" || !id) return null;
  const toolName = safeText(event.data.toolName, 300) || "unknown";
  const eventScope = event.data.scope === "discussion" || event.data.scope === "session"
    ? event.data.scope
    : toolName === "web_search" ? "discussion" : "session";
  return {
    approvalId: id,
    discussionId: event.discussionId,
    sessionId: event.sessionId,
    toolName,
    scope: eventScope,
    ...(typeof event.data.callId === "string" ? { callId: event.data.callId } : {}),
    ...(typeof event.data.reason === "string" ? { reason: safeText(event.data.reason, 2_000) } : {}),
    status: "pending",
  };
}

function reduceApproval(state: DshProcessState, event: DiscussionApprovalProjectionEvent): DshProcessState {
  if (event.type === "approval-request") {
    if (state.pendingApprovals.some((item) => item.approvalId === event.approvalId)) return state;
    const approval: PendingDiscussionApproval = {
      approvalId: event.approvalId,
      discussionId: event.discussionId,
      sessionId: event.sessionId,
      ...(event.scope ? { scope: event.scope } : {}),
      toolName: safeText(event.toolName, 300) || "unknown",
      ...(event.callId ? { callId: event.callId } : {}),
      ...(event.reason ? { reason: safeText(event.reason, 2_000) } : {}),
      status: "pending",
      ...(event.requestedAt === undefined ? {} : { requestedAt: event.requestedAt }),
    };
    return { ...state, pendingApprovals: [...state.pendingApprovals, approval] };
  }
  const pendingApprovals = state.pendingApprovals.filter((item) => item.approvalId !== event.approvalId);
  return pendingApprovals.length === state.pendingApprovals.length
    ? state
    : { ...state, pendingApprovals };
}

/** Reduce an ephemeral approval event or a durable projected DSH event. */
export function reduceDiscussionEvent(state: DshProcessState, event: DiscussionProjectionEvent): DshProcessState {
  if (event.type === "approval-request" || event.type === "approval-decision") {
    return reduceApproval(state, event);
  }
  return reduceDshEvent(state, event as DiscussionLiveEvent);
}

export function reduceDshEvent(state: DshProcessState, event: DiscussionLiveEvent): DshProcessState {
  if (state.needsResync) return state;
  if (!Number.isSafeInteger(event.discussionSeq) || event.discussionSeq <= state.cursor) return state;
  if (event.discussionSeq !== state.cursor + 1) {
    return { ...state, needsResync: true, streamError: `事件序列不连续：期待 ${state.cursor + 1}，收到 ${event.discussionSeq}` };
  }

  const durableApproval = approvalFromDurableEvent(event);
  if (durableApproval) {
    const pendingApprovals = state.pendingApprovals.some((item) => item.approvalId === durableApproval.approvalId)
      ? state.pendingApprovals
      : [...state.pendingApprovals, durableApproval];
    return { ...state, cursor: event.discussionSeq, pendingApprovals };
  }
  if (event.eventType === "approval/decided") {
    const id = event.data.approvalId ?? event.data.id;
    return {
      ...state,
      cursor: event.discussionSeq,
      pendingApprovals: typeof id === "string"
        ? state.pendingApprovals.filter((item) => item.approvalId !== id)
        : state.pendingApprovals,
    };
  }

  if (event.eventType === "turn/start") {
    const turn = newTurn(event);
    const turnNumber = event.data.turn;
    if (typeof turnNumber === "number" && Number.isSafeInteger(turnNumber)) {
      turn.turnNumber = turnNumber;
    }
    return { ...state, cursor: event.discussionSeq, turns: [...state.turns, turn] };
  }

  // Session coordination/history events (for example agent/inbox/spliced,
  // user/message, and request/*) advance the durable cursor but do not create
  // a visible process row. Otherwise the first inbox event creates an empty
  // running turn before the real turn/start arrives.
  if (!isTurnProcessEvent(event.eventType)) {
    return { ...state, cursor: event.discussionSeq };
  }

  return withTurn(state, event, (turn) => {
    const data = event.data;
    if (event.eventType === "step/start") {
      turn.steps.push({ id: `${event.sessionId}:${event.seq}`, status: "running", startedAtMs: finiteTime(event.eventTimeMs), endedAtMs: null });
      return;
    }
    if (event.eventType === "step/end") {
      const step = [...turn.steps].reverse().find((item) => item.status === "running");
      if (step) {
        step.status = reasonKind(data) === "error" ? "failed" : "completed";
        step.endedAtMs = finiteTime(event.eventTimeMs);
      } else {
        turn.steps.push({ id: `${event.sessionId}:${event.seq}`, status: reasonKind(data) === "error" ? "failed" : "completed", startedAtMs: null, endedAtMs: finiteTime(event.eventTimeMs) });
      }
      return;
    }
    if (event.eventType === "assistant/chunk" || event.eventType === "assistant/message") {
      let answer = "";
      for (const [index, block] of contentBlocks(data).entries()) {
        const type = block.type;
        const text = safeText(block.text ?? block.content);
        if (!text) continue;
        if (type === "reasoning" || type === "thinking") {
          const previous = turn.reasoning.at(-1);
          if (event.eventType === "assistant/message" && previous?.streaming && previous.text === text) {
            previous.streaming = false;
          } else {
            turn.reasoning.push({ id: `${event.sessionId}:${event.seq}:reasoning:${index}`, text, streaming: event.eventType === "assistant/chunk" });
          }
        } else if (type === "text") {
          answer += text;
        }
      }
      if (event.eventType === "assistant/message") {
        turn.liveAnswer = answer;
        turn.hasFinalMessage = Boolean(answer.trim());
        for (const item of turn.reasoning) item.streaming = false;
      } else if (answer) {
        turn.liveAnswer = `${turn.liveAnswer}${answer}`;
      }
      return;
    }
    if (event.eventType === "tool/call" || event.eventType === "tool/start") {
      const callId = safeText(data.callId ?? data.id, 300) || `${event.sessionId}:${event.seq}`;
      const existing = turn.tools.find((item) => item.callId === callId);
      if (existing) {
        existing.name = safeText(data.name ?? data.toolName, 300) || existing.name;
        existing.input = data.arguments ?? data.args ?? existing.input;
        existing.startedAtMs ??= finiteTime(event.eventTimeMs);
        existing.status = "running";
      } else {
        turn.tools.push({
          callId,
          name: safeText(data.name ?? data.toolName, 300) || "unknown",
          input: data.arguments ?? data.args,
          status: "running",
          startedAtMs: finiteTime(event.eventTimeMs),
          endedAtMs: null,
        });
      }
      return;
    }
    if (event.eventType === "tool/result" || event.eventType === "tool/end") {
      const callId = safeText(data.callId ?? data.id, 300) || `${event.sessionId}:${event.seq}`;
      const statusValue = safeText(data.status ?? data.outcome, 100).toLowerCase();
      const failed = Boolean(data.error) || ["error", "failed", "failure"].includes(statusValue);
      const existing = turn.tools.find((item) => item.callId === callId);
      if (existing) {
        existing.status = failed ? "error" : statusValue === "stopped" ? "stopped" : "ok";
        if (data.output !== undefined || data.result !== undefined) existing.output = data.output ?? data.result;
        if (data.error !== undefined) existing.output = data.error;
        existing.endedAtMs = finiteTime(event.eventTimeMs);
      } else {
        turn.tools.push({
          callId,
          name: "unknown",
          input: undefined,
          ...(data.output !== undefined || data.result !== undefined ? { output: data.output ?? data.result } : {}),
          status: failed ? "error" : "stopped",
          startedAtMs: null,
          endedAtMs: finiteTime(event.eventTimeMs),
        });
      }
      return;
    }
    if (event.eventType === "turn/end") {
      const kind = reasonKind(data);
      turn.status = kind === "completed" ? "completed" : "failed";
      turn.endedAtMs = finiteTime(event.eventTimeMs);
      turn.durationMs = turn.startedAtMs !== null && turn.endedAtMs !== null && turn.endedAtMs >= turn.startedAtMs
        ? turn.endedAtMs - turn.startedAtMs
        : null;
      if (turn.status === "failed") turn.error = errorText(data);
      turn.collapsed = turn.status === "completed" && turn.tools.length > 0 && turn.hasFinalMessage;
    }
  });
}
