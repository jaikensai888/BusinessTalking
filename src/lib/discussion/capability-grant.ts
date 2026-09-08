import { prisma } from "@/lib/db";
import { DshProtocolError } from "@/lib/dsh/errors";

export const DISCUSSION_WEB_SEARCH_CAPABILITY = "web_search" as const;
export type DiscussionCapabilityStatus = "allowed" | "denied";

function assertCapability(capability: string): asserts capability is typeof DISCUSSION_WEB_SEARCH_CAPABILITY {
  if (capability !== DISCUSSION_WEB_SEARCH_CAPABILITY) {
    throw new DshProtocolError(`不支持的 Discussion capability：${capability}`);
  }
}

function assertDiscussionId(discussionId: string): void {
  if (typeof discussionId !== "string" || !discussionId.trim()) {
    throw new DshProtocolError("discussionId 不能为空");
  }
}

export async function getDiscussionCapabilityGrant(
  discussionId: string,
  capability: string,
): Promise<DiscussionCapabilityStatus | null> {
  assertDiscussionId(discussionId);
  assertCapability(capability);
  const grant = await prisma.discussionCapabilityGrant.findUnique({
    where: { discussionId_capability: { discussionId, capability } },
    select: { status: true },
  });
  if (!grant) return null;
  if (grant.status !== "allowed" && grant.status !== "denied") {
    throw new DshProtocolError(`Discussion capability 状态非法：${grant.status}`);
  }
  return grant.status;
}

export async function saveDiscussionCapabilityGrant(input: {
  discussionId: string;
  capability: string;
  status: DiscussionCapabilityStatus;
  decidedBy?: string | null;
}): Promise<"created" | "already-decided" | "conflict"> {
  assertDiscussionId(input.discussionId);
  assertCapability(input.capability);
  if (input.status !== "allowed" && input.status !== "denied") {
    throw new DshProtocolError(`Discussion capability 决定非法：${input.status}`);
  }

  const existing = await prisma.discussionCapabilityGrant.findUnique({
    where: {
      discussionId_capability: {
        discussionId: input.discussionId,
        capability: input.capability,
      },
    },
    select: { status: true },
  });
  if (existing) return existing.status === input.status ? "already-decided" : "conflict";

  try {
    await prisma.discussionCapabilityGrant.create({
      data: {
        discussionId: input.discussionId,
        capability: input.capability,
        status: input.status,
        decidedAt: new Date(),
        decidedBy: input.decidedBy ?? null,
      },
    });
    return "created";
  } catch (error) {
    if (!error || typeof error !== "object" || (error as { code?: unknown }).code !== "P2002") throw error;
    const raced = await prisma.discussionCapabilityGrant.findUnique({
      where: {
        discussionId_capability: {
          discussionId: input.discussionId,
          capability: input.capability,
        },
      },
      select: { status: true },
    });
    if (!raced || (raced.status !== "allowed" && raced.status !== "denied")) {
      throw new DshProtocolError("Discussion capability unique-key race 未能读取最终状态");
    }
    return raced.status === input.status ? "already-decided" : "conflict";
  }
}

export async function deleteDiscussionCapabilityGrants(discussionId: string): Promise<void> {
  assertDiscussionId(discussionId);
  await prisma.discussionCapabilityGrant.deleteMany({ where: { discussionId } });
}
