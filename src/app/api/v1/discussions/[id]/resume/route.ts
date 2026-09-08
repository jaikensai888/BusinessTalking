import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runDiscussion } from "@/lib/discussion/orchestrator";

/**
 * POST /api/v1/discussions/:id/resume — 从断点恢复中断的多人讨论（P0-C 手动入口）。
 * runDiscussion 从最后一次提交的 state.round 续跑；lease 保证不会与正在运行的一轮并发。
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/resume">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) return err(40401, "讨论不存在", 404);
  if (d.archivedAt) return err(40901, "讨论已归档", 409);
  const personaIds = (d.personaIds as string[]) ?? [];
  if (personaIds.length < 2) return err(40001, "仅多人讨论支持断点恢复", 400);
  if (d.status === "done") return err(40901, "讨论已完成，无需恢复", 409);
  if (d.status === "running" && d.runLeaseUntil && d.runLeaseUntil.getTime() > Date.now()) {
    return err(40901, "讨论正在运行中", 409);
  }

  void runDiscussion(id);
  return ok({ resumed: true });
}
