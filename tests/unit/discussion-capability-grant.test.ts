import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    discussionCapabilityGrant: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import {
  deleteDiscussionCapabilityGrants,
  getDiscussionCapabilityGrant,
  saveDiscussionCapabilityGrant,
} from "@/lib/discussion/capability-grant";

describe("Discussion capability grants", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.create.mockReset();
    mocks.deleteMany.mockReset();
  });

  it("uses discussionId and capability as the only grant identity", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    mocks.create.mockResolvedValueOnce({ status: "allowed" });

    await expect(saveDiscussionCapabilityGrant({
      discussionId: "d1",
      capability: "web_search",
      status: "allowed",
    })).resolves.toBe("created");
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { discussionId_capability: { discussionId: "d1", capability: "web_search" } },
      select: { status: true },
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ discussionId: "d1", capability: "web_search", status: "allowed" }),
    }));
  });

  it("returns the persisted decision and detects conflicting decisions", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({ status: "allowed" })
      .mockResolvedValueOnce({ status: "allowed" });

    await expect(getDiscussionCapabilityGrant("d1", "web_search")).resolves.toBe("allowed");
    await expect(saveDiscussionCapabilityGrant({
      discussionId: "d1",
      capability: "web_search",
      status: "denied",
    })).resolves.toBe("conflict");
  });

  it("treats replaying the same decision as idempotent", async () => {
    mocks.findUnique.mockResolvedValueOnce({ status: "denied" });

    await expect(saveDiscussionCapabilityGrant({
      discussionId: "d1",
      capability: "web_search",
      status: "denied",
    })).resolves.toBe("already-decided");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("deletes grants only for the requested Discussion", async () => {
    mocks.deleteMany.mockResolvedValueOnce({ count: 1 });

    await deleteDiscussionCapabilityGrants("d1");
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { discussionId: "d1" } });
  });

  it("converges a unique-key race into an idempotent or conflicting decision", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "allowed" });
    mocks.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(saveDiscussionCapabilityGrant({
      discussionId: "d1",
      capability: "web_search",
      status: "allowed",
    })).resolves.toBe("already-decided");
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
  });
});
