import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runRecipe } from "@/lib/engine/runner";

/** POST /api/v1/runs/:id/steps/:stepIndex/retry — 从该步骤重新执行（后续步骤重置） */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/runs/[id]/steps/[stepIndex]/retry">) {
  const { id, stepIndex } = await ctx.params;
  const idx = Number(stepIndex);

  const run = await prisma.run.findUnique({ where: { id } });
  if (!run) return err(40401, "运行不存在", 404);

  const target = await prisma.runStep.findFirst({ where: { runId: id, stepIndex: idx } });
  if (!target) return err(40401, "步骤不存在", 404);
  if (target.status !== "failed") return err(40001, "该步骤状态不是 failed，不可重试", 400);

  // 重置该步骤及之后所有步骤为 pending（失败步骤输出本就为空，无需清空）
  await prisma.runStep.updateMany({
    where: { runId: id, stepIndex: { gte: idx } },
    data: { status: "pending", error: null, durationMs: null },
  });
  await prisma.run.update({ where: { id }, data: { status: "running", currentStep: idx, error: null, completedAt: null } });

  void runRecipe(id);

  return ok({ id, status: "running", currentStep: idx });
}
