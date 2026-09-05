import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const H = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// mock prisma：只暴露 discussionSkill/manifest 层
const mockDiscussionSkillFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    discussionSkill: { findMany: (...args: unknown[]) => mockDiscussionSkillFindMany(...args) },
    discussionParticipant: { update: vi.fn(), findUnique: vi.fn() },
  },
}));

// mock settings/config：getDshTurnConfig 需要 getSetting/decrypt
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

import {
  buildPersonaManifest,
} from "@/lib/discussion/dsh-service";
import type { PersonaSnapshot } from "@/lib/dsh/snapshot";
import { DshManifestError } from "@/lib/dsh/errors";

const snapshot: PersonaSnapshot = {
  systemPrompt: "sys",
  skillName: "persona-profile",
  skillVersion: "1.0.0",
  skillHash: H("persona-skill"),
  snapshotRoot: "data/dsh/snapshots/p1-abc",
  referenceIndex: [{ rel: "references/a.md", name: "a.md", size: 10, hash: H("ref-a") }],
};

const participant = { id: "participant-1", dshSessionId: "bt-discussion-d1-p1" };
const persona = { id: "p1", name: "测试者", systemPrompt: "sys" };

describe("dsh-service manifest (P0 Task 3)", () => {
  beforeEach(() => {
    mockDiscussionSkillFindMany.mockReset();
    mockDiscussionSkillFindMany.mockResolvedValue([]);
  });

  it("builds a persona manifest with only persona-profile when no DiscussionSkill exists", async () => {
    const m = await buildPersonaManifest("d1", participant, persona, snapshot, "bt-turn-d1-p1-x");
    expect(m.allowedSkills.map((s) => s.name)).toEqual(["persona-profile"]);
    expect(m.allowedSkills[0].contentHash).toBe(H("persona-skill"));
    // persona 块与 allowedSkills 的 persona-profile 一致
    expect(m.persona?.skillHash).toBe(m.allowedSkills[0].contentHash);
  });

  it("includes every DiscussionSkill revision and rejects duplicates/missing packageRoot", async () => {
    mockDiscussionSkillFindMany.mockResolvedValue([
      {
        id: "r1",
        skillRevision: {
          id: "r1",
          name: "market-research",
          version: "1.0.0",
          contentHash: H("market"),
          description: "d",
          packageRoot: "data/skill-library/market-research/1.0.0",
          manifest: {
            resources: [{ rel: "references/facts.md", name: "facts.md", kind: "reference", size: 5, hash: H("facts") }],
          },
        },
      },
    ]);
    const m = await buildPersonaManifest("d1", participant, persona, snapshot, "bt-turn-d1-p1-y");
    const allowed = m.allowedSkills.map((s) => s.name);
    expect(allowed).toContain("market-research");
    const mr = m.allowedSkills.find((s) => s.name === "market-research");
    expect(mr?.resourceIndex?.[0]?.rel).toBe("references/facts.md");
    expect(mr?.resourceIndex?.[0]?.hash).toBe(H("facts"));

    // 空 packageRoot → DshManifestError
    mockDiscussionSkillFindMany.mockResolvedValue([
      { id: "r2", skillRevision: { id: "r2", name: "uninstalled", version: "1.0.0", contentHash: H("u"), description: null, packageRoot: null, manifest: null } },
    ]);
    await expect(buildPersonaManifest("d1", participant, persona, snapshot, "bt-turn-d1-p1-z")).rejects.toThrow(
      DshManifestError
    );
  });

  it("rejects a revision whose name collides with persona-profile", async () => {
    mockDiscussionSkillFindMany.mockResolvedValue([
      {
        id: "r3",
        skillRevision: {
          id: "r3",
          name: "persona-profile",
          version: "2.0.0",
          contentHash: H("dup"),
          description: null,
          packageRoot: "data/skill-library/dup/2.0.0",
          manifest: { resources: [] },
        },
      },
    ]);
    await expect(buildPersonaManifest("d1", participant, persona, snapshot, "bt-turn-d1-p1-w")).rejects.toThrow(
      DshManifestError
    );
  });

  it("queries DiscussionSkill with discussionId ordered by createdAt", async () => {
    await buildPersonaManifest("d1", participant, persona, snapshot, "bt-turn-d1-p1-v");
    expect(mockDiscussionSkillFindMany).toHaveBeenCalledWith({
      where: { discussionId: "d1" },
      include: { skillRevision: true },
      orderBy: { createdAt: "asc" },
    });
  });

  it("produces a manifest that passes the strict parseManifest contract", async () => {
    mockDiscussionSkillFindMany.mockResolvedValue([
      {
        id: "r4",
        skillRevision: {
          id: "r4",
          name: "market-research",
          version: "1.0.0",
          contentHash: H("market2"),
          description: "d",
          packageRoot: "data/skill-library/market-research/1.0.0",
          manifest: { resources: [{ rel: "references/f.md", name: "f.md", kind: "reference", size: 3, hash: H("f") }] },
        },
      },
    ]);
    const m = await buildPersonaManifest("d1", participant, persona, snapshot, "bt-turn-d1-p1-u", {
      provider: "openai",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      profileHash: H("profile"),
    });
    const { parseManifest } = await import("@/lib/dsh/manifest");
    expect(() => parseManifest(m)).not.toThrow();
  });
});
