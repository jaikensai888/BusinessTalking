import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { streamOneOnOne } from "@/lib/discussion/oneonone";

/** POST /api/v1/discussions/:id/steer — 用户插话/提问 */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/steer">) {
  const { id } = await ctx.params;
  let body: { message?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 5000) return err(40001, "message 必填（1~5000 字符）", 400);

  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) return err(40401, "讨论不存在", 404);

  const personaIds = (d.personaIds as string[]) ?? [];

  // 单人（1 对 1）讨论：你问我答——用户每发一条，该人设立即流式作答（SSE 逐字）。
  if (personaIds.length === 1) {
    await prisma.discussionMessage.create({
      data: { discussionId: id, role: "user", sender: "你", turn: 0, content: message },
    });
    // 直接返回 SSE 流：streamOneOnOne 内部按需加载完整人格设定、组装精简 system、逐字推送并落库完整回复。
    return streamOneOnOne(id, personaIds[0], message);
  }

  // 多人讨论：仅记录，由运行引擎在下一轮消费
  const m = await prisma.discussionMessage.create({
    data: { discussionId: id, role: "user", sender: "你", turn: 0, content: message },
  });
  return ok({ id: m.id });
}
