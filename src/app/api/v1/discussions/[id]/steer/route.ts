import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** POST /api/v1/discussions/:id/steer — 用户插话（写入消息，下一回合生效） */
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

  const m = await prisma.discussionMessage.create({
    data: { discussionId: id, role: "user", sender: "你", turn: 0, content: message },
  });
  return ok({ id: m.id });
}
