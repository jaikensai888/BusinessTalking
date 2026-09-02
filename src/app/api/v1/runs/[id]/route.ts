import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** GET /api/v1/runs/:id — 运行详情（进度/步骤/最终报告） */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/runs/[id]">) {
  const { id } = await ctx.params;
  const run = await prisma.run.findUnique({
    where: { id },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
  if (!run) return err(40401, "运行不存在", 404);

  const snapshot = run.recipeSnapshot as { name: string; steps: unknown[] } | null;

  return ok({
    id: run.id,
    recipeId: run.recipeId,
    recipeName: snapshot?.name ?? "已删除配方",
    ideaInput: run.ideaInput,
    status: run.status,
    currentStep: run.currentStep,
    totalSteps: snapshot?.steps?.length ?? 0,
    provider: run.provider,
    model: run.model,
    error: run.error,
    finalReport: run.finalReport,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    steps: run.steps.map((s) => ({
      stepIndex: s.stepIndex,
      skillName: s.skillName,
      personaName: s.personaName,
      status: s.status,
      input: s.input,
      output: s.output,
      error: s.error,
      durationMs: s.durationMs,
    })),
  });
}

/** DELETE /api/v1/runs/:id — 删除一次运行（级联步骤/反馈） */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/runs/[id]">) {
  const { id } = await ctx.params;
  const run = await prisma.run.findUnique({ where: { id }, select: { id: true } });
  if (!run) return err(40401, "运行不存在", 404);
  await prisma.run.delete({ where: { id } });
  return ok({ deleted: true });
}
