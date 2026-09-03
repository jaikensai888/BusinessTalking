import { Prisma } from "@prisma/client";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runDiscussion } from "@/lib/discussion/runner";
import { streamOneOnOne } from "@/lib/discussion/oneonone";
import { genShortId } from "@/lib/short-id";

/** POST /api/v1/discussions — 创建多人讨论（异步推进）；message = 用户首条提问 */
export async function POST(req: Request) {
  let body: {
    brief?: unknown;
    personaIds?: unknown;
    rounds?: unknown;
    message?: unknown;
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
  const message = typeof body.message === "string" ? body.message.trim() : "";

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

  // 生成唯一短编号（便于用户引用/排查）；碰撞时重试
  let shortId = genShortId();
  for (let i = 0; i < 8; i++) {
    const exists = await prisma.discussion.count({ where: { shortId } });
    if (exists === 0) break;
    shortId = genShortId();
  }

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
      shortId,
    },
  });

  // 把用户在输入框里的提问作为第一条消息带进讨论，人设可据此作答
  const hasFirstMessage = Boolean(message);
  if (hasFirstMessage) {
    await prisma.discussionMessage.create({
      data: { discussionId: d.id, role: "user", sender: "你", turn: 0, content: message },
    });
    // 单人：直接返回 SSE 流式答复（首帧 init 带 id/shortId），streamOneOnOne 内部会落库完整回复。
    if (isOneOnOne) {
      return streamOneOnOne(d.id, personaIds[0], message, { id: d.id, shortId });
    }
  }

  if (!isOneOnOne) void runDiscussion(d.id);

  return ok({
    id: d.id,
    shortId,
    status: isOneOnOne && hasFirstMessage ? "running" : d.status,
    mode: isOneOnOne ? "1on1" : "group",
    rounds: d.rounds,
    attachmentName,
    hasFirstMessage: Boolean(message),
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
      shortId: true,
      createdAt: true,
      _count: { select: { artifacts: true } },
    },
  });
  return ok({
    items: items.map((i) => {
      const personaIds = (i.personaIds as string[]) ?? [];
      return {
        id: i.id,
        shortId: i.shortId,
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
