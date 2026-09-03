import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { replyOneOnOne } from "@/lib/discussion/oneonone";
import { publish } from "@/lib/discussion/broadcast";

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

  // 单人（1 对 1）讨论：你问我答——用户每发一条，该人设立即作答
  if (personaIds.length === 1) {
    const persona = await prisma.persona.findUnique({
      where: { id: personaIds[0] },
      select: { name: true },
    });
    const m = await prisma.discussionMessage.create({
      data: { discussionId: id, role: "user", sender: "你", turn: 0, content: message },
    });
    // 标记为"生成中"并立刻返回，让前端轮询并展示「正在思考」
    await prisma.discussion.update({ where: { id }, data: { status: "running" } });
    publish(id, { type: "change" });
    void (async () => {
      try {
        const reply = await replyOneOnOne(id, personaIds[0], message);
        await prisma.discussionMessage.create({
          data: {
            discussionId: id,
            personaId: personaIds[0],
            sender: persona?.name ?? "专家",
            role: "persona",
            turn: 0,
            content: reply,
          },
        });
        publish(id, { type: "change" });
      } catch (e) {
        await prisma.discussionMessage
          .create({
            data: {
              discussionId: id,
              personaId: personaIds[0],
              sender: persona?.name ?? "专家",
              role: "persona",
              turn: 0,
              content: `（回答失败：${e instanceof Error ? e.message : String(e)}）`,
            },
          })
          .catch(() => undefined);
      } finally {
        await prisma.discussion
          .update({ where: { id }, data: { status: "ready" } })
          .catch(() => undefined);
        publish(id, { type: "change" });
      }
    })();
    return ok({ id: m.id, mode: "1on1" });
  }

  // 多人讨论：仅记录，由运行引擎在下一轮消费
  const m = await prisma.discussionMessage.create({
    data: { discussionId: id, role: "user", sender: "你", turn: 0, content: message },
  });
  return ok({ id: m.id });
}
