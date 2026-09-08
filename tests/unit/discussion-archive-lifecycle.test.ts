import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discussionFindUnique: vi.fn(),
  discussionUpdate: vi.fn(),
  discussionDelete: vi.fn(),
  participantUpdateMany: vi.fn(),
  closeDiscussion: vi.fn(),
  capabilityGrantDeleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    discussion: {
      findUnique: mocks.discussionFindUnique,
      update: mocks.discussionUpdate,
      delete: mocks.discussionDelete,
    },
    discussionParticipant: { updateMany: mocks.participantUpdateMany },
    discussionCapabilityGrant: { deleteMany: mocks.capabilityGrantDeleteMany },
  },
}));

vi.mock("@/lib/runtime/singleton", () => ({
  getDiscussionSessionManager: () => ({ closeDiscussion: mocks.closeDiscussion }),
}));

import { archiveDiscussion, purgeDiscussion, restoreDiscussion } from "@/lib/discussion/archive";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.discussionUpdate.mockResolvedValue({});
  mocks.discussionDelete.mockResolvedValue({});
  mocks.participantUpdateMany.mockResolvedValue({ count: 1 });
  mocks.closeDiscussion.mockResolvedValue(undefined);
  mocks.capabilityGrantDeleteMany.mockResolvedValue({ count: 1 });
});

describe("discussion/session archive lifecycle", () => {
  it("archives the Discussion and closes its DSH Session before marking participants archived", async () => {
    const order: string[] = [];
    mocks.discussionFindUnique.mockResolvedValue({ id: "d1", moderatorSessionId: "moderator-d1" });
    mocks.discussionUpdate.mockImplementation(async () => { order.push("discussion"); return {}; });
    mocks.closeDiscussion.mockImplementation(async () => { order.push("close"); });
    mocks.participantUpdateMany.mockImplementation(async () => { order.push("participants"); return { count: 1 }; });

    await archiveDiscussion("d1");

    expect(order).toEqual(["discussion", "close", "participants"]);
    expect(mocks.discussionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: {
        status: "archived",
        moderatorStatus: "archived",
        archivedAt: expect.any(Date),
        purgeAt: expect.any(Date),
      },
    });
    expect(mocks.closeDiscussion).toHaveBeenCalledWith("d1", { reason: "archive" });
    expect(mocks.participantUpdateMany).toHaveBeenCalledWith({
      where: { discussionId: "d1" },
      data: { status: "archived" },
    });
  });

  it("restores archived participant/session metadata for a future Session", async () => {
    mocks.discussionFindUnique.mockResolvedValue({ id: "d1", status: "archived", moderatorStatus: "archived" });

    await restoreDiscussion("d1");

    expect(mocks.discussionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { status: "pending", moderatorStatus: "idle", archivedAt: null, purgeAt: null },
    });
    expect(mocks.participantUpdateMany).toHaveBeenCalledWith({
      where: { discussionId: "d1", status: "archived" },
      data: { status: "pending" },
    });
  });

  it("closes the live DSH Session before purge removes persisted Session data", async () => {
    const order: string[] = [];
    mocks.discussionFindUnique.mockResolvedValue({ id: "d1", moderatorSessionId: null, participants: [] });
    mocks.closeDiscussion.mockImplementation(async () => { order.push("close"); });
    mocks.discussionDelete.mockImplementation(async () => { order.push("delete"); return {}; });

    await expect(purgeDiscussion("d1")).resolves.toBe(true);

    expect(order).toEqual(["close", "delete"]);
    expect(mocks.closeDiscussion).toHaveBeenCalledWith("d1", { reason: "delete" });
    expect(mocks.capabilityGrantDeleteMany).toHaveBeenCalledWith({ where: { discussionId: "d1" } });
  });
});
