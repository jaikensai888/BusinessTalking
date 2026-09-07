import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  extractAssistantText,
  type DshNotification,
} from "@/lib/dsh/events";
import { DshProtocolError } from "@/lib/dsh/errors";
import {
  extractMappedEvent,
  projectClientEvent,
  type DiscussionLiveEvent,
  type MappedSessionEvent,
} from "@/lib/dsh/session-events";
import { publish } from "./broadcast";

const MAX_EVENT_PAYLOAD_BYTES = 512 * 1024;

export interface IngestDiscussionEventInput {
  discussionId: string;
  participantId: string | null;
  notification: DshNotification;
}

export interface IngestDiscussionEventResult {
  inserted: boolean;
  event: DiscussionLiveEvent | null;
  finalText: string;
  sourceEventId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function protocolFailure(message: string): never {
  throw new DshProtocolError(message);
}

function assertPayloadSize(mapped: MappedSessionEvent): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(mapped.data);
  } catch {
    protocolFailure("DSH 事件 payload 不可序列化");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_PAYLOAD_BYTES) {
    protocolFailure("DSH 事件 payload 超过大小上限");
  }
}

function toMappedEvent(row: {
  sessionId: string;
  seq: number;
  eventType: string;
  eventTimeMs: number | null;
  payload: unknown;
}): MappedSessionEvent {
  return {
    sessionId: row.sessionId,
    seq: row.seq,
    eventType: row.eventType,
    eventTimeMs: typeof row.eventTimeMs === "number" && Number.isFinite(row.eventTimeMs) ? row.eventTimeMs : null,
    data: asRecord(row.payload),
  };
}

function toLiveEvent(
  discussionId: string,
  participantId: string | null,
  discussionSeq: number | null,
  mapped: MappedSessionEvent,
): DiscussionLiveEvent | null {
  if (discussionSeq === null || !Number.isSafeInteger(discussionSeq) || discussionSeq < 1) return null;
  return {
    type: "dsh-event",
    discussionId,
    discussionSeq,
    participantId,
    sessionId: mapped.sessionId,
    seq: mapped.seq,
    eventType: mapped.eventType,
    eventTimeMs: mapped.eventTimeMs,
    data: projectClientEvent(mapped),
  };
}

function sameParticipant(row: { participantId: string | null }, participantId: string | null): boolean {
  return (row.participantId ?? null) === participantId;
}

async function projectAssistantMessage(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: IngestDiscussionEventInput,
  mapped: MappedSessionEvent,
  eventId: string,
  participant: { id: string; personaId: string } | null,
): Promise<{ finalText: string; sourceEventId: string | null }> {
  if (mapped.eventType !== "assistant/message") return { finalText: "", sourceEventId: null };
  const finalText = extractAssistantText(mapped.data).trim();
  if (!finalText) return { finalText: "", sourceEventId: null };

  let sender = "Moderator";
  let role = "summary";
  if (participant) {
    const persona = await tx.persona.findUnique({
      where: { id: participant.personaId },
      select: { name: true },
    });
    sender = persona?.name ?? participant.personaId;
    role = "persona";
  }

  await tx.discussionMessage.upsert({
    where: { sourceEventId: eventId },
    update: {},
    create: {
      discussionId: input.discussionId,
      personaId: participant?.personaId ?? null,
      participantId: participant?.id ?? null,
      sessionId: mapped.sessionId,
      sender,
      role,
      turn: 0,
      attempt: 1,
      content: finalText,
      sourceEventId: eventId,
    },
  });
  return { finalText, sourceEventId: eventId };
}

async function ingestOnce(
  input: IngestDiscussionEventInput,
  mapped: MappedSessionEvent,
): Promise<IngestDiscussionEventResult> {
  return prisma.$transaction(async (tx) => {
    let participant: { id: string; discussionId: string; personaId: string; dshSessionId: string; lastEventSeq: number } | null = null;
    if (input.participantId) {
      participant = await tx.discussionParticipant.findUnique({ where: { id: input.participantId } });
      if (
        !participant ||
        participant.discussionId !== input.discussionId ||
        participant.dshSessionId !== mapped.sessionId
      ) {
        protocolFailure(
          `DSH participant/session 不匹配：participant=${input.participantId}, session=${mapped.sessionId}`,
        );
      }
    } else {
      const discussion = await tx.discussion.findUnique({
        where: { id: input.discussionId },
        select: { moderatorSessionId: true },
      });
      if (!discussion || discussion.moderatorSessionId !== mapped.sessionId) {
        protocolFailure(`DSH moderator/session 不匹配：session=${mapped.sessionId}`);
      }
    }

    const existing = await tx.agentEvent.findUnique({
      where: { sessionId_seq: { sessionId: mapped.sessionId, seq: mapped.seq } },
    });
    if (existing) {
      if (
        existing.discussionId !== input.discussionId ||
        !sameParticipant(existing, input.participantId)
      ) {
        protocolFailure(`DSH 事件身份冲突：session=${mapped.sessionId}, seq=${mapped.seq}`);
      }
      const existingMapped = toMappedEvent(existing);
      const finalText = existingMapped.eventType === "assistant/message"
        ? extractAssistantText(existingMapped.data).trim()
        : "";
      return {
        inserted: false,
        event: toLiveEvent(
          input.discussionId,
          input.participantId,
          existing.discussionSeq,
          existingMapped,
        ),
        finalText,
        sourceEventId: finalText ? existing.id : null,
      };
    }

    const cursor = await tx.discussionEventCursor.upsert({
      where: { discussionId: input.discussionId },
      update: { nextSeq: { increment: 1 } },
      create: { discussionId: input.discussionId, nextSeq: 2 },
      select: { nextSeq: true },
    });
    const discussionSeq = cursor.nextSeq - 1;
    if (!Number.isSafeInteger(discussionSeq) || discussionSeq < 1) {
      protocolFailure(`Discussion event cursor 非法：${String(cursor.nextSeq)}`);
    }

    const created = await tx.agentEvent.create({
      data: {
        discussionId: input.discussionId,
        participantId: input.participantId,
        sessionId: mapped.sessionId,
        seq: mapped.seq,
        eventType: mapped.eventType,
        discussionSeq,
        eventTimeMs: mapped.eventTimeMs,
        payload: mapped.data as Prisma.InputJsonValue,
      },
    });

    if (participant && mapped.seq > (participant.lastEventSeq ?? 0)) {
      await tx.discussionParticipant.updateMany({
        where: {
          id: participant.id,
          discussionId: input.discussionId,
          dshSessionId: mapped.sessionId,
        },
        data: { lastEventSeq: mapped.seq },
      });
    }

    if (!participant) {
      await tx.discussion.updateMany({
        where: { id: input.discussionId, moderatorSessionId: mapped.sessionId },
        data: { moderatorLastEventSeq: mapped.seq },
      });
    }

    const projection = await projectAssistantMessage(
      tx,
      input,
      mapped,
      created.id,
      participant ? { id: participant.id, personaId: participant.personaId } : null,
    );
    return {
      inserted: true,
      event: toLiveEvent(input.discussionId, input.participantId, discussionSeq, mapped),
      ...projection,
    };
  });
}

/**
 * Validate, transactionally persist and (only after commit) broadcast one DSH
 * session event. Replaying the same `(sessionId, seq)` is deliberately silent.
 */
export async function ingestDiscussionEvent(
  input: IngestDiscussionEventInput,
): Promise<IngestDiscussionEventResult> {
  const mapped = extractMappedEvent(input.notification);
  if (!mapped) protocolFailure("DSH session.event 通知非法或缺少 session/seq/type");
  if (mapped.sessionId !== input.notification.params.sessionId) {
    protocolFailure("DSH 事件 sessionId 不一致");
  }
  assertPayloadSize(mapped);

  let result: IngestDiscussionEventResult | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      result = await ingestOnce(input, mapped);
      break;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002" && attempt === 0) continue;
      throw error;
    }
  }
  if (!result) protocolFailure("DSH 事件写入未返回结果");
  if (result.inserted && result.event) publish(input.discussionId, result.event);
  return result;
}

/** Return the latest committed Discussion event sequence, or zero for an empty discussion. */
export async function getDiscussionEventCursor(discussionId: string): Promise<number> {
  const cursor = await prisma.discussionEventCursor.findUnique({
    where: { discussionId },
    select: { nextSeq: true },
  });
  if (!cursor) return 0;
  return Math.max(0, cursor.nextSeq - 1);
}

/** List only client-projected, replayable events after a Discussion cursor. */
export async function listDiscussionEventsAfter(
  discussionId: string,
  afterDiscussionSeq: number,
): Promise<DiscussionLiveEvent[]> {
  if (!Number.isSafeInteger(afterDiscussionSeq) || afterDiscussionSeq < 0) {
    protocolFailure("Discussion event cursor 必须是非负安全整数");
  }
  const rows = await prisma.agentEvent.findMany({
    where: {
      discussionId,
      discussionSeq: { gt: afterDiscussionSeq, not: null },
    },
    orderBy: { discussionSeq: "asc" },
    select: {
      discussionId: true,
      discussionSeq: true,
      participantId: true,
      sessionId: true,
      seq: true,
      eventType: true,
      eventTimeMs: true,
      payload: true,
    },
  });
  return rows.flatMap((row) => {
    const mapped = toMappedEvent(row);
    const event = toLiveEvent(row.discussionId, row.participantId, row.discussionSeq, mapped);
    return event ? [event] : [];
  });
}
