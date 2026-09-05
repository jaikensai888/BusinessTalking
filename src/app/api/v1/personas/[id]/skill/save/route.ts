import fs from "node:fs";
import path from "node:path";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

const MD_EXT = /\.(md|txt)$/i;

/** POST /api/v1/personas/:id/skill/save — 保存人物 SKILL.md 或某个参考文档内容 */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/personas/[id]/skill/save">) {
  const { id } = await ctx.params;
  let body: { target?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const persona = await prisma.persona.findUnique({ where: { id }, select: { skillPath: true } });
  if (!persona) return err(40401, "人格不存在", 404);
  const skillPath = persona.skillPath;
  if (!skillPath) return err(40001, "该人格未关联 skill 文件", 400);

  const content = typeof body.content === "string" ? body.content : "";
  if (content.length > 500_000) return err(40001, "内容过大", 400);

  const base = path.resolve(/* turbopackIgnore: true */ process.cwd(), path.dirname(skillPath));

  try {
    if (body.target === "skill") {
      fs.writeFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ process.cwd(), skillPath), content, "utf8");
      return ok({ saved: true, target: "skill" });
    }
    const rel = typeof body.target === "string" ? body.target : "";
    if (!rel || !MD_EXT.test(rel)) return err(40001, "非法的目标路径", 400);
    const full = path.resolve(/* turbopackIgnore: true */ base, rel);
    if (!full.startsWith(base)) return err(40001, "目标路径越界", 400);
    fs.writeFileSync(full, content, "utf8");
    return ok({ saved: true, target: rel });
  } catch (e) {
    return err(50001, `保存失败：${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
