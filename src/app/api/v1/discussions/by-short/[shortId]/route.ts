import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** GET /api/v1/discussions/by-short/:shortId — 通过短编号定位一场讨论（用于用户引用/排查） */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/discussions/by-short/[shortId]">) {
  const { shortId } = await ctx.params;
  const d = await prisma.discussion.findUnique({
    where: { shortId: shortId.toUpperCase() },
    include: { messages: { orderBy: { createdAt: "asc" } }, artifacts: { orderBy: { createdAt: "desc" } } },
  });
  if (!d) return err(40401, "未找到对应讨论", 404);

  const personaIds = (d.personaIds as string[]) ?? [];
  const personas = await prisma.persona.findMany({
    where: { id: { in: personaIds } },
    select: { id: true, name: true, perspectiveType: true },
  });

  return ok({
    id: d.id,
    shortId: d.shortId,
    brief: d.brief,
    rounds: d.rounds,
    status: d.status,
    summaryBox: d.summaryBox,
    attachmentName: d.attachmentName,
    attachmentCharCount: d.attachmentCharCount,
    attachmentTruncated: d.attachmentTruncated,
    personas: personas.map((p) => ({ id: p.id, name: p.name, perspectiveType: p.perspectiveType })),
    messages: d.messages
      .filter((m) => m.role !== "skill") // 人格设定/参考资料为内部模型上下文，不随 GET 返回给前端
      .map((m) => ({
        id: m.id,
        sender: m.sender,
        role: m.role,
        turn: m.turn,
        content: m.content,
        createdAt: m.createdAt,
      })),
    artifacts: d.artifacts.map((a) => ({
      id: a.id,
      title: a.title,
      type: a.type,
      filePath: a.filePath,
      summary: a.summary,
      content: a.content,
      createdAt: a.createdAt,
    })),
  });
}
