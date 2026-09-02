import { Prisma } from "@prisma/client";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

interface StepInput {
  skillId?: unknown;
  personaId?: unknown;
  inputMapping?: unknown;
}

/** GET /api/v1/recipes — 配方列表（stepCount/runCount） */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("page_size") ?? 20) || 20));

  const where = search ? { name: { contains: search } } : {};

  const [total, items] = await Promise.all([
    prisma.recipe.count({ where }),
    prisma.recipe.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { steps: true, runs: true } },
      },
    }),
  ]);

  return ok({
    items: items.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      version: r.version,
      stepCount: r._count.steps,
      runCount: r._count.runs,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    })),
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  });
}

/** POST /api/v1/recipes — 创建配方（可含初始步骤） */
export async function POST(req: Request) {
  let body: { name?: unknown; description?: unknown; steps?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return err(40001, "name 必填且不超过 100 字符", 400);

  const steps = Array.isArray(body.steps) ? (body.steps as StepInput[]) : [];
  const normalized = await normalizeSteps(steps);
  if ("error" in normalized) return err(40001, normalized.error, 400);

  const recipe = await prisma.recipe.create({
    data: {
      name,
      description: typeof body.description === "string" ? body.description : null,
      steps: {
        createMany: {
          data: normalized.steps.map((s, i) => ({
            position: i + 1,
            skillId: s.skillId,
            personaId: s.personaId ?? undefined,
            inputMapping: s.inputMapping as Prisma.InputJsonValue | undefined,
          })),
        },
      },
    },
    select: { id: true, name: true, version: true, createdAt: true },
  });

  return ok(recipe);
}

async function normalizeSteps(steps: StepInput[]): Promise<{ steps: { skillId: string; personaId?: string; inputMapping?: unknown }[] } | { error: string }> {
  if (steps.length === 0) return { steps: [] };
  const skillIds = new Set<string>();
  const personaIds = new Set<string>();
  for (const s of steps) {
    if (typeof s.skillId !== "string" || !s.skillId) return { error: "steps 中存在缺少 skillId 的步骤" };
    skillIds.add(s.skillId);
    if (s.personaId !== undefined && s.personaId !== null) {
      if (typeof s.personaId !== "string") return { error: "personaId 类型错误" };
      personaIds.add(s.personaId);
    }
  }
  const skillCount = await prisma.skill.count({ where: { id: { in: [...skillIds] } } });
  if (skillCount !== skillIds.size) return { error: "steps 中存在不存在的 skillId" };
  if (personaIds.size > 0) {
    const personaCount = await prisma.persona.count({ where: { id: { in: [...personaIds] } } });
    if (personaCount !== personaIds.size) return { error: "steps 中存在不存在的人 personaId" };
  }
  return {
    steps: steps.map((s) => ({
      skillId: s.skillId as string,
      personaId: s.personaId as string | undefined,
      inputMapping: s.inputMapping,
    })),
  };
}
