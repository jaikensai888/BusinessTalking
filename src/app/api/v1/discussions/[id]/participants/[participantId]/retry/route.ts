import type { Prisma } from "@prisma/client";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensurePersonaSession } from "@/lib/discussion/dsh-service";
import { runDiscussionDshTurn } from "@/lib/discussion/run-dsh-turn";
import { acquireDiscussionRun, releaseDiscussionRun } from "@/lib/discussion/run-lease";
import { getDiscussionSessionManager } from "@/lib/runtime/singleton";

/**
 * POST /api/v1/discussions/:id/participants/:participantId/retry
 *
 * Retry the latest failed turn with the participant's original stable DSH
 * session and exact input snapshot. Events from the previous attempt remain
 * immutable in the Discussion ledger.
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
    select: { personaIds: true, archivedAt: true },
  });
  if (!discussion) return err(40401, "讨论不存在", 404);
  if (discussion.archivedAt) return err(40901, "讨论已归档", 409);

  const manager = getDiscussionSessionManager();
  if (manager.isBusy(id, participant.dshSessionId)) {
    return err(40901, "该人格的 DSH Session 正在运行，请稍后重试", 409);
  }

  const snapshotTurn = await prisma.discussionTurn.findFirst({
    where: { participantId, status: "failed" },
    orderBy: { createdAt: "desc" },
  });
  if (!snapshotTurn) return err(40401, "没有可重试的失败回合快照", 404);

  const snapshot = snapshotTurn.inputSnapshot as { prompt?: unknown; runId?: unknown } | null;
  const prompt = typeof snapshot?.prompt === "string" ? snapshot.prompt : "";
  if (!prompt.trim()) return err(42201, "输入快照缺少 prompt", 422);

  let persona: { name: string };
  try {
    // This rewrites the manifest for the same participant.dshSessionId; it
    // never mints a retry-specific session.
    ({ persona } = await ensurePersonaSession(id, participant.personaId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(42201, message.slice(0, 300), 422);
  }

  const newAttempt = snapshotTurn.attempt + 1;
  const lease = await acquireDiscussionRun(id);
  if (!lease) return err(40901, "该讨论已有回合正在运行，请稍后重试", 409);

  try {
    const result = await runDiscussionDshTurn({
      discussionId: id,
      runId: lease.runId,
      participantId: participant.id,
      sessionId: participant.dshSessionId,
      kind: "persona",
      round: snapshotTurn.round,
      attempt: newAttempt,
      prompt,
      inputSnapshot: {
        ...(snapshotTurn.inputSnapshot as Record<string, unknown>),
        runId: lease.runId,
      } as Prisma.InputJsonValue,
      personaId: participant.personaId,
      sender: persona.name,
    });

    if (result.status === "failed") {
      const status = result.errorCode === "DSH_SESSION_BUSY" ? 409 : 502;
      return err(status === 409 ? 40901 : 50201, result.error ?? "DSH 重试失败", status);
    }

    const isOneOnOne = Array.isArray(discussion.personaIds) && discussion.personaIds.length === 1;
    if (isOneOnOne) {
      await prisma.discussion.update({ where: { id }, data: { status: "ready" } });
    }
    return ok({ retried: true, attempt: newAttempt, eventsWritten: result.eventsWritten });
  } finally {
    await releaseDiscussionRun(id, lease.runId);
  }
}
