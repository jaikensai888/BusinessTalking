import { Prisma } from "@prisma/client";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runDiscussion } from "@/lib/discussion/runner";

/** POST /api/v1/discussions — 创建多人讨论（异步推进） */
export async function POST(req: Request) {
  let body: { brief?: unknown; personaIds?: unknown; rounds?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  const personaIds = Array.isArray(body.personaIds)
    ? body.personaIds.filter((x): x is string => typeof x === "string")
    : [];
  const rounds = Math.min(10, Math.max(1, Number(body.rounds ?? 5) || 5));

  if (!brief || brief.length > 10000) return err(40001, "brief 必填（1~10000 字符）", 400);
  if (personaIds.length < 2) return err(40001, "至少选择 2 个人格参与讨论", 400);
  const count = await prisma.persona.count({ where: { id: { in: personaIds } } });
  if (count !== personaIds.length) return err(40001, "存在不存在的人格", 400);

  const d = await prisma.discussion.create({
    data: {
      brief,
      rounds,
      personaIds: personaIds as unknown as Prisma.InputJsonValue,
      status: "pending",
      summaryBox: brief,
    },
  });
  void runDiscussion(d.id);

  return ok({ id: d.id, status: "pending", rounds: d.rounds, createdAt: d.createdAt });
}

/** GET /api/v1/discussions — 最近讨论列表 */
export async function GET() {
  const items = await prisma.discussion.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, brief: true, rounds: true, status: true, createdAt: true },
  });
  return ok({
    items: items.map((i) => ({ ...i, brief: i.brief.slice(0, 60) })),
  });
}
