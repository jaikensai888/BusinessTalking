import { Prisma } from "@prisma/client";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buildSnapshot, runRecipe } from "@/lib/engine/runner";

/** POST /api/v1/runs — 启动配方执行（异步推进，立即返回） */
export async function POST(req: Request) {
  let body: { recipeId?: unknown; ideaInput?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const recipeId = typeof body.recipeId === "string" ? body.recipeId : "";
  const ideaInput = typeof body.ideaInput === "string" ? body.ideaInput.trim() : "";
  if (!recipeId) return err(40001, "recipeId 必填", 400);
  if (!ideaInput || ideaInput.length > 10000) return err(40001, "ideaInput 必填（1~10000 字符）", 400);

  let snapshot;
  try {
    snapshot = await buildSnapshot(recipeId);
  } catch {
    return err(40401, "配方不存在", 404);
  }
  if (snapshot.steps.length === 0) return err(40401, "配方无步骤，无法执行", 404);

  const run = await prisma.run.create({
    data: {
      recipeId,
      recipeSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      ideaInput,
      status: "pending",
      // 预建全部步骤（pending），运行详情页可展示完整时间线
      steps: {
        create: snapshot.steps.map((s) => ({
          stepIndex: s.position,
          skillId: null,
          personaId: null,
          skillName: s.skill?.name ?? "未知步骤",
          personaName: s.persona?.name ?? null,
          input: { idea: ideaInput } as Prisma.InputJsonValue,
          status: "pending",
        })),
      },
    },
  });

  // 后台异步推进（同 import runner 模式），轮询 GET /runs/:id 查看进度
  void runRecipe(run.id);

  return ok({
    id: run.id,
    recipeId,
    status: "pending",
    currentStep: 0,
    totalSteps: snapshot.steps.length,
    createdAt: run.createdAt,
  });
}

/** GET /api/v1/runs — 运行历史列表 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const recipeId = searchParams.get("recipeId")?.trim() || undefined;
  const status = searchParams.get("status")?.trim() || undefined;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("page_size") ?? 20) || 20));

  const where = {
    ...(recipeId ? { recipeId } : {}),
    ...(status ? { status: status as "pending" | "running" | "done" | "failed" | "cancelled" } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.run.count({ where }),
    prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        recipeId: true,
        recipeSnapshot: true,
        ideaInput: true,
        status: true,
        currentStep: true,
        finalReport: true,
        error: true,
        createdAt: true,
        steps: { select: { status: true, stepIndex: true }, orderBy: { stepIndex: "asc" } },
      },
    }),
  ]);

  return ok({
    items: items.map((r) => {
      const snapshot = r.recipeSnapshot as { name: string; steps: unknown[] };
      return {
        id: r.id,
        recipeId: r.recipeId,
        recipeName: snapshot?.name ?? "已删除配方",
        status: r.status,
        currentStep: r.currentStep,
        totalSteps: snapshot?.steps?.length ?? 0,
        stepStatuses: r.steps.map((s) => s.status),
        ideaPreview: r.ideaInput.slice(0, 60),
        error: r.error,
        rating: null,
        hasReport: Boolean(r.finalReport),
        createdAt: r.createdAt,
      };
    }),
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  });
}
