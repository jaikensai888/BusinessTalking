import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runRecipe } from "@/lib/engine/runner";

/** POST /api/v1/runs/:id/steps/:stepIndex/skip — 跳过失败步骤，继续后续步骤 */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/runs/[id]/steps/[stepIndex]/skip">) {
  const { id, stepIndex } = await ctx.params;
  const idx = Number(stepIndex);

  const run = await prisma.run.findUnique({ where: { id } });
  if (!run) return err(40401, "运行不存在", 404);

  const target = await prisma.runStep.findFirst({ where: { runId: id, stepIndex: idx } });
  if (!target) return err(40401, "步骤不存在", 404);
  if (target.status !== "failed") return err(40001, "该步骤状态不是 failed，不可跳过", 400);

  // 标记跳过，重置后续步骤为 pending
  await prisma.runStep.update({ where: { id: target.id }, data: { status: "skipped" } });
  await prisma.runStep.updateMany({
    where: { runId: id, stepIndex: { gt: idx }, status: { in: ["failed", "pending"] } },
    data: { status: "pending", error: null, durationMs: null },
  });
  await prisma.run.update({ where: { id }, data: { status: "running", currentStep: idx + 1, error: null, completedAt: null } });

  void runRecipe(id);

  return ok({ id, status: "running", currentStep: idx + 1 });
}
