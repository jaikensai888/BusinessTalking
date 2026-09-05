import { err, ok } from "@/lib/api";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureStartedForSettings, getRuntimeManager } from "@/lib/runtime/singleton";
import { persistAgentEvents, type DshNotification } from "@/lib/dsh/events";
import { DshSessionBusyError, DshError } from "@/lib/dsh/errors";

/**
 * POST /api/v1/discussions/:id/participants/:participantId/retry
 * 失败重试：只允许 status=failed 的 participant；读取原失败回合的 DiscussionTurn.inputSnapshot，
 * 用同一 dshSessionId 重发相同 prompt；成功后用新 attempt 写真实结果，不得重算原输入。
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/participants/[participantId]/retry">) {
  const { id, participantId } = await ctx.params;
  const participant = await prisma.discussionParticipant.findFirst({
    where: { id: participantId, discussionId: id },
  });
  if (!participant) return err(40401, "参与者不存在", 404);
  if (participant.status !== "failed") return err(40901, "仅失败状态的参与者可重试", 409);

  const snapshotTurn = await prisma.discussionTurn.findFirst({
    where: { participantId, status: "failed" },
    orderBy: { createdAt: "desc" },
  });
  if (!snapshotTurn) return err(40401, "没有可重试的失败回合快照", 404);

  const snapshot = snapshotTurn.inputSnapshot as { prompt?: string } | null;
  const prompt = snapshot?.prompt;
  if (!prompt) return err(42201, "输入快照缺少 prompt", 422);

  const persona = await prisma.persona.findUnique({ where: { id: participant.personaId } });
  if (!persona) return err(40401, "人格不存在", 404);

  await ensureStartedForSettings();
  const mgr = getRuntimeManager();

  const newAttempt = snapshotTurn.attempt + 1;
  const newTurn = await prisma.discussionTurn.create({
    data: {
      discussionId: id,
      participantId: participant.id,
      sessionId: participant.dshSessionId,
      kind: "persona",
      round: snapshotTurn.round,
      attempt: newAttempt,
      inputSnapshot: snapshotTurn.inputSnapshot as Prisma.InputJsonValue,
      status: "running",
    },
  });

  await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "running" } });

  try {
    const result = await mgr.run(participant.dshSessionId, prompt, undefined);
    await persistAgentEvents(id, result.notifications as DshNotification[]);

    const text = result.finalResponse.trim();
    if (text) {
      const msg = await prisma.discussionMessage.create({
        data: {
          discussionId: id,
          personaId: participant.personaId,
          participantId: participant.id,
          sessionId: participant.dshSessionId,
          sender: persona.name,
          role: "persona",
          turn: snapshotTurn.round,
          content: text,
          attempt: newAttempt,
        },
      });
      await prisma.discussionTurn.update({
        where: { id: newTurn.id },
        data: { status: "completed", outputMessageId: msg.id, completedAt: new Date() },
      });
    } else {
      await prisma.discussionTurn.update({
        where: { id: newTurn.id },
        data: { status: "completed", completedAt: new Date() },
      });
    }
    await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "completed", lastError: null } });
    return ok({ retried: true, attempt: newAttempt });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.discussionTurn.update({
      where: { id: newTurn.id },
      data: { status: "failed", errorMessage: error, completedAt: new Date() },
    });
    await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "failed", lastError: error } });
    if (e instanceof DshSessionBusyError) return err(40901, e.message, 409);
    throw e;
  }
}
