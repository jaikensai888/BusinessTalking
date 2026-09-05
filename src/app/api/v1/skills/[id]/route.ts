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

/** PUT /api/v1/skills/:id — 已安装 revision 不可修改执行内容，仅允许改展示元数据 */
export async function PUT(req: Request, ctx: RouteContext<"/api/v1/skills/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.skill.findUnique({ where: { id }, select: { isBuiltin: true } });
  if (!existing) return err(40401, "skill 不存在", 404);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  // 内容（正文/schema）不可变：任何涉及执行内容的修改一律 409
  if (
    typeof body.instructions === "string" ||
    body.inputSchema !== undefined ||
    body.outputSchema !== undefined
  ) {
    return err(40901, "已安装 Skill 的正文与 schema 不可修改（revision 不可变）", 409);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return err(40001, "name 必填且不超过 100 字符", 400);

  const updated = await prisma.skill.update({
    where: { id },
    data: {
      name,
      description: typeof body.description === "string" ? body.description : null,
      category: typeof body.category === "string" && body.category ? body.category : "通用",
      tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : [],
    },
    select: { id: true, updatedAt: true },
  });

  return ok(updated);
}

/** DELETE /api/v1/skills/:id — 只允许卸载未被讨论/配方引用的 revision（保留历史文件） */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/skills/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.skill.findUnique({ where: { id } });
  if (!existing) return err(40401, "skill 不存在", 404);

  const [discussions, steps] = await Promise.all([
    prisma.discussionSkill.count({ where: { skillRevision: { skillId: id } } }),
    prisma.recipeStep.count({ where: { skillId: id } }),
  ]);
  if (discussions > 0 || steps > 0) {
    return err(40901, "该 Skill 正被讨论或配方引用，不能卸载；请先解除引用", 409);
  }

  // 卸载：删除 DB 记录（Skill + 其 revision），保留 data/skill-library 版本文件
  try {
    await prisma.skill.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "P2003") {
      return err(40901, "该 Skill 正被引用，不能卸载", 409);
    }
    throw e;
  }

  return ok(null);
}
