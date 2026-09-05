import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participantFindFirst: vi.fn(),
  turnFindFirst: vi.fn(),
  discussionFindUnique: vi.fn(),
  discussionUpdate: vi.fn(),
  turnCreate: vi.fn(),
  turnUpdate: vi.fn(),
  participantUpdate: vi.fn(),
  messageCreate: vi.fn(),
  ensurePersonaSession: vi.fn(),
  freshTurnSessionId: vi.fn(),
  runTurnViaDsh: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    discussion: {
      findUnique: (...args: unknown[]) => mocks.discussionFindUnique(...args),
      update: (...args: unknown[]) => mocks.discussionUpdate(...args),
    },
    discussionParticipant: {
      findFirst: (...args: unknown[]) => mocks.participantFindFirst(...args),
      update: (...args: unknown[]) => mocks.participantUpdate(...args),
    },
    discussionTurn: {
      findFirst: (...args: unknown[]) => mocks.turnFindFirst(...args),
      create: (...args: unknown[]) => mocks.turnCreate(...args),
      update: (...args: unknown[]) => mocks.turnUpdate(...args),
    },
    discussionMessage: { create: (...args: unknown[]) => mocks.messageCreate(...args) },
  },
}));

vi.mock("@/lib/discussion/dsh-service", () => ({
  ensurePersonaSession: (...args: unknown[]) => mocks.ensurePersonaSession(...args),
  freshTurnSessionId: (...args: unknown[]) => mocks.freshTurnSessionId(...args),
  runTurnViaDsh: (...args: unknown[]) => mocks.runTurnViaDsh(...args),
}));

import { POST } from "@/app/api/v1/discussions/[id]/participants/[participantId]/retry/route";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.participantFindFirst.mockResolvedValue({ id: "participant-1", discussionId: "d1", personaId: "p1", status: "failed" });
  mocks.turnFindFirst.mockResolvedValue({
    id: "failed-turn-1",
    attempt: 1,
    round: 0,
    status: "failed",
    inputSnapshot: { prompt: "原始问题" },
  });
  mocks.discussionFindUnique.mockResolvedValue({ id: "d1", personaIds: ["p1"], status: "failed" });
  mocks.discussionUpdate.mockResolvedValue({});
  mocks.ensurePersonaSession.mockResolvedValue({ persona: { name: "测试人格" } });
  mocks.freshTurnSessionId.mockReturnValue("bt-turn-d1-p1-retry");
  mocks.turnCreate.mockResolvedValue({ id: "retry-turn-1" });
  mocks.turnUpdate.mockResolvedValue({});
  mocks.participantUpdate.mockResolvedValue({});
  mocks.messageCreate.mockResolvedValue({ id: "retry-message-1" });
  mocks.runTurnViaDsh.mockResolvedValue("重试成功");
});

describe("participant retry route", () => {
  it("restores a failed one-on-one discussion to ready after a successful retry", async () => {
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "d1", participantId: "participant-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.discussionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { status: "ready" },
    });
  });
});
