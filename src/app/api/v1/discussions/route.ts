import { Prisma } from "@prisma/client";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runDiscussion } from "@/lib/discussion/runner";

/** POST /api/v1/discussions — 创建多人讨论（异步推进） */
export async function POST(req: Request) {
  let body: {
    brief?: unknown;
    personaIds?: unknown;
    rounds?: unknown;
    attachment?: { filename?: unknown; charCount?: unknown; truncated?: unknown };
  };
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
  if (personaIds.length < 1) return err(40001, "至少选择 1 个人格参与讨论", 400);
  const count = await prisma.persona.count({ where: { id: { in: personaIds } } });
  if (count !== personaIds.length) return err(40001, "存在不存在的人格", 400);

  const attachmentName =
    body.attachment && typeof body.attachment.filename === "string" ? body.attachment.filename.slice(0, 200) : null;
  const attachmentCharCount =
    body.attachment && typeof body.attachment.charCount === "number" ? body.attachment.charCount : null;
  const attachmentTruncated =
    body.attachment && typeof body.attachment.truncated === "boolean" ? body.attachment.truncated : null;

  // 单人 = 1 对 1：不自动跑多轮，进入"ready"等待用户提问；多人 = 自动交锋
  const isOneOnOne = personaIds.length === 1;
  const d = await prisma.discussion.create({
    data: {
      brief,
      rounds,
      personaIds: personaIds as unknown as Prisma.InputJsonValue,
      status: isOneOnOne ? "ready" : "pending",
      summaryBox: brief,
      attachmentName,
      attachmentCharCount,
      attachmentTruncated,
    },
  });
  if (!isOneOnOne) void runDiscussion(d.id);

  return ok({
    id: d.id,
    status: d.status,
    mode: isOneOnOne ? "1on1" : "group",
    rounds: d.rounds,
    attachmentName,
    createdAt: d.createdAt,
  });
}

/** GET /api/v1/discussions — 最近讨论列表（支持 page_size） */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? 30) || 30));
  const items = await prisma.discussion.findMany({
    orderBy: { createdAt: "desc" },
    take: pageSize,
    select: {
      id: true,
      brief: true,
      rounds: true,
      status: true,
      personaIds: true,
      attachmentName: true,
      createdAt: true,
      _count: { select: { artifacts: true } },
    },
  });
  return ok({
    items: items.map((i) => {
      const personaIds = (i.personaIds as string[]) ?? [];
      return {
        id: i.id,
        brief: i.brief.slice(0, 60),
        rounds: i.rounds,
        status: i.status,
        personaCount: personaIds.length,
        attachmentName: i.attachmentName,
        artifactCount: i._count.artifacts,
        createdAt: i.createdAt,
      };
    }),
  });
}
