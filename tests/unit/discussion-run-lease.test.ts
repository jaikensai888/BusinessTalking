import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    discussion: {
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
    },
  },
}));

import {
  acquireDiscussionRun,
  isDiscussionRunOwner,
  releaseDiscussionRun,
  renewDiscussionRun,
} from "@/lib/discussion/run-lease";

describe("Discussion run lease", () => {
  beforeEach(() => {
    mocks.updateMany.mockReset();
    mocks.findUnique.mockReset();
  });

  it("acquires only when the Discussion has no active non-expired run", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(acquireDiscussionRun("d1")).resolves.toEqual(expect.objectContaining({
      runId: expect.any(String),
      leaseUntil: expect.any(Date),
    }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "d1" }),
      data: expect.objectContaining({ activeRunId: expect.any(String), runLeaseUntil: expect.any(Date) }),
    }));
  });

  it("returns null when another non-expired run owns the Discussion", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(acquireDiscussionRun("d1")).resolves.toBeNull();
  });

  it("renews and releases only for the owning runId", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });

    await expect(renewDiscussionRun("d1", "run-1")).resolves.toBe(true);
    await expect(releaseDiscussionRun("d1", "run-1")).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: "d1", activeRunId: "run-1" }),
    }));
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: "d1", activeRunId: "run-1" }),
    }));
  });

  it("reports ownership from the current Discussion row", async () => {
    mocks.findUnique.mockResolvedValueOnce({ activeRunId: "run-1", runLeaseUntil: new Date(Date.now() + 60_000) });
    await expect(isDiscussionRunOwner("d1", "run-1")).resolves.toBe(true);

    mocks.findUnique.mockResolvedValueOnce({ activeRunId: "run-2", runLeaseUntil: new Date(Date.now() + 60_000) });
    await expect(isDiscussionRunOwner("d1", "run-1")).resolves.toBe(false);
  });
});
