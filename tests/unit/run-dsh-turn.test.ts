import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  turnCreate: vi.fn(),
  turnUpdate: vi.fn(),
  messageUpdate: vi.fn(),
  participantUpdate: vi.fn(),
  discussionUpdate: vi.fn(),
  getDiscussionSessionConfig: vi.fn(),
  getDiscussionSessionManager: vi.fn(),
  ingestDiscussionEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    discussionTurn: {
      create: (...args: unknown[]) => mocks.turnCreate(...args),
      update: (...args: unknown[]) => mocks.turnUpdate(...args),
    },
    discussionMessage: {
      update: (...args: unknown[]) => mocks.messageUpdate(...args),
    },
    discussionParticipant: {
      update: (...args: unknown[]) => mocks.participantUpdate(...args),
    },
    discussion: {
      update: (...args: unknown[]) => mocks.discussionUpdate(...args),
    },
  },
}));

vi.mock("@/lib/runtime/singleton", () => ({
  getDiscussionSessionConfig: (...args: unknown[]) => mocks.getDiscussionSessionConfig(...args),
  getDiscussionSessionManager: (...args: unknown[]) => mocks.getDiscussionSessionManager(...args),
}));

vi.mock("@/lib/discussion/event-ledger", () => ({
  ingestDiscussionEvent: (...args: unknown[]) => mocks.ingestDiscussionEvent(...args),
}));

vi.mock("@/lib/discussion/broadcast", () => ({ publish: vi.fn() }));

import { runDiscussionDshTurn } from "@/lib/discussion/run-dsh-turn";
import { DshProtocolError, DshSessionBusyError } from "@/lib/dsh/errors";

const PROFILE = { provider: "openai", model: "deepseek-chat", profileHash: "profile-1" };
const PROCESS_OPTIONS = {
  cwd: "G:/project",
  dshBin: "G:/project/node_modules/.bin/dsh",
  dshHome: "G:/project/data/dsh-home",
  patches: ["G:/project/patch.yml"],
  provider: "deepseek-official",
  model: "deepseek-chat",
};

function notification(sessionId: string, seq: number, eventType: string, data: Record<string, unknown> = {}) {
  return {
    method: "session.event",
    params: { sessionId, event: { type: eventType, seq, time: seq, data } },
  };
}

function input(overrides: Partial<Parameters<typeof runDiscussionDshTurn>[0]> = {}) {
  return {
    discussionId: "d1",
    participantId: "p1",
    sessionId: "stable-session-p1",
    kind: "persona" as const,
    round: 2,
    attempt: 1,
    prompt: "原始 prompt",
    inputSnapshot: { prompt: "原始 prompt", stateVersion: 3 } as never,
    personaId: "persona-1",
    sender: "人格一",
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.turnCreate.mockResolvedValue({ id: "turn-1" });
  mocks.turnUpdate.mockResolvedValue({});
  mocks.messageUpdate.mockResolvedValue({ id: "message-1" });
  mocks.participantUpdate.mockResolvedValue({});
  mocks.discussionUpdate.mockResolvedValue({});
  mocks.getDiscussionSessionConfig.mockResolvedValue({ profile: PROFILE, processOptions: PROCESS_OPTIONS });
  mocks.ingestDiscussionEvent.mockResolvedValue({
    inserted: true,
    event: { type: "dsh-event" },
    finalText: "来自 assistant/message 的真实回复",
    sourceEventId: "event-assistant-2",
  });
});

describe("runDiscussionDshTurn", () => {
  it("uses the stable session, ingests every event before callback completion, and records actual writes", async () => {
    const order: string[] = [];
    const manager = {
      run: vi.fn(async (runInput: { sessionId: string; onNotification: (n: unknown) => Promise<void> }) => {
        expect(runInput.sessionId).toBe("stable-session-p1");
        await runInput.onNotification(notification("stable-session-p1", 7, "assistant/message", {
          message: { content: [{ type: "text", text: "来自 assistant/message 的真实回复" }] },
        }));
        order.push("manager-after-assistant");
        await runInput.onNotification(notification("stable-session-p1", 8, "turn/end", {
          turn: 2,
          reason: { kind: "completed" },
        }));
        order.push("manager-after-end");
        return { sessionId: runInput.sessionId, finalResponse: "仅 runner finalResponse" };
      }),
    };
    mocks.getDiscussionSessionManager.mockReturnValue(manager);
    mocks.ingestDiscussionEvent.mockImplementation(async () => {
      order.push("ingest");
      return {
        inserted: true,
        event: { type: "dsh-event" },
        finalText: "来自 assistant/message 的真实回复",
        sourceEventId: "event-assistant-2",
      };
    });

    const result = await runDiscussionDshTurn(input());

    expect(result).toMatchObject({
      turnId: "turn-1",
      sessionId: "stable-session-p1",
      finalText: "来自 assistant/message 的真实回复",
      eventsWritten: 2,
      status: "completed",
    });
    expect(order).toEqual(["ingest", "manager-after-assistant", "ingest", "manager-after-end"]);
    expect(manager.run).toHaveBeenCalledWith(expect.objectContaining({
      discussionId: "d1",
      participantId: "p1",
      sessionId: "stable-session-p1",
      profile: PROFILE,
      processOptions: PROCESS_OPTIONS,
    }));
    expect(mocks.messageUpdate).toHaveBeenCalledWith({
      where: { sourceEventId: "event-assistant-2" },
      data: { turn: 2, attempt: 1 },
      select: { id: true },
    });
    expect(mocks.turnUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "turn-1" },
      data: expect.objectContaining({ status: "completed", outputMessageId: "message-1" }),
    }));
  });

  it("fails when runner finalResponse exists without a real assistant/message and completed turn/end", async () => {
    const manager = {
      run: vi.fn(async (runInput: { sessionId: string; onNotification: (n: unknown) => Promise<void> }) => {
        await runInput.onNotification(notification("stable-session-p1", 1, "turn/start", { turn: 1 }));
        return { sessionId: runInput.sessionId, finalResponse: "伪造 final response" };
      }),
    };
    mocks.getDiscussionSessionManager.mockReturnValue(manager);
    mocks.ingestDiscussionEvent.mockResolvedValue({ inserted: true, event: { type: "dsh-event" }, finalText: "", sourceEventId: null });

    const result = await runDiscussionDshTurn(input());

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("DSH_TURN_FAILED");
    expect(mocks.turnUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", errorCode: "DSH_TURN_FAILED" }),
    }));
    expect(mocks.participantUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
  });

  it("maps fatal runner errors to failed turn and never uses a fallback generator", async () => {
    const manager = { run: vi.fn().mockRejectedValue(new DshProtocolError("wire lost")) };
    mocks.getDiscussionSessionManager.mockReturnValue(manager);

    const result = await runDiscussionDshTurn(input());

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("DSH_PROTOCOL_FAILED");
    expect(mocks.turnUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", errorCode: "DSH_PROTOCOL_FAILED" }),
    }));
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
  });

  it("records session busy as a conflict without poisoning the participant", async () => {
    const manager = { run: vi.fn().mockRejectedValue(new DshSessionBusyError()) };
    mocks.getDiscussionSessionManager.mockReturnValue(manager);

    const result = await runDiscussionDshTurn(input());

    expect(result).toMatchObject({ status: "failed", errorCode: "DSH_SESSION_BUSY" });
    expect(mocks.participantUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
  });
});
