import { beforeEach, describe, expect, it, vi } from "vitest";
import { DshProtocolError, DshTurnError } from "@/lib/dsh/errors";
import { emptyState } from "@/lib/discussion/state";

const mocks = vi.hoisted(() => ({
  personaFindUnique: vi.fn(),
  participantUpdate: vi.fn(),
  participantFindFirst: vi.fn(),
  turnUpdateMany: vi.fn(),
  ensurePersonaSession: vi.fn(),
  runDiscussionDshTurn: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    persona: { findUnique: (...args: unknown[]) => mocks.personaFindUnique(...args) },
    discussionParticipant: {
      update: (...args: unknown[]) => mocks.participantUpdate(...args),
      findFirst: (...args: unknown[]) => mocks.participantFindFirst(...args),
    },
    discussionTurn: { updateMany: (...args: unknown[]) => mocks.turnUpdateMany(...args) },
  },
}));

vi.mock("@/lib/discussion/dsh-service", () => ({
  ensurePersonaSession: (...args: unknown[]) => mocks.ensurePersonaSession(...args),
}));

vi.mock("@/lib/discussion/run-dsh-turn", () => ({
  runDiscussionDshTurn: (...args: unknown[]) => mocks.runDiscussionDshTurn(...args),
}));

vi.mock("@/lib/discussion/broadcast", () => ({ publish: vi.fn() }));

import { runPersonaRound } from "@/lib/discussion/orchestrator";

const state = emptyState("brief");

function completed(personaId: string) {
  return {
    turnId: `turn-${personaId}`,
    participantId: `participant-${personaId}`,
    sessionId: `session-${personaId}`,
    finalText: `answer-${personaId}`,
    eventsWritten: 2,
    status: "completed" as const,
    outputMessageId: `message-${personaId}`,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  process.env.BT_DSH_MAX_PARALLEL_PERSONAS = "4";
  mocks.personaFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    name: where.id,
    systemPrompt: "system",
  }));
  mocks.ensurePersonaSession.mockImplementation(async (_discussionId: string, personaId: string) => ({
    participant: { id: `participant-${personaId}`, dshSessionId: `session-${personaId}` },
  }));
  mocks.participantUpdate.mockResolvedValue({});
  mocks.participantFindFirst.mockResolvedValue(null);
  mocks.turnUpdateMany.mockResolvedValue({ count: 0 });
});

describe("parallel Persona round executor", () => {
  it("starts every Persona from one immutable state snapshot and preserves result order", async () => {
    const started: string[] = [];
    const releaseByPersona = new Map<string, () => void>();
    mocks.runDiscussionDshTurn.mockImplementation(async (input: { personaId: string }) => {
      started.push(input.personaId);
      await new Promise<void>((resolveTurn) => releaseByPersona.set(input.personaId, resolveTurn));
      return completed(input.personaId);
    });

    const running = runPersonaRound({
      discussionId: "d1",
      runId: "run-1",
      round: 1,
      state,
      brief: "brief",
      personaIds: ["p1", "p2", "p3"],
      stateVersion: 7,
    });

    await vi.waitFor(() => expect(started).toHaveLength(3));
    expect(new Set(mocks.runDiscussionDshTurn.mock.calls.map(([input]) => input.inputSnapshot.stateVersion))).toEqual(new Set([7]));
    expect(new Set(mocks.runDiscussionDshTurn.mock.calls.map(([input]) => input.inputSnapshot.runId))).toEqual(new Set(["run-1"]));
    expect(mocks.runDiscussionDshTurn.mock.calls.every(([input]) => input.prompt.includes("（尚无，本轮你是第一个发言的）"))).toBe(true);

    releaseByPersona.get("p3")?.();
    releaseByPersona.get("p1")?.();
    releaseByPersona.get("p2")?.();
    const results = await running;
    expect(results.map((result) => result.personaId)).toEqual(["p1", "p2", "p3"]);
  });

  it("continues after DSH_TURN_FAILED but rejects a fatal runtime error", async () => {
    mocks.runDiscussionDshTurn.mockImplementation(async (input: { personaId: string }) => {
      if (input.personaId === "p1") throw new DshTurnError("model failed");
      return completed(input.personaId);
    });
    const recoverable = await runPersonaRound({
      discussionId: "d1",
      runId: "run-1",
      round: 1,
      state,
      brief: "brief",
      personaIds: ["p1", "p2"],
      stateVersion: 0,
    });
    expect(recoverable).toMatchObject([
      { personaId: "p1", status: "failed", errorCode: "DSH_TURN_FAILED" },
      { personaId: "p2", status: "completed" },
    ]);

    mocks.runDiscussionDshTurn.mockReset().mockImplementation(async (input: { personaId: string }) => {
      if (input.personaId === "p1") throw new DshProtocolError("wire lost");
      return completed(input.personaId);
    });
    await expect(runPersonaRound({
      discussionId: "d1",
      runId: "run-2",
      round: 1,
      state,
      brief: "brief",
      personaIds: ["p1", "p2"],
      stateVersion: 0,
    })).rejects.toBeInstanceOf(DshProtocolError);
  });
});
