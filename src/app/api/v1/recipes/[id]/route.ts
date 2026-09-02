import { Prisma } from "@prisma/client";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** GET /api/v1/recipes/:id — 详情（含步骤，skill/persona 名称） */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/recipes/[id]">) {
  const { id } = await ctx.params;
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: {
      steps: {
        orderBy: { position: "asc" },
        include: {
          skill: { select: { id: true, name: true, category: true, outputSchema: true } },
          persona: { select: { id: true, name: true, perspectiveType: true, avatarType: true, avatarValue: true } },
        },
      },
    },
  });
  if (!recipe) return err(40401, "配方不存在", 404);

  return ok({
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    version: recipe.version,
    steps: recipe.steps.map((s) => ({
      id: s.id,
      position: s.position,
      skill: s.skill,
      persona: s.persona,
      inputMapping: s.inputMapping,
    })),
  });
}

/** PUT /api/v1/recipes/:id — 全量替换（名称/描述/步骤），版本递增 */
export async function PUT(req: Request, ctx: RouteContext<"/api/v1/recipes/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.recipe.findUnique({ where: { id }, select: { id: true, version: true } });
  if (!existing) return err(40401, "配方不存在", 404);

  let body: { name?: unknown; description?: unknown; steps?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return err(40001, "name 必填且不超过 100 字符", 400);

  const steps = Array.isArray(body.steps) ? (body.steps as { skillId?: unknown; personaId?: unknown; inputMapping?: unknown }[]) : [];
  const skillIds = new Set<string>();
  const personaIds = new Set<string>();
  for (const s of steps) {
    if (typeof s.skillId === "string") skillIds.add(s.skillId);
    if (typeof s.personaId === "string") personaIds.add(s.personaId);
  }
  const skillCount = await prisma.skill.count({ where: { id: { in: [...skillIds] } } });
  if (skillCount !== skillIds.size) return err(40001, "steps 中存在不存在的 skillId", 400);
  if (personaIds.size > 0) {
    const personaCount = await prisma.persona.count({ where: { id: { in: [...personaIds] } } });
    if (personaCount !== personaIds.size) return err(40001, "steps 中存在不存在的人 personaId", 400);
  }

  const nextVersion = bumpVersion(existing.version);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.recipeStep.deleteMany({ where: { recipeId: id } });
    return tx.recipe.update({
      where: { id },
      data: {
        name,
        description: typeof body.description === "string" ? body.description : null,
        version: nextVersion,
        steps: {
          createMany: {
            data: steps.map((s, i) => ({
              position: i + 1,
              skillId: s.skillId as string,
              personaId: (s.personaId as string | undefined) ?? undefined,
              inputMapping: s.inputMapping as Prisma.InputJsonValue | undefined,
            })),
          },
        },
      },
      select: { id: true, version: true, updatedAt: true },
    });
  });

  return ok(updated);
}

function bumpVersion(v: string): string {
  const parts = v.split(".");
  const last = Number(parts[parts.length - 1] ?? 0);
  parts[parts.length - 1] = String(Number.isFinite(last) ? last + 1 : 1);
  return parts.join(".");
}

/** DELETE /api/v1/recipes/:id — 历史 Run 靠快照保留 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/recipes/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.recipe.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return err(40401, "配方不存在", 404);
  await prisma.recipe.delete({ where: { id } });
  return ok(null);
}
