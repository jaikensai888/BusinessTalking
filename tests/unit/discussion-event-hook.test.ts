import { describe, expect, it } from "vitest";
import {
  applyDiscussionSseFrame,
  emptyHookState,
  nextReconnectDelay,
  parseDiscussionSseFrame,
} from "@/hooks/use-discussion-events";

describe("useDiscussionEvents protocol helpers", () => {
  it("parses named SSE frames and ignores heartbeat comments", () => {
    expect(parseDiscussionSseFrame(": heartbeat")).toBeNull();
    expect(parseDiscussionSseFrame("event: ready\ndata: {\"discussionId\":\"d1\",\"cursor\":3}"))
      .toEqual({ event: "ready", data: { discussionId: "d1", cursor: 3 } });
  });

  it("advances durable cursor but leaves approval frames outside the cursor", () => {
    let state = emptyHookState();
    state = applyDiscussionSseFrame(state, {
      event: "ready",
      data: { discussionId: "d1", cursor: 0 },
    });
    state = applyDiscussionSseFrame(state, {
      event: "approval",
      data: { type: "approval-request", approvalId: "a1", discussionId: "d1", sessionId: "s1", toolName: "tool-bash" },
    });
    expect(state.cursor).toBe(0);
    expect(state.process.pendingApprovals).toHaveLength(1);
  });

  it("uses bounded exponential reconnect delays", () => {
    expect(nextReconnectDelay(0)).toBe(250);
    expect(nextReconnectDelay(1)).toBe(500);
    expect(nextReconnectDelay(8)).toBe(30_000);
    expect(nextReconnectDelay(99)).toBe(30_000);
  });
});
