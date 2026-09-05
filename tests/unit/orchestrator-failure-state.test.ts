import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discussionFindUnique: vi.fn(),
  discussionUpdate: vi.fn(),
  personaFindUnique: vi.fn(),
  participantUpdate: vi.fn(),
  turnCreate: vi.fn(),
  turnUpdate: vi.fn(),
  turnUpdateMany: vi.fn(),
  messageCreate: vi.fn(),
  runTurnViaDsh: vi.fn(),
  freshTurnSessionId: vi.fn(),
  ensurePersonaSession: vi.fn(),
  writeModeratorManifestForSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    discussion: {
      findUnique: (...args: unknown[]) => mocks.discussionFindUnique(...args),
      update: (...args: unknown[]) => mocks.discussionUpdate(...args),
    },
    persona: { findUnique: (...args: unknown[]) => mocks.personaFindUnique(...args) },
    discussionParticipant: {
      update: (...args: unknown[]) => mocks.participantUpdate(...args),
    },
    discussionTurn: {
      create: (...args: unknown[]) => mocks.turnCreate(...args),
      update: (...args: unknown[]) => mocks.turnUpdate(...args),
      updateMany: (...args: unknown[]) => mocks.turnUpdateMany(...args),
    },
    discussionMessage: { create: (...args: unknown[]) => mocks.messageCreate(...args) },
  },
}));

vi.mock("@/lib/discussion/dsh-service", () => ({
  runTurnViaDsh: (...args: unknown[]) => mocks.runTurnViaDsh(...args),
  freshTurnSessionId: (...args: unknown[]) => mocks.freshTurnSessionId(...args),
  ensurePersonaSession: (...args: unknown[]) => mocks.ensurePersonaSession(...args),
  writeModeratorManifestForSession: (...args: unknown[]) => mocks.writeModeratorManifestForSession(...args),
}));

vi.mock("@/lib/discussion/broadcast", () => ({
  publish: vi.fn(),
}));

import { runDiscussion } from "@/lib/discussion/orchestrator";
import { DshManifestError, DshProtocolError } from "@/lib/dsh/errors";

const discussion = {
  id: "d1",
  brief: "brief",
  rounds: 1,
  personaIds: ["p1"],
  stateVersion: 0,
  discussionState: null,
  moderatorSessionId: null,
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.discussionFindUnique.mockResolvedValue(discussion);
  mocks.discussionUpdate.mockResolvedValue({});
  mocks.personaFindUnique.mockResolvedValue({ id: "p1", name: "人格一", systemPrompt: "sys" });
  mocks.freshTurnSessionId.mockReturnValue("bt-turn-d1-p1-x");
  mocks.ensurePersonaSession.mockResolvedValue({ participant: { id: "participant-1" } });
  mocks.turnCreate.mockResolvedValue({ id: "turn-1" });
  mocks.turnUpdate.mockResolvedValue({});
  mocks.turnUpdateMany.mockResolvedValue({ count: 1 });
  mocks.participantUpdate.mockResolvedValue({});
  mocks.messageCreate.mockResolvedValue({ id: "message-1" });
});

describe("runDiscussion failure state", () => {
  it("marks the active persona turn and participant failed before terminating on fatal DSH errors", async () => {
    mocks.runTurnViaDsh.mockRejectedValue(new DshProtocolError("wire lost"));

    await runDiscussion("d1");

    expect(mocks.turnUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ participantId: "participant-1", status: "running" }),
        data: expect.objectContaining({ status: "failed", errorCode: "DSH_PROTOCOL_FAILED" }),
      })
    );
    expect(mocks.participantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "participant-1" },
        data: expect.objectContaining({ status: "failed" }),
      })
    );
    expect(mocks.discussionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });

  it("marks moderatorStatus failed when the moderator manifest cannot be created", async () => {
    mocks.runTurnViaDsh.mockResolvedValue("真实人格发言");
    mocks.writeModeratorManifestForSession.mockRejectedValue(new DshManifestError("manifest invalid"));

    await runDiscussion("d1");

    expect(mocks.discussionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", moderatorStatus: "failed" }),
      })
    );
  });
});
