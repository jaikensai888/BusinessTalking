import { describe, expect, it } from "vitest";
import {
  emptyProcessState,
  reduceDiscussionEvent,
  reduceDshEvent,
  type DiscussionProjectionEvent,
  type DiscussionLiveEvent,
} from "@/lib/discussion/dsh-turn-projection";

function event(
  eventType: string,
  seq: number,
  eventTimeMs: number | null,
  data: Record<string, unknown> = {},
): DiscussionLiveEvent {
  return {
    type: "dsh-event",
    discussionId: "d1",
    discussionSeq: seq,
    participantId: "p1",
    sessionId: "s1",
    seq,
    eventType,
    eventTimeMs,
    data,
  };
}

function approval(type: "approval-request" | "approval-decision", approvalId: string, outcome?: string): DiscussionProjectionEvent {
  return {
    type,
    approvalId,
    discussionId: "d1",
    sessionId: "s1",
    toolName: "tool-bash",
    callId: "call-1",
    reason: "需要用户确认",
    ...(outcome ? { outcome } : {}),
  };
}

describe("DSH turn projection", () => {
  it("does not create an empty turn for non-process events before turn/start", () => {
    let state = emptyProcessState();
    state = reduceDshEvent(state, event("agent/inbox/spliced", 1, 100));
    state = reduceDshEvent(state, event("turn/start", 2, 200, { turn: 1 }));
    state = reduceDshEvent(state, event("turn/end", 3, 300, { reason: { kind: "completed" } }));

    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]).toMatchObject({ key: "s1:2", status: "completed" });
  });

  it("pairs tool result and keeps the completed turn duration", () => {
    let state = emptyProcessState();
    state = reduceDshEvent(state, event("turn/start", 1, 1000, { turn: 1 }));
    state = reduceDshEvent(state, event("tool/call", 2, 1100, { callId: "c1", name: "skill", arguments: { q: "x" } }));
    state = reduceDshEvent(state, event("tool/result", 3, 1800, { callId: "c1", status: "ok", output: "done" }));
    state = reduceDshEvent(state, event("assistant/message", 4, 2200, { content: [{ type: "text", text: "answer" }] }));
    state = reduceDshEvent(state, event("turn/end", 5, 2500, { reason: { kind: "completed" } }));

    expect(state.turns[0]).toMatchObject({
      status: "completed",
      durationMs: 1500,
      collapsed: true,
      liveAnswer: "answer",
      tools: [{ callId: "c1", status: "ok", input: { q: "x" }, output: "done" }],
    });
  });

  it("keeps reasoning separate from the visible answer and marks it non-streaming at message", () => {
    let state = emptyProcessState();
    state = reduceDshEvent(state, event("turn/start", 1, 10));
    state = reduceDshEvent(state, event("assistant/chunk", 2, 20, {
      content: [{ type: "reasoning", text: "先检查约束" }, { type: "text", text: "答" }],
    }));
    expect(state.turns[0].reasoning).toMatchObject([{ text: "先检查约束", streaming: true }]);
    expect(state.turns[0].liveAnswer).toBe("答");
    state = reduceDshEvent(state, event("assistant/message", 3, 30, {
      content: [{ type: "reasoning", text: "先检查约束" }, { type: "text", text: "答案" }],
    }));
    expect(state.turns[0].reasoning[0]).toMatchObject({ text: "先检查约束", streaming: false });
    expect(state.turns[0].liveAnswer).toBe("答案");
  });

  it("does not drop an unknown tool result", () => {
    let state = emptyProcessState();
    state = reduceDshEvent(state, event("turn/start", 1, 10));
    state = reduceDshEvent(state, event("tool/result", 2, 20, { callId: "unknown", error: "lost" }));
    expect(state.turns[0].tools).toEqual([expect.objectContaining({ callId: "unknown", status: "error" })]);
  });

  it("shows and removes a pending approval through ephemeral events", () => {
    let state = emptyProcessState();
    state = reduceDiscussionEvent(state, approval("approval-request", "a1"));
    expect(state.pendingApprovals).toHaveLength(1);
    state = reduceDiscussionEvent(state, approval("approval-decision", "a1", "allowed-once"));
    expect(state.pendingApprovals).toHaveLength(0);
  });

  it("ignores duplicate events and marks a cursor gap for resync", () => {
    let state = emptyProcessState();
    state = reduceDshEvent(state, event("turn/start", 1, 10));
    const duplicate = reduceDshEvent(state, event("turn/start", 1, 10));
    expect(duplicate).toBe(state);
    const gap = reduceDshEvent(state, event("turn/end", 3, 30));
    expect(gap.needsResync).toBe(true);
    expect(gap.cursor).toBe(1);
  });
});
