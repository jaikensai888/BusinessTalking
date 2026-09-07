import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  publish: vi.fn(),
}));

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  participants: new Map<string, Record<string, unknown>>(),
  nextSeq: 1,
  committed: false,
}));

const tx = vi.hoisted(() => ({
  agentEvent: {
    findUnique: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
  discussionEventCursor: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
  discussionParticipant: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  discussion: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  persona: {
    findUnique: vi.fn(),
  },
  discussionMessage: {
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mocks.transaction(...args),
    agentEvent: tx.agentEvent,
    discussionEventCursor: tx.discussionEventCursor,
  },
}));

vi.mock("@/lib/discussion/broadcast", () => ({
  publish: (...args: unknown[]) => mocks.publish(...args),
}));

import { getDiscussionEventCursor, ingestDiscussionEvent, listDiscussionEventsAfter } from "@/lib/discussion/event-ledger";
import { DshProtocolError } from "@/lib/dsh/errors";

function notification(
  sessionId: string,
  seq: number,
  eventType = "tool/call",
  data: Record<string, unknown> = {},
) {
  return {
    method: "session.event",
    params: {
      sessionId,
      event: { type: eventType, seq, time: 1_730_000_000_000 + seq, data },
    },
  };
}

function participantEvent(sessionId: string, seq: number, eventType = "tool/call", data?: Record<string, unknown>) {
  const participantId = sessionId === "session-a" ? "p1" : "p2";
  return { discussionId: "d1", participantId, notification: notification(sessionId, seq, eventType, data) };
}

beforeEach(() => {
  state.events = [];
  state.messages = [];
  state.participants = new Map([
    ["p1", { id: "p1", discussionId: "d1", personaId: "persona-1", dshSessionId: "session-a", lastEventSeq: 0 }],
    ["p2", { id: "p2", discussionId: "d1", personaId: "persona-2", dshSessionId: "session-b", lastEventSeq: 0 }],
  ]);
  state.nextSeq = 1;
  state.committed = false;

  mocks.publish.mockReset();
  mocks.publish.mockImplementation(() => {
    expect(state.committed).toBe(true);
  });
  mocks.transaction.mockReset();
  mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => {
    state.committed = false;
    try {
      const result = await callback(tx);
      state.committed = true;
      return result;
    } catch (error) {
      state.committed = false;
      throw error;
    }
  });

  tx.agentEvent.findUnique.mockReset().mockImplementation(async ({ where }: { where: { sessionId_seq: { sessionId: string; seq: number } } }) =>
    state.events.find((event) => event.sessionId === where.sessionId_seq.sessionId && event.seq === where.sessionId_seq.seq) ?? null,
  );
  tx.agentEvent.create.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `event-${state.events.length + 1}`, createdAt: new Date(), ...data };
    state.events.push(row);
    return row;
  });
  tx.agentEvent.findMany.mockReset().mockImplementation(async () => [...state.events].sort((a, b) => Number(a.discussionSeq) - Number(b.discussionSeq)));
  tx.discussionEventCursor.upsert.mockReset().mockImplementation(async ({ update, create }: { update: { nextSeq: { increment: number } }; create: { discussionId: string; nextSeq: number } }) => {
    const next = state.nextSeq;
    state.nextSeq += update.nextSeq.increment;
    return { discussionId: create.discussionId, nextSeq: next + 1 };
  });
  tx.discussionEventCursor.findUnique.mockReset().mockImplementation(async () => ({ discussionId: "d1", nextSeq: state.nextSeq }));
  tx.discussionParticipant.findUnique.mockReset().mockImplementation(async ({ where }: { where: { id: string } }) => state.participants.get(where.id) ?? null);
  tx.discussionParticipant.updateMany.mockReset().mockResolvedValue({ count: 1 });
  tx.discussion.findUnique.mockReset().mockResolvedValue({ id: "d1", moderatorSessionId: "moderator-1" });
  tx.discussion.updateMany.mockReset().mockResolvedValue({ count: 1 });
  tx.persona.findUnique.mockReset().mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: `Persona ${where.id}` }));
  tx.discussionMessage.upsert.mockReset().mockImplementation(async ({ create }: { create: Record<string, unknown> }) => {
    const existing = state.messages.find((message) => message.sourceEventId === create.sourceEventId);
    if (existing) return existing;
    const row = { id: `message-${state.messages.length + 1}`, ...create };
    state.messages.push(row);
    return row;
  });
});

describe("discussion DSH event ledger", () => {
  it("allocates one idempotent discussion cursor across sessions", async () => {
    const first = await ingestDiscussionEvent(participantEvent("session-a", 1));
    const duplicate = await ingestDiscussionEvent(participantEvent("session-a", 1));
    const second = await ingestDiscussionEvent(participantEvent("session-b", 1));

    expect(first.event?.discussionSeq).toBe(1);
    expect(duplicate.inserted).toBe(false);
    expect(duplicate.event?.discussionSeq).toBe(1);
    expect(second.event?.discussionSeq).toBe(2);
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(tx.discussionEventCursor.upsert).toHaveBeenCalledTimes(2);
    expect(await getDiscussionEventCursor("d1")).toBe(2);
  });

  it("publishes only after the transaction commits and does not project on rollback", async () => {
    tx.agentEvent.create.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(ingestDiscussionEvent(participantEvent("session-a", 1, "assistant/message", {
      message: { content: [{ type: "text", text: "must not persist" }] },
    }))).rejects.toThrow("database unavailable");

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(tx.discussionMessage.upsert).not.toHaveBeenCalled();
  });

  it("projects assistant/message idempotently with the source event id", async () => {
    const input = participantEvent("session-a", 1, "assistant/message", {
      message: { content: [{ type: "text", text: "answer" }] },
    });
    const first = await ingestDiscussionEvent(input);
    const duplicate = await ingestDiscussionEvent(input);

    expect(first.finalText).toBe("answer");
    expect(first.sourceEventId).toBe("event-1");
    expect(duplicate.sourceEventId).toBe("event-1");
    expect(tx.discussionMessage.upsert).toHaveBeenCalledTimes(1);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].sourceEventId).toBe("event-1");
  });

  it("replays event time and safe projection in discussion cursor order", async () => {
    await ingestDiscussionEvent(participantEvent("session-a", 1, "tool/call", { callId: "c1", name: "skill" }));
    await ingestDiscussionEvent(participantEvent("session-a", 2, "tool/result", { callId: "c1", status: "done", output: "ok" }));
    await ingestDiscussionEvent(participantEvent("session-a", 3, "assistant/chunk", {
      content: [{ type: "reasoning", text: "emitted" }],
    }));

    const events = await listDiscussionEventsAfter("d1", 0);
    expect(events.map((event) => event.discussionSeq)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.eventTimeMs)).toEqual([1730000000001, 1730000000002, 1730000000003]);
    expect(events[0].data).toEqual({ callId: "c1", name: "skill" });
  });

  it("rejects participant/session mismatch and enforces moderator session identity", async () => {
    await expect(ingestDiscussionEvent({
      discussionId: "d1",
      participantId: "p1",
      notification: notification("session-b", 1),
    })).rejects.toBeInstanceOf(DshProtocolError);

    await expect(ingestDiscussionEvent({
      discussionId: "d1",
      participantId: null,
      notification: notification("not-the-moderator", 1),
    })).rejects.toBeInstanceOf(DshProtocolError);

    const accepted = await ingestDiscussionEvent({
      discussionId: "d1",
      participantId: null,
      notification: notification("moderator-1", 1),
    });
    expect(accepted.event?.participantId).toBeNull();
  });
});
