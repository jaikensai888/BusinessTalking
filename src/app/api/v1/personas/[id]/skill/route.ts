import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { listReferences, readSkillMd } from "@/lib/persona-skill";

/** GET /api/v1/personas/:id/skill — 人物 skill 结构：SKILL.md + 参考文档列表 */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/personas/[id]/skill">) {
  const { id } = await ctx.params;
  const persona = await prisma.persona.findUnique({ where: { id }, select: { name: true, skillPath: true } });
  if (!persona) return err(40401, "人格不存在", 404);

  return ok({
    name: persona.name,
    skillPath: persona.skillPath,
    skillMd: readSkillMd(persona.skillPath),
    refs: listReferences(persona.skillPath),
  });
}
