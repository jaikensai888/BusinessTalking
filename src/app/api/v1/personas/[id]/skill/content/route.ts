import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { readRef } from "@/lib/persona-skill";

/** GET /api/v1/personas/:id/skill/content?p=<rel> — 读取某参考文档内容 */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/personas/[id]/skill/content">) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const rel = searchParams.get("p") ?? "";
  if (!rel) return err(40001, "缺少 path 参数", 400);

  const persona = await prisma.persona.findUnique({ where: { id }, select: { skillPath: true } });
  if (!persona) return err(40401, "人格不存在", 404);

  const content = readRef(persona.skillPath, rel);
  if (content === null) return err(40401, "参考文档不存在", 404);
  return ok({ path: rel, content });
}
