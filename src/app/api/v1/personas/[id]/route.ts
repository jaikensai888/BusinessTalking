import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { PerspectiveType } from "@prisma/client";

/** GET /api/v1/personas/:id */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/personas/[id]">) {
  const { id } = await ctx.params;
  const persona = await prisma.persona.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      systemPrompt: true,
      perspectiveType: true,
      avatarType: true,
      avatarValue: true,
      isBuiltin: true,
      tags: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!persona) return err(40401, "人格不存在", 404);
  return ok(persona);
}

const ALLOWED_TYPES = ["investor", "customer", "competitor", "economist", "entrepreneur", "analyst", "custom"];

/** PUT /api/v1/personas/:id — 内置不可修改 */
export async function PUT(req: Request, ctx: RouteContext<"/api/v1/personas/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.persona.findUnique({ where: { id }, select: { isBuiltin: true } });
  if (!existing) return err(40401, "人格不存在", 404);
  if (existing.isBuiltin) return err(40901, "内置人格不可修改", 409);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  if (!name || name.length > 100) return err(40001, "name 必填且不超过 100 字符", 400);
  if (!systemPrompt) return err(40001, "systemPrompt 必填", 400);

  const perspectiveType = typeof body.perspectiveType === "string" ? body.perspectiveType : "custom";
  if (!ALLOWED_TYPES.includes(perspectiveType)) {
    return err(40001, "perspectiveType 不在允许范围", 400);
  }

  const updated = await prisma.persona.update({
    where: { id },
    data: {
      name,
      description: typeof body.description === "string" ? body.description : null,
      systemPrompt,
      perspectiveType: perspectiveType as PerspectiveType,
      avatarType: typeof body.avatarType === "string" && body.avatarType === "builtin" ? "builtin" : "auto",
      avatarValue: typeof body.avatarValue === "string" ? body.avatarValue : null,
      tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : [],
    },
    select: { id: true, updatedAt: true },
  });

  return ok(updated);
}

/** DELETE /api/v1/personas/:id — 内置不可删除；RecipeStep 自动 SET NULL，Conversation 级联 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/personas/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.persona.findUnique({ where: { id }, select: { isBuiltin: true } });
  if (!existing) return err(40401, "人格不存在", 404);
  if (existing.isBuiltin) return err(40901, "内置人格不可删除", 409);

  await prisma.persona.delete({ where: { id } });
  return ok(null);
}
