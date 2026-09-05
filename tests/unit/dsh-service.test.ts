import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const mocks = vi.hoisted(() => {
  return {
    mockPersonaFindUnique: vi.fn(),
    mockMessageCreate: vi.fn(),
    mockTurnCreate: vi.fn(),
    mockTurnUpdateMany: vi.fn(),
    mockParticipantUpdate: vi.fn(),
    mockParticipantFindFirst: vi.fn(),
    mockParticipantFindUnique: vi.fn(),
    mockParticipantCreate: vi.fn(),
    mockDiscussionUpdate: vi.fn(),
    mockDiscussionFindUnique: vi.fn(),
    mockTurnUpdate: vi.fn(),
    mockRunTurnViaProcess: vi.fn(),
  };
});

const {
  mockPersonaFindUnique,
  mockMessageCreate,
  mockTurnCreate,
  mockTurnUpdateMany,
  mockParticipantUpdate,
  mockParticipantFindFirst,
  mockParticipantFindUnique,
  mockParticipantCreate,
  mockDiscussionUpdate,
  mockDiscussionFindUnique,
  mockTurnUpdate,
  mockRunTurnViaProcess,
} = mocks;

vi.mock("@/lib/db", () => ({
  prisma: {
    discussion: {
      findUnique: (...a: unknown[]) => mockDiscussionFindUnique(...a),
      update: (...a: unknown[]) => mockDiscussionUpdate(...a),
    },
    discussionParticipant: {
      findUnique: (...a: unknown[]) => mockParticipantFindUnique(...a),
      create: (...a: unknown[]) => mockParticipantCreate(...a),
      update: (...a: unknown[]) => mockParticipantUpdate(...a),
      findFirst: (...a: unknown[]) => mockParticipantFindFirst(...a),
    },
    persona: { findUnique: (...a: unknown[]) => mockPersonaFindUnique(...a) },
    discussionSkill: { findMany: vi.fn(async () => []) },
    discussionMessage: { create: (...a: unknown[]) => mockMessageCreate(...a) },
    discussionTurn: {
      create: (...a: unknown[]) => mockTurnCreate(...a),
      update: (...a: unknown[]) => mockTurnUpdate(...a),
      updateMany: (...a: unknown[]) => mockTurnUpdateMany(...a),
    },
  },
}));

vi.mock("@/lib/settings/store", () => ({
  getSetting: vi.fn(async (key: string) => {
    switch (key) {
      case "llm.provider": return "openai";
      case "llm.baseUrl": return "https://api.deepseek.com";
      case "llm.apiKey": return "encrypted-key";
      case "llm.defaultModel": return "deepseek-chat";
      default: return null;
    }
  }),
}));
vi.mock("@/lib/settings/encryption", () => ({
  decrypt: vi.fn(() => "sk-test-not-real"),
}));
vi.mock("@/lib/discussion/broadcast", () => ({
  publish: vi.fn(),
}));
vi.mock("@/lib/runtime/turn-process", () => ({
  runTurnViaProcess: (...a: unknown[]) => mockRunTurnViaProcess(...a),
}));

import { runOneOnOneTurn } from "@/lib/discussion/dsh-service";
import { DshProtocolError } from "@/lib/dsh/errors";

const origCwd = process.cwd();

/** 建立 tmp cwd + persona skill 文件，使 ensurePersonaSnapshot 成功 */
function setupWorkingSnapshot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-svc-"));
  process.chdir(tmp);
  const skillRel = "personas/p1/SKILL.md";
  const skillAbs = path.join(tmp, skillRel);
  fs.mkdirSync(path.dirname(skillAbs), { recursive: true });
  fs.writeFileSync(skillAbs, "---\nname: p1\n---\n# persona skill", "utf8");
  return { tmp, skillRel };
}

function participantRow() {
  return { id: "participant-1", personaId: "p1", dshSessionId: "bt-discussion-d1-p1", status: "pending" };
}

function discussionRow() {
  return {
    id: "d1",
    brief: "brief",
    personaIds: ["p1"],
    stateVersion: 0,
    discussionState: {},
    archivedAt: null,
  };
}

describe("runOneOnOneTurn (P0 fail-closed)", () => {
  beforeEach(() => {
    mockMessageCreate.mockReset();
    mockTurnCreate.mockReset().mockResolvedValue({ id: "turn-1" });
    mockTurnUpdate.mockReset().mockResolvedValue({});
    mockTurnUpdateMany.mockReset().mockResolvedValue({});
    mockParticipantUpdate.mockReset().mockResolvedValue({});
    mockParticipantFindFirst.mockReset().mockResolvedValue(participantRow());
    mockParticipantFindUnique.mockReset().mockResolvedValue(participantRow());
    mockParticipantCreate.mockReset().mockImplementation(async (args: { data: unknown }) => ({
      ...(args.data as object),
      id: "participant-1",
    }));
    mockDiscussionUpdate.mockReset().mockResolvedValue({});
    mockDiscussionFindUnique.mockReset().mockResolvedValue(discussionRow());
    mockPersonaFindUnique.mockReset();
    mockRunTurnViaProcess.mockReset();
  });

  it("marks turn/participant/discussion failed when the DSH runner throws (no AI SDK fallback)", async () => {
    const { tmp, skillRel } = setupWorkingSnapshot();
    try {
      mockPersonaFindUnique.mockResolvedValue({ id: "p1", name: "测试", systemPrompt: "sys", skillPath: skillRel });
      mockRunTurnViaProcess.mockRejectedValue(new DshProtocolError("wire lost"));

      const res = await runOneOnOneTurn("d1", "p1", "问题？");

      expect(res.status).toBe("failed");
      expect(mockMessageCreate).not.toHaveBeenCalled(); // 没有 DiscussionMessage
      // turn 标记 failed（DSH_PROTOCOL_FAILED code）
      const turnUpdates = mockTurnUpdateMany.mock.calls.map(
        (c) => (c[0] as { data?: { status?: string; errorCode?: string } })?.data
      );
      expect(turnUpdates.some((d) => d?.status === "failed")).toBe(true);
      // participant 标记 failed
      const participantStatuses = mockParticipantUpdate.mock.calls.map(
        (c) => (c[0] as { data?: { status?: string } }).data?.status
      );
      expect(participantStatuses).toContain("failed");
      // discussion 标记 failed（1v1）
      expect(mockDiscussionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
      );
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails closed before creating a DiscussionMessage when pre-turn setup throws", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-svc-"));
    process.chdir(tmp);
    try {
      // persona skillPath 指向不存在文件 → ensurePersonaSnapshot 抛 DshManifestError（启动前失败）
      mockPersonaFindUnique.mockResolvedValue({ id: "p1", name: "测试", systemPrompt: "sys", skillPath: "missing/SKILL.md" });
      mockRunTurnViaProcess.mockResolvedValue({ sessionId: "x", finalResponse: "不该被调用" });

      const res = await runOneOnOneTurn("d1", "p1", "问题？");

      expect(res.status).toBe("failed");
      expect(mockMessageCreate).not.toHaveBeenCalled();
      expect(mockRunTurnViaProcess).not.toHaveBeenCalled(); // 未启动模型
      // participant/discussion 状态仍被标记 failed（不保持 ready）
      const participantStatuses = mockParticipantUpdate.mock.calls.map(
        (c) => (c[0] as { data?: { status?: string } }).data?.status
      );
      expect(participantStatuses).toContain("failed");
      expect(mockDiscussionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
      );
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects an empty/whitespace response without creating a message", async () => {
    const { tmp, skillRel } = setupWorkingSnapshot();
    try {
      mockPersonaFindUnique.mockResolvedValue({ id: "p1", name: "测试", systemPrompt: "sys", skillPath: skillRel });
      mockRunTurnViaProcess.mockResolvedValue({ sessionId: "bt-turn-d1-p1-x", finalResponse: "   " });

      const res = await runOneOnOneTurn("d1", "p1", "问题？");

      expect(res.status).toBe("failed");
      expect(mockMessageCreate).not.toHaveBeenCalled();
      // 空回复不产生 DiscussionMessage，turn 标记 failed
      const turnUpdates = mockTurnUpdateMany.mock.calls.map(
        (c) => (c[0] as { data?: { status?: string } })?.data
      );
      expect(turnUpdates.some((d) => d?.status === "failed")).toBe(true);
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
