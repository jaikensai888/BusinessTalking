import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

const LEASE_MS = 10 * 60 * 1000;

export interface DiscussionRunLease {
  runId: string;
  leaseUntil: Date;
}

function nextLease(): Date {
  return new Date(Date.now() + LEASE_MS);
}

/** Acquire one expiring orchestrator lease without a read-then-write race. */
export async function acquireDiscussionRun(discussionId: string): Promise<DiscussionRunLease | null> {
  if (!discussionId.trim()) throw new Error("discussionId 不能为空");
  const runId = randomUUID();
  const leaseUntil = nextLease();
  const now = new Date();
  const result = await prisma.discussion.updateMany({
    where: {
      id: discussionId,
      status: { not: "archived" },
      OR: [
        { activeRunId: null },
        { runLeaseUntil: null },
        { runLeaseUntil: { lt: now } },
      ],
    },
    data: { activeRunId: runId, runLeaseUntil: leaseUntil },
  });
  return result.count === 1 ? { runId, leaseUntil } : null;
}

export async function renewDiscussionRun(discussionId: string, runId: string): Promise<boolean> {
  if (!discussionId.trim() || !runId.trim()) return false;
  const result = await prisma.discussion.updateMany({
    where: { id: discussionId, activeRunId: runId, status: { not: "archived" } },
    data: { runLeaseUntil: nextLease() },
  });
  return result.count === 1;
}

export async function releaseDiscussionRun(discussionId: string, runId: string): Promise<boolean> {
  if (!discussionId.trim() || !runId.trim()) return false;
  const result = await prisma.discussion.updateMany({
    where: { id: discussionId, activeRunId: runId },
    data: { activeRunId: null, runLeaseUntil: null },
  });
  return result.count === 1;
}

export async function isDiscussionRunOwner(discussionId: string, runId: string): Promise<boolean> {
  if (!discussionId.trim() || !runId.trim()) return false;
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    select: { activeRunId: true, runLeaseUntil: true, status: true },
  });
  return Boolean(
    discussion
      && discussion.status !== "archived"
      && discussion.activeRunId === runId
      && discussion.runLeaseUntil !== null
      && discussion.runLeaseUntil.getTime() > Date.now(),
  );
}
