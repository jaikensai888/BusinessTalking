import { beforeEach, describe, expect, it, vi } from "vitest";
import { publish } from "@/lib/discussion/broadcast";
import { DiscussionApprovalBridge } from "@/lib/discussion/approval-bridge";

vi.mock("@/lib/discussion/broadcast", () => ({ publish: vi.fn() }));

const request = {
  approvalId: "approval-1",
  discussionId: "d1",
  sessionId: "session-1",
  toolName: "tool-test",
  callId: "call-1",
  reason: "needs permission",
};

describe("DiscussionApprovalBridge", () => {
  beforeEach(() => vi.mocked(publish).mockReset());

  it("waits for the exact Discussion decision and publishes an opaque request", async () => {
    const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000 });
    const pending = bridge.wait(request);
    expect(bridge.listPending("d1")).toMatchObject([{ approvalId: "approval-1", toolName: "tool-test" }]);
    expect(publish).toHaveBeenCalledWith("d1", expect.objectContaining({
      type: "approval-request",
      approval: expect.objectContaining({ approvalId: "approval-1", sessionId: "session-1", toolName: "tool-test" }),
    }));
    expect(bridge.decide("d1", "approval-1", "allowed-once")).toBe("accepted");
    await expect(pending).resolves.toBe("allowed-once");
  });

  it("accepts only the first decision and rejects conflicting replays", async () => {
    const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000 });
    const pending = bridge.wait(request);
    expect(bridge.decide("d1", "approval-1", "rejected")).toBe("accepted");
    await expect(pending).resolves.toBe("rejected");
    expect(bridge.decide("d1", "approval-1", "rejected")).toBe("already-decided");
    expect(bridge.decide("d1", "approval-1", "allowed-once")).toBe("conflict");
    expect(bridge.decide("other", "approval-1", "allowed-once")).toBe("not-found");
  });

  it("fails closed on abort, timeout, and Discussion cancellation", async () => {
    const bridge = new DiscussionApprovalBridge({ timeoutMs: 10 });
    const controller = new AbortController();
    const aborted = bridge.wait({ ...request, approvalId: "abort" }, controller.signal);
    controller.abort();
    await expect(aborted).resolves.toBe("cancelled");
    expect(bridge.decide("d1", "abort", "allowed-once")).toBe("conflict");

    const timedOut = bridge.wait({ ...request, approvalId: "timeout" });
    await expect(timedOut).resolves.toBe("unavailable");

    const cancelled = bridge.wait({ ...request, approvalId: "cancel" });
    bridge.cancelDiscussion("d1", "unavailable");
    await expect(cancelled).resolves.toBe("unavailable");
    expect(bridge.listPending("d1")).toEqual([]);
  });
});
