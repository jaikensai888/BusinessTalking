import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { deleteDiscussion } from "@/lib/discussion/archive";
import { getDiscussionEventCursor } from "@/lib/discussion/event-ledger";
import { parseDiscussionState } from "@/lib/discussion/state";

/** GET /api/v1/discussions/:id — 讨论详情（消息流 + 产物 + 参与者/运行时/结构化状态） */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      artifacts: { orderBy: { createdAt: "desc" } },
      participants: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!d) return err(40401, "讨论不存在", 404);

  const personaIds = (d.personaIds as string[]) ?? [];
  const personas = await prisma.persona.findMany({
    where: { id: { in: personaIds } },
    select: { id: true, name: true, perspectiveType: true },
  });
  const state = d.discussionState ? parseDiscussionState(d.discussionState) : null;
  const eventCursor = await getDiscussionEventCursor(id);

  return ok({
    id: d.id,
    shortId: d.shortId,
    brief: d.brief,
    rounds: d.rounds,
    status: d.status,
    summaryBox: d.summaryBox,
    runtimeMode: d.runtimeMode,
    permissionMode: d.permissionMode,
    approvalPolicy: d.approvalPolicy,
    eventCursor,
    stateVersion: d.stateVersion,
    archivedAt: d.archivedAt,
    purgeAt: d.purgeAt,
    discussionState: state,
    attachmentName: d.attachmentName,
    attachmentCharCount: d.attachmentCharCount,
    attachmentTruncated: d.attachmentTruncated,
    personas: personas.map((p) => ({ id: p.id, name: p.name, perspectiveType: p.perspectiveType })),
    participants: d.participants.map((p) => ({
      id: p.id,
      personaId: p.personaId,
      dshSessionId: p.dshSessionId,
      status: p.status,
      lastEventSeq: p.lastEventSeq,
      lastError: p.lastError,
      personaSkillVersion: p.personaSkillVersion,
      personaSkillHash: p.personaSkillHash,
    })),
    messages: d.messages
      .filter((m) => m.role !== "skill") // 人格设定/参考资料为内部模型上下文，不随 GET 返回给前端
      .map((m) => ({
        id: m.id,
        sender: m.sender,
        role: m.role,
        turn: m.turn,
        content: m.content,
        attempt: m.attempt,
        sessionId: m.sessionId,
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

/** DELETE /api/v1/discussions/:id — 不可恢复硬删除：终止 DSH Session 并清理持久化数据 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]">) {
  const { id } = await ctx.params;
  try {
    await deleteDiscussion(id);
  } catch (e) {
    if (e instanceof Error && e.message === "讨论不存在") {
      return err(40401, e.message, 404);
    }
    throw e;
  }
  return ok({ deleted: true });
}
