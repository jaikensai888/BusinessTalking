import { beforeEach, describe, expect, it, vi } from "vitest";
import { publish } from "@/lib/discussion/broadcast";
import { DiscussionApprovalBridge, type ApprovalPersistence } from "@/lib/discussion/approval-bridge";

vi.mock("@/lib/discussion/broadcast", () => ({ publish: vi.fn() }));

const request = {
  approvalId: "approval-1",
  discussionId: "d1",
  sessionId: "session-1",
  sessionKind: "persona" as const,
  toolName: "web_search",
  callId: "call-1",
  reason: "needs permission",
};

function persistence(initial: Record<string, "allowed" | "denied"> = {}): ApprovalPersistence {
  const decisions = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (discussionId, capability) => decisions.get(`${discussionId}:${capability}`) ?? null),
    save: vi.fn(async ({ discussionId, capability, status }) => {
      const key = `${discussionId}:${capability}`;
      const previous = decisions.get(key);
      if (previous) return previous === status ? "already-decided" : "conflict";
      decisions.set(key, status);
      return "created";
    }),
  };
}

describe("DiscussionApprovalBridge", () => {
  beforeEach(() => vi.mocked(publish).mockReset());

  it("waits for the exact Discussion decision and publishes an opaque request", async () => {
    const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000, persistence: persistence() });
    const pending = bridge.wait(request);
    await vi.waitFor(() => expect(bridge.listPending("d1")).toMatchObject([{ approvalId: "approval-1", toolName: "web_search", scope: "discussion" }]));
    expect(publish).toHaveBeenCalledWith("d1", expect.objectContaining({
      type: "approval-request",
      approval: expect.objectContaining({ approvalId: "approval-1", sessionId: "session-1", toolName: "web_search", scope: "discussion" }),
    }));
    await expect(bridge.decide("d1", "approval-1", "allowed-once")).resolves.toBe("accepted");
    await expect(pending).resolves.toBe("allowed-once");
  });

  it("merges different Persona Sessions into one Discussion approval", async () => {
    const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000, persistence: persistence() });
    const first = bridge.wait({ ...request, sessionId: "persona-a" });
    const second = bridge.wait({ ...request, approvalId: "approval-2", sessionId: "persona-b", callId: "call-2" });

    await vi.waitFor(() => expect(bridge.listPending("d1")).toHaveLength(1));
    await expect(bridge.decide("d1", "approval-1", "allowed-discussion")).resolves.toBe("accepted");
    await expect(first).resolves.toBe("allowed-once");
    await expect(second).resolves.toBe("allowed-once");
    await expect(bridge.wait({ ...request, approvalId: "approval-3", sessionId: "persona-c", callId: "call-3" }))
      .resolves.toBe("allowed-once");
  });

  it("denies current and future Persona requests for the whole Discussion", async () => {
    const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000, persistence: persistence() });
    const first = bridge.wait({ ...request, sessionId: "persona-a" });
    const second = bridge.wait({ ...request, approvalId: "approval-2", sessionId: "persona-b", callId: "call-2" });

    await vi.waitFor(() => expect(bridge.listPending("d1")).toHaveLength(1));
    await expect(bridge.decide("d1", "approval-1", "rejected-discussion")).resolves.toBe("accepted");
    await expect(first).resolves.toBe("rejected");
    await expect(second).resolves.toBe("rejected");
    await expect(bridge.wait({ ...request, approvalId: "approval-3", sessionId: "persona-c", callId: "call-3" }))
      .resolves.toBe("rejected");
  });

  it("does not carry a Discussion grant to another Discussion or tool", async () => {
    const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000, persistence: persistence() });
    const first = bridge.wait(request);
    await vi.waitFor(() => expect(bridge.listPending("d1")).toHaveLength(1));
    await expect(bridge.decide("d1", "approval-1", "allowed-discussion")).resolves.toBe("accepted");
    await expect(first).resolves.toBe("allowed-once");

    const otherDiscussion = bridge.wait({ ...request, approvalId: "approval-2", discussionId: "d2", sessionId: "session-2" });
    const otherTool = bridge.wait({ ...request, approvalId: "approval-3", toolName: "read_skill_reference", callId: "call-3" });
    await vi.waitFor(() => {
      expect(bridge.listPending("d1")).toMatchObject([{ approvalId: "approval-3", toolName: "read_skill_reference" }]);
      expect(bridge.listPending("d2")).toMatchObject([{ approvalId: "approval-2" }]);
    });
    bridge.cancelDiscussion("d1", "unavailable");
    bridge.cancelDiscussion("d2", "unavailable");
    await expect(otherDiscussion).resolves.toBe("unavailable");
    await expect(otherTool).resolves.toBe("unavailable");
  });

  it("rejects Moderator web_search even when the Discussion grant is allowed", async () => {
    const bridge = new DiscussionApprovalBridge({
      persistence: persistence({ "d1:web_search": "allowed" }),
    });
    await expect(bridge.wait({ ...request, sessionKind: "moderator" })).resolves.toBe("rejected");
    expect(bridge.listPending("d1")).toEqual([]);
  });

  it("accepts only the first decision and rejects conflicting replays", async () => {
    const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000, persistence: persistence() });
    const pending = bridge.wait(request);
    await vi.waitFor(() => expect(bridge.listPending("d1")).toHaveLength(1));
    await expect(bridge.decide("d1", "approval-1", "rejected-discussion")).resolves.toBe("accepted");
    await expect(pending).resolves.toBe("rejected");
    await expect(bridge.decide("d1", "approval-1", "rejected-discussion")).resolves.toBe("already-decided");
    await expect(bridge.decide("d1", "approval-1", "allowed-discussion")).resolves.toBe("conflict");
    await expect(bridge.decide("other", "approval-1", "allowed-discussion")).resolves.toBe("not-found");
  });

  it("fails closed on abort, timeout, and Discussion cancellation", async () => {
    const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000, persistence: persistence() });
    const controller = new AbortController();
    const aborted = bridge.wait({ ...request, approvalId: "abort" }, controller.signal);
    controller.abort();
    await expect(aborted).resolves.toBe("cancelled");
    await expect(bridge.decide("d1", "abort", "allowed-once")).resolves.toBe("conflict");

    const timedBridge = new DiscussionApprovalBridge({ timeoutMs: 10, persistence: persistence() });
    const timedOut = timedBridge.wait({ ...request, approvalId: "timeout" });
    await expect(timedOut).resolves.toBe("unavailable");

    const cancelled = bridge.wait({ ...request, approvalId: "cancel" });
    await vi.waitFor(() => expect(bridge.listPending("d1")).toMatchObject([{ approvalId: "cancel" }]));
    bridge.cancelDiscussion("d1", "unavailable");
    await expect(cancelled).resolves.toBe("unavailable");
    expect(bridge.listPending("d1")).toEqual([]);
  });
});
