import { err, ok } from "@/lib/api";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensurePersonaSession, freshTurnSessionId, runTurnViaDsh } from "@/lib/discussion/dsh-service";
import { DshError } from "@/lib/dsh/errors";

/**
 * POST /api/v1/discussions/:id/participants/:participantId/retry
 * 失败重试：只允许 status=failed 的 participant；读取原失败回合的 DiscussionTurn.inputSnapshot，
 * 用新的独立 DSH session 重发相同 prompt；成功后用新 attempt 写真实结果，不得重算原输入。
 * P0：重试继续走同一条 DSH runner 路径（无 AI SDK 回退）；空回复按 failed turn 处理。
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/participants/[participantId]/retry">) {
  const { id, participantId } = await ctx.params;
  const participant = await prisma.discussionParticipant.findFirst({
    where: { id: participantId, discussionId: id },
  });
  if (!participant) return err(40401, "参与者不存在", 404);
  if (participant.status !== "failed") return err(40901, "仅失败状态的参与者可重试", 409);

  const discussion = await prisma.discussion.findUnique({
    where: { id },
    select: { personaIds: true },
  });
  const isOneOnOne = Array.isArray(discussion?.personaIds) && discussion.personaIds.length === 1;

  const snapshotTurn = await prisma.discussionTurn.findFirst({
    where: { participantId, status: "failed" },
    orderBy: { createdAt: "desc" },
  });
  if (!snapshotTurn) return err(40401, "没有可重试的失败回合快照", 404);

  const snapshot = snapshotTurn.inputSnapshot as { prompt?: string } | null;
  const prompt = snapshot?.prompt;
  if (!prompt) return err(42201, "输入快照缺少 prompt", 422);

  const turnSessionId = freshTurnSessionId(id, participant.personaId);
  const { persona } = await ensurePersonaSession(id, participant.personaId, turnSessionId);

  const newAttempt = snapshotTurn.attempt + 1;
  const newTurn = await prisma.discussionTurn.create({
    data: {
      discussionId: id,
      participantId: participant.id,
      sessionId: turnSessionId,
      kind: "persona",
      round: snapshotTurn.round,
      attempt: newAttempt,
      inputSnapshot: snapshotTurn.inputSnapshot as Prisma.InputJsonValue,
      status: "running",
    },
  });

  await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "running" } });

  try {
    const text = (await runTurnViaDsh(turnSessionId, prompt)).trim();
    if (text) {
      const msg = await prisma.discussionMessage.create({
        data: {
          discussionId: id,
          personaId: participant.personaId,
          participantId: participant.id,
          sessionId: turnSessionId,
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
        data: { status: "failed", errorCode: "DSH_TURN_FAILED", errorMessage: "DSH 返回空回复", completedAt: new Date() },
      });
      await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "failed", lastError: "DSH 返回空回复" } });
      return err(50201, "DSH 返回空回复", 502);
    }
    await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "completed", lastError: null } });
    if (isOneOnOne) {
      // A successful retry reopens only a one-on-one discussion. Group
      // discussions remain under the orchestrator's failure/round state.
      await prisma.discussion.update({ where: { id }, data: { status: "ready" } });
    }
    return ok({ retried: true, attempt: newAttempt });
  } catch (e) {
    const dshErr = e instanceof DshError ? e : undefined;
    const error = dshErr?.message ?? (e instanceof Error ? e.message : String(e));
    await prisma.discussionTurn.update({
      where: { id: newTurn.id },
      data: {
        status: "failed",
        errorCode: dshErr?.code ?? "DSH_TURN_FAILED",
        errorMessage: error.slice(0, 300),
        completedAt: new Date(),
      },
    });
    await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "failed", lastError: error.slice(0, 300) } });
    return err(50201, "DSH 重试失败", 502);
  }
}
