import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participantFindFirst: vi.fn(),
  turnFindFirst: vi.fn(),
  discussionFindUnique: vi.fn(),
  discussionUpdate: vi.fn(),
  participantUpdate: vi.fn(),
  ensurePersonaSession: vi.fn(),
  runDiscussionDshTurn: vi.fn(),
  managerIsBusy: vi.fn(),
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
    },
    discussionMessage: {},
  },
}));

vi.mock("@/lib/discussion/dsh-service", () => ({
  ensurePersonaSession: (...args: unknown[]) => mocks.ensurePersonaSession(...args),
}));

vi.mock("@/lib/discussion/run-dsh-turn", () => ({
  runDiscussionDshTurn: (...args: unknown[]) => mocks.runDiscussionDshTurn(...args),
}));

vi.mock("@/lib/runtime/singleton", () => ({
  getDiscussionSessionManager: () => ({ isBusy: (...args: unknown[]) => mocks.managerIsBusy(...args) }),
}));

import { POST } from "@/app/api/v1/discussions/[id]/participants/[participantId]/retry/route";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.participantFindFirst.mockResolvedValue({ id: "participant-1", discussionId: "d1", personaId: "p1", dshSessionId: "bt-discussion-d1-p1", status: "failed" });
  mocks.turnFindFirst.mockResolvedValue({
    id: "failed-turn-1",
    attempt: 1,
    round: 0,
    status: "failed",
    inputSnapshot: { prompt: "原始问题" },
  });
  mocks.discussionFindUnique.mockResolvedValue({ id: "d1", personaIds: ["p1"], status: "failed" });
  mocks.discussionUpdate.mockResolvedValue({});
  mocks.ensurePersonaSession.mockResolvedValue({ participant: { id: "participant-1", dshSessionId: "bt-discussion-d1-p1" }, persona: { name: "测试人格" } });
  mocks.participantUpdate.mockResolvedValue({});
  mocks.runDiscussionDshTurn.mockResolvedValue({
    turnId: "retry-turn-1",
    participantId: "participant-1",
    sessionId: "bt-discussion-d1-p1",
    finalText: "重试成功",
    eventsWritten: 4,
    status: "completed",
    outputMessageId: "retry-message-1",
  });
  mocks.managerIsBusy.mockReturnValue(false);
});

describe("participant retry route", () => {
  it("restores a failed one-on-one discussion to ready after a successful retry", async () => {
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "d1", participantId: "participant-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.ensurePersonaSession).toHaveBeenCalledWith("d1", "p1");
    expect(mocks.runDiscussionDshTurn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "bt-discussion-d1-p1",
      attempt: 2,
      prompt: "原始问题",
      inputSnapshot: { prompt: "原始问题" },
    }));
    expect(mocks.discussionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { status: "ready" },
    });
  });

  it("rejects a retry while the stable session is busy", async () => {
    mocks.managerIsBusy.mockReturnValue(true);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "d1", participantId: "participant-1" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.runDiscussionDshTurn).not.toHaveBeenCalled();
  });
});
