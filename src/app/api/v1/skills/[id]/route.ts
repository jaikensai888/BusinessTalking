import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

async function findSkill(id: string) {
  return prisma.skill.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      instructions: true,
      inputSchema: true,
      outputSchema: true,
      source: true,
      sourceRef: true,
      tags: true,
      isBuiltin: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/** GET /api/v1/skills/:id */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/skills/[id]">) {
  const { id } = await ctx.params;
  const skill = await findSkill(id);
  if (!skill) return err(40401, "skill 不存在", 404);
  return ok(skill);
}

/** PUT /api/v1/skills/:id — 内置不可修改 */
export async function PUT(req: Request, ctx: RouteContext<"/api/v1/skills/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.skill.findUnique({ where: { id }, select: { isBuiltin: true } });
  if (!existing) return err(40401, "skill 不存在", 404);
  if (existing.isBuiltin) return err(40901, "内置 skill 不可修改", 409);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
  if (!name || name.length > 100) return err(40001, "name 必填且不超过 100 字符", 400);
  if (!instructions) return err(40001, "instructions 必填", 400);

  const updated = await prisma.skill.update({
    where: { id },
    data: {
      name,
      description: typeof body.description === "string" ? body.description : null,
      category: typeof body.category === "string" && body.category ? body.category : "通用",
      instructions,
      inputSchema: body.inputSchema ?? undefined,
      outputSchema: body.outputSchema ?? undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : [],
    },
    select: { id: true, updatedAt: true },
  });

  return ok(updated);
}

/** DELETE /api/v1/skills/:id — 内置/被配方引用不可删除 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/skills/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.skill.findUnique({ where: { id }, select: { isBuiltin: true } });
  if (!existing) return err(40401, "skill 不存在", 404);
  if (existing.isBuiltin) return err(40901, "内置 skill 不可删除", 409);

  try {
    await prisma.skill.delete({ where: { id } });
  } catch (e) {
    // P2003: 外键约束（被 RecipeStep 引用）
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "P2003") {
      return err(40901, "该 skill 正被配方步骤引用，请先解除引用", 409);
    }
    throw e;
  }

  return ok(null);
}
