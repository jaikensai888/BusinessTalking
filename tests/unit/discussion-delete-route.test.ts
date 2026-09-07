import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deleteDiscussion: vi.fn() }));

vi.mock("@/lib/discussion/archive", () => ({
  deleteDiscussion: mocks.deleteDiscussion,
}));
vi.mock("@/lib/db", () => ({
  prisma: { discussion: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/discussion/event-ledger", () => ({
  getDiscussionEventCursor: vi.fn(),
}));
vi.mock("@/lib/discussion/state", () => ({
  parseDiscussionState: vi.fn(),
}));

import { DELETE } from "@/app/api/v1/discussions/[id]/route";

describe("DELETE /api/v1/discussions/:id", () => {
  it("returns a hard-delete result", async () => {
    mocks.deleteDiscussion.mockResolvedValue({ id: "d1", deleted: true });

    const response = await DELETE(new Request("http://localhost/api/v1/discussions/d1"), {
      params: Promise.resolve({ id: "d1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: 0, data: { deleted: true } });
    expect(mocks.deleteDiscussion).toHaveBeenCalledWith("d1");
  });

  it("maps a missing Discussion to 404", async () => {
    mocks.deleteDiscussion.mockRejectedValue(new Error("讨论不存在"));

    const response = await DELETE(new Request("http://localhost/api/v1/discussions/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 40401, data: null });
  });
});
