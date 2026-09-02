import { ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** GET /api/v1/conversations — 会话列表（可按人格筛选） */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const personaId = searchParams.get("personaId")?.trim() || undefined;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("page_size") ?? 20) || 20));

  const where = personaId ? { personaId } : {};

  const [total, items] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        persona: { select: { id: true, name: true, avatarType: true, avatarValue: true } },
        _count: { select: { messages: true } },
      },
    }),
  ]);

  return ok({
    items: items.map((c) => ({
      id: c.id,
      personaId: c.personaId,
      personaName: c.persona.name,
      title: c.title,
      messageCount: c._count.messages,
      updatedAt: c.updatedAt,
    })),
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  });
}
