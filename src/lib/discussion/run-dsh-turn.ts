import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getDiscussionSessionConfig,
  getDiscussionSessionManager,
} from "@/lib/runtime/singleton";
import {
  DiscussionRunLeaseLostError,
  DshError,
  DshProtocolError,
  DshTurnError,
} from "@/lib/dsh/errors";
import { isDiscussionRunOwner } from "./run-lease";
import type { DshNotification } from "@/lib/dsh/events";
import {
  extractMappedEvent,
} from "@/lib/dsh/session-events";
import { ingestDiscussionEvent } from "./event-ledger";

export interface RunDiscussionDshTurnInput {
  discussionId: string;
  runId: string;
  participantId: string | null;
  sessionId: string;
  kind: "persona" | "moderator";
  round: number;
  attempt: number;
  prompt: string;
  inputSnapshot: Prisma.InputJsonValue;
  personaId?: string;
  sender?: string;
}

export interface RunDiscussionDshTurnResult {
  turnId: string;
  participantId: string | null;
  sessionId: string;
  finalText: string;
  eventsWritten: number;
  status: "completed" | "failed";
  outputMessageId?: string;
  errorCode?: string;
  error?: string;
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof DshError) {
    return { code: error.code, message: error.message.slice(0, 300) };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "DSH_PROTOCOL_FAILED", message: message.slice(0, 300) };
}

function isCompletedTurnEnd(data: Record<string, unknown>): boolean {
  const reason = data.reason;
  return Boolean(
    reason &&
      typeof reason === "object" &&
      !Array.isArray(reason) &&
      (reason as { kind?: unknown }).kind === "completed",
  );
}

function validateInput(input: RunDiscussionDshTurnInput): void {
  if (!input.discussionId.trim()) throw new DshProtocolError("discussionId 不能为空");
  if (!input.runId.trim()) throw new DshProtocolError("Discussion runId 不能为空");
  if (!input.sessionId.trim()) throw new DshProtocolError("DSH Session id 不能为空");
  if (!input.prompt.trim()) throw new DshProtocolError("DSH prompt 不能为空");
  if (!Number.isSafeInteger(input.round) || input.round < 0) {
    throw new DshProtocolError("Discussion turn round 非法");
  }
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new DshProtocolError("Discussion turn attempt 非法");
  }
  if (input.kind === "persona" && !input.participantId) {
    throw new DshProtocolError("Persona turn 缺少 participantId");
  }
  if (input.kind === "moderator" && input.participantId !== null) {
    throw new DshProtocolError("Moderator turn 不得绑定 participantId");
  }
}

/** Mark the current durable turn and participant failed without deleting events. */
async function markDshTurnFailed(
  input: RunDiscussionDshTurnInput,
  turnId: string,
  eventsWritten: number,
  error: unknown,
): Promise<RunDiscussionDshTurnResult> {
  const details = errorDetails(error);
  const canWriteFailure = details.code !== "DISCUSSION_RUN_LEASE_LOST"
    || await isDiscussionRunOwner(input.discussionId, input.runId);
  if (canWriteFailure) {
    await prisma.discussionTurn.update({
      where: { id: turnId },
      data: {
        status: "failed",
        errorCode: details.code,
        errorMessage: details.message,
        completedAt: new Date(),
      },
    }).catch(() => undefined);
  }

  if (
    canWriteFailure
    && input.participantId
    && details.code !== "DSH_SESSION_BUSY"
    && details.code !== "DISCUSSION_ARCHIVED"
  ) {
    await prisma.discussionParticipant.update({
      where: { id: input.participantId },
      data: { status: "failed", lastError: details.message },
    }).catch(() => undefined);
  }

  return {
    turnId,
    participantId: input.participantId,
    sessionId: input.sessionId,
    finalText: "",
    eventsWritten,
    status: "failed",
    errorCode: details.code,
    error: details.message,
  };
}

/**
 * Run one Discussion turn on its stable DSH session.
 *
 * The finalResponse returned by the child is only a transport convenience.
 * Completion is accepted exclusively after the durable event stream contains
 * a non-empty assistant/message and a completed turn/end event.
 */
export async function runDiscussionDshTurn(
  input: RunDiscussionDshTurnInput,
): Promise<RunDiscussionDshTurnResult> {
  validateInput(input);
  if (!(await isDiscussionRunOwner(input.discussionId, input.runId))) {
    throw new DiscussionRunLeaseLostError();
  }

  const turn = await prisma.discussionTurn.create({
    data: {
      discussionId: input.discussionId,
      runId: input.runId,
      participantId: input.participantId,
      sessionId: input.sessionId,
      kind: input.kind,
      round: input.round,
      attempt: input.attempt,
      inputSnapshot: input.inputSnapshot,
      status: "running",
    },
  });

  let eventsWritten = 0;
  let finalText = "";
  let finalSourceEventId: string | null = null;
  let completedTurnEnd = false;

  try {
    const config = await getDiscussionSessionConfig();
    const manager = getDiscussionSessionManager();
    const result = await manager.run({
      discussionId: input.discussionId,
      participantId: input.participantId,
      sessionId: input.sessionId,
      prompt: input.prompt,
      profile: config.profile,
      processOptions: config.processOptions,
      onNotification: async (notification: DshNotification) => {
        const mapped = extractMappedEvent(notification);
        if (!mapped) {
          // Non-session notifications (for example session.status) are useful
          // to the process manager but are not durable Discussion events.
          if (notification.method !== "session.event") return;
          throw new DshProtocolError("DSH session.event 通知非法");
        }
        if (mapped.sessionId !== input.sessionId) {
          throw new DshProtocolError(`DSH 事件 session 不匹配：${mapped.sessionId}`);
        }

        const ingested = await ingestDiscussionEvent({
          discussionId: input.discussionId,
          participantId: input.participantId,
          notification,
        });
        if (ingested.inserted) eventsWritten += 1;
        if (ingested.finalText.trim() && ingested.sourceEventId) {
          finalText = ingested.finalText;
          finalSourceEventId = ingested.sourceEventId;
        }
        if (mapped.eventType === "turn/end") {
          completedTurnEnd = isCompletedTurnEnd(mapped.data);
          if (!completedTurnEnd) {
            throw new DshTurnError("DSH turn/end 未以 completed 结束");
          }
        }
      },
    });

    if (result.sessionId !== input.sessionId) {
      throw new DshProtocolError(`DSH runner 返回 session 不匹配：${result.sessionId}`);
    }
    if (!completedTurnEnd) {
      throw new DshTurnError("DSH 未收到正常 turn/end");
    }
    if (!finalText.trim() || !finalSourceEventId) {
      throw new DshTurnError("DSH 未收到非空 assistant/message");
    }
    if (!(await isDiscussionRunOwner(input.discussionId, input.runId))) {
      throw new DiscussionRunLeaseLostError();
    }

    const message = await prisma.discussionMessage.update({
      where: { sourceEventId: finalSourceEventId },
      data: { turn: input.round, attempt: input.attempt },
      select: { id: true },
    });
    await prisma.discussionTurn.update({
      where: { id: turn.id },
      data: {
        status: "completed",
        outputMessageId: message.id,
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
      },
    });
    if (input.participantId) {
      await prisma.discussionParticipant.update({
        where: { id: input.participantId },
        data: { status: "completed", lastError: null },
      });
    }

    return {
      turnId: turn.id,
      participantId: input.participantId,
      sessionId: input.sessionId,
      finalText: finalText.trim(),
      eventsWritten,
      status: "completed",
      outputMessageId: message.id,
    };
  } catch (error) {
    return markDshTurnFailed(input, turn.id, eventsWritten, error);
  }
}
