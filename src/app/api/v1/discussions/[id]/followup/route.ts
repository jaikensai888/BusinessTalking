import { err } from "@/lib/api";
import { prisma } from "@/lib/db";
import { streamOneOnOneDsh } from "@/lib/discussion/oneonone-dsh";

/**
 * POST /api/v1/discussions/:id/followup — 讨论结束后，请某个在讨论中的人格就整场讨论单独追问。
 * 走 DSH Runtime：使用该人物的 DSH Session 作为普通下一回合，不再手工拼接历史/Skill。
 */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/followup">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) return err(40401, "讨论不存在", 404);
  if (d.archivedAt) return err(40901, "讨论已归档", 409);

  let body: { personaId?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }
  const personaId = typeof body.personaId === "string" ? body.personaId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!personaId) return err(40001, "personaId 必填", 400);
  if (!message || message.length > 5000) return err(40001, "message 必填（1~5000 字符）", 400);

  const persona = await prisma.persona.findUnique({ where: { id: personaId } });
  if (!persona) return err(40401, "人格不存在", 404);
  const personaIds = (d.personaIds as string[]) ?? [];
  if (!personaIds.includes(personaId)) return err(40001, "该人格不在本次讨论中", 400);

  // 先落用户追问，保证失败也保留问题
  await prisma.discussionMessage.create({
    data: { discussionId: id, role: "user", sender: "你", turn: 0, content: message },
  });

  return streamOneOnOneDsh(id, personaId, message);
}
