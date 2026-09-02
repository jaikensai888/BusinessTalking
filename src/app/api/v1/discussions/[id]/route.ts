import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** GET /api/v1/discussions/:id — 讨论详情（消息流） */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!d) return err(40401, "讨论不存在", 404);

  const personaIds = (d.personaIds as string[]) ?? [];
  const personas = await prisma.persona.findMany({
    where: { id: { in: personaIds } },
    select: { id: true, name: true, perspectiveType: true },
  });

  return ok({
    id: d.id,
    brief: d.brief,
    rounds: d.rounds,
    status: d.status,
    summaryBox: d.summaryBox,
    personas: personas.map((p) => ({ id: p.id, name: p.name, perspectiveType: p.perspectiveType })),
    messages: d.messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      role: m.role,
      turn: m.turn,
      content: m.content,
      createdAt: m.createdAt,
    })),
  });
}
