import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** GET /api/v1/conversations/:id — 会话详情（消息正序） */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/conversations/[id]">) {
  const { id } = await ctx.params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      persona: { select: { id: true, name: true, avatarType: true, avatarValue: true } },
      messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true, createdAt: true } },
    },
  });
  if (!conversation) return err(40401, "会话不存在", 404);

  return ok({
    id: conversation.id,
    personaId: conversation.personaId,
    personaName: conversation.persona.name,
    title: conversation.title,
    messages: conversation.messages,
  });
}

/** DELETE /api/v1/conversations/:id — 删除会话（消息级联） */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/conversations/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.conversation.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return err(40401, "会话不存在", 404);
  await prisma.conversation.delete({ where: { id } });
  return ok(null);
}
