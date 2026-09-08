import { prisma } from "@/lib/db";
import { runDiscussion } from "./orchestrator";

/**
 * P0-C：恢复卡在 running 的讨论（服务重启/崩溃后 lease 过期但状态无人复位）。
 * - 1v1：其语义是消息即状态（无轮次推进），直接复位为 ready 即可继续提问；
 * - 多人：自动重新触发 runDiscussion——其内部从最后一次提交的 state.round 断点续跑，
 *   且 acquireDiscussionRun 保证并发触发时只有一方真正运行。
 */
export async function recoverStaleRunningDiscussions(): Promise<string[]> {
  const now = new Date();
  const stale = await prisma.discussion.findMany({
    where: {
      status: "running",
      archivedAt: null,
      OR: [{ runLeaseUntil: null }, { runLeaseUntil: { lt: now } }],
    },
    select: { id: true, personaIds: true },
  });

  const resumed: string[] = [];
  for (const d of stale) {
    const personaIds = Array.isArray(d.personaIds) ? (d.personaIds as string[]) : [];
    if (personaIds.length < 2) {
      await prisma.discussion.updateMany({
        where: { id: d.id, status: "running" },
        data: { status: "ready" },
      }).catch(() => undefined);
      continue;
    }
    // runDiscussion 自行 acquire lease：并发 sweep / resume 时只有一方真正续跑
    void runDiscussion(d.id).catch(() => undefined);
    resumed.push(d.id);
  }
  return resumed;
}
