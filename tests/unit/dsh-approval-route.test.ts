import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wait: vi.fn(),
  decide: vi.fn(),
  listPending: vi.fn(),
  discussionFindUnique: vi.fn(),
  discussionUpdate: vi.fn(),
  turnCount: vi.fn(),
}));

vi.mock("@/lib/discussion/approval-bridge", () => ({
  getDiscussionApprovalBridge: () => ({
    wait: mocks.wait,
    decide: mocks.decide,
    listPending: mocks.listPending,
  }),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    discussion: { findUnique: mocks.discussionFindUnique, update: mocks.discussionUpdate },
    discussionTurn: { count: mocks.turnCount },
  },
}));

import { POST as internalPost } from "@/app/api/internal/dsh/approval/route";
import { POST as approvalPost } from "@/app/api/v1/discussions/[id]/approvals/[approvalId]/route";
import { PATCH as permissionPatch } from "@/app/api/v1/discussions/[id]/permissions/route";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("DSH approval routes", () => {
  beforeEach(() => {
    process.env.BT_DSH_APPROVAL_TOKEN = "internal-secret";
    mocks.wait.mockReset().mockResolvedValue("allowed-once");
    mocks.decide.mockReset().mockReturnValue("accepted");
    mocks.listPending.mockReset().mockReturnValue([]);
    mocks.discussionFindUnique.mockReset().mockResolvedValue({
      id: "d1", permissionMode: "read-only", approvalPolicy: "ask", archivedAt: null,
    });
    mocks.discussionUpdate.mockReset().mockResolvedValue({
      id: "d1", permissionMode: "read-only", approvalPolicy: "never",
    });
    mocks.turnCount.mockReset().mockResolvedValue(0);
  });

  it("protects the internal bridge with a token and validates the safe body", async () => {
    const unauthorized = await internalPost(jsonRequest("http://localhost/api/internal/dsh/approval", {
      approvalId: "a1", discussionId: "d1", sessionId: "s1", toolName: "tool",
    }));
    expect(unauthorized.status).toBe(403);

    const malformed = await internalPost(jsonRequest("http://localhost/api/internal/dsh/approval", {
      approvalId: "a1", discussionId: "d1", sessionId: "s1", toolName: "tool", arguments: { command: "rm" },
    }, { "x-bt-internal-token": "internal-secret" }));
    expect(malformed.status).toBe(400);

    const response = await internalPost(jsonRequest("http://localhost/api/internal/dsh/approval", {
      approvalId: "a1", discussionId: "d1", sessionId: "s1", toolName: "tool", reason: "why",
    }, { "x-bt-internal-token": "internal-secret" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ approvalId: "a1", outcome: "allowed-once" });
    expect(mocks.wait).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: "a1", discussionId: "d1", sessionId: "s1", toolName: "tool", reason: "why",
    }), expect.anything());
  });

  it("accepts only allowed-once/rejected from the browser and maps bridge status", async () => {
    const invalid = await approvalPost(jsonRequest("http://localhost/api/v1/discussions/d1/approvals/a1", {
      outcome: "cancelled",
    }), { params: Promise.resolve({ id: "d1", approvalId: "a1" }) });
    expect(invalid.status).toBe(400);

    const accepted = await approvalPost(jsonRequest("http://localhost/api/v1/discussions/d1/approvals/a1", {
      outcome: "allowed-once",
    }), { params: Promise.resolve({ id: "d1", approvalId: "a1" }) });
    expect(accepted.status).toBe(200);
    expect(mocks.decide).toHaveBeenCalledWith("d1", "a1", "allowed-once");

    mocks.decide.mockReturnValueOnce("conflict");
    const conflict = await approvalPost(jsonRequest("http://localhost/api/v1/discussions/d1/approvals/a1", {
      outcome: "rejected",
    }), { params: Promise.resolve({ id: "d1", approvalId: "a1" }) });
    expect(conflict.status).toBe(409);
  });

  it("accepts a session-scoped approval from the browser", async () => {
    const response = await approvalPost(jsonRequest("http://localhost/api/v1/discussions/d1/approvals/a1", {
      outcome: "allowed-session",
    }), { params: Promise.resolve({ id: "d1", approvalId: "a1" }) });

    expect(response.status).toBe(200);
    expect(mocks.decide).toHaveBeenCalledWith("d1", "a1", "allowed-session");
  });

  it("updates only read-only Discussion permissions and blocks active/pending turns", async () => {
    const active = await permissionPatch(jsonRequest("http://localhost/api/v1/discussions/d1/permissions", {
      approvalPolicy: "never",
    }), context("d1"));
    expect(active.status).toBe(200);
    expect(mocks.discussionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "d1" },
      data: { approvalPolicy: "never", permissionMode: "read-only" },
    }));

    mocks.turnCount.mockResolvedValueOnce(1);
    const busy = await permissionPatch(jsonRequest("http://localhost/api/v1/discussions/d1/permissions", {
      approvalPolicy: "ask",
    }), context("d1"));
    expect(busy.status).toBe(409);

    const invalid = await permissionPatch(jsonRequest("http://localhost/api/v1/discussions/d1/permissions", {
      permissionMode: "workspace-write",
    }), context("d1"));
    expect(invalid.status).toBe(400);
  });
});
