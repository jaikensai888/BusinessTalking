import { describe, expect, it } from "vitest";
import {
  applyDiscussionSseFrame,
  emptyHookState,
  isDiscussionSseConnectionActive,
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

  it("ignores frames from disposed or superseded SSE connections", () => {
    expect(isDiscussionSseConnectionActive(true, 1, 1)).toBe(false);
    expect(isDiscussionSseConnectionActive(false, 1, 2)).toBe(false);
    expect(isDiscussionSseConnectionActive(false, 2, 2)).toBe(true);
  });
});
