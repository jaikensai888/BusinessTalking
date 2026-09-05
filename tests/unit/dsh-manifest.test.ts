import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  parseManifest,
  writeManifestAtomic,
  readManifest,
  deleteManifest,
  safeSessionFileName,
  type RuntimeSessionManifest,
} from "@/lib/dsh/manifest";
import { DshManifestError } from "@/lib/dsh/errors";

/** 目录隔离：把 manifestsRoot 指向临时目录，避免污染工作区 */
const origCwd = process.cwd();

const H = (seed: string) => crypto.createHash("sha256").update(seed).digest("hex");

function validManifest(overrides: Partial<RuntimeSessionManifest> = {}): RuntimeSessionManifest {
  const persona = {
    id: "p1",
    name: "xx",
    systemPrompt: "sys",
    skillName: "persona-profile",
    skillVersion: "1.0.0",
    skillHash: H("persona-skill"),
    snapshotRoot: "/tmp/snap",
    referenceIndex: [{ rel: "references/a.md", name: "a.md", size: 10, hash: H("ref-a") }],
  };
  return {
    schemaVersion: 1,
    sessionId: "bt-discussion-abc-p1",
    discussionId: "abc",
    participantId: "p1",
    kind: "persona",
    runtimeProfile: { provider: "openai", model: "gpt-4o", baseUrl: null, profileHash: H("profile") },
    persona,
    allowedSkills: [
      { name: "persona-profile", version: "1.0.0", contentHash: persona.skillHash, packageRoot: persona.snapshotRoot, description: "Persona: xx", resourceIndex: [] },
      { name: "market-research", version: "1.0.0", contentHash: H("market"), packageRoot: "/p", description: "d", resourceIndex: [] },
    ],
    toolPolicy: { webSearch: false, sideEffects: false },
    ...overrides,
  };
}

describe("dsh manifest", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-manifest-"));
    // 用临时目录承载 data/dsh/manifests
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses a valid manifest and rejects an invalid one", () => {
    const m = validManifest();
    expect(parseManifest(m).sessionId).toBe("bt-discussion-abc-p1");
    // schemaVersion 必须是 1
    expect(() => parseManifest({ ...m, schemaVersion: 2 })).toThrow(DshManifestError);
    // kind 必须是 persona|moderator
    expect(() => parseManifest({ ...m, kind: "robot" })).toThrow(DshManifestError);
    // toolPolicy.sideEffects 必须为 false
    expect(() => parseManifest({ ...m, toolPolicy: { webSearch: true, sideEffects: true } })).toThrow(
      DshManifestError
    );
    expect(() => parseManifest(null)).toThrow(DshManifestError);
  });

  it("writes and reads a manifest atomically", () => {
    const m = validManifest();
    const p = writeManifestAtomic(m);
    expect(fs.existsSync(p)).toBe(true);
    const read = readManifest("bt-discussion-abc-p1");
    expect(read.runtimeProfile.provider).toBe("openai");
    expect(read.persona?.referenceIndex?.[0]?.hash).toBe(H("ref-a"));
    deleteManifest("bt-discussion-abc-p1");
    expect(fs.existsSync(p)).toBe(false);
  });

  it("rejects unsafe session ids to avoid path injection", () => {
    expect(safeSessionFileName("bt-a-b")).toBe("bt-a-b.json");
    expect(() => safeSessionFileName("../evil")).toThrow(DshManifestError);
    expect(() => safeSessionFileName("a/b")).toThrow(DshManifestError);
    expect(() => safeSessionFileName("")).toThrow(DshManifestError);
  });

  it("reads a missing manifest as DshManifestError", () => {
    expect(() => readManifest("nope")).toThrow(DshManifestError);
  });
});

describe("dsh manifest P0 contract", () => {
  function expectInvalid(mutate: (m: RuntimeSessionManifest) => void) {
    const m = validManifest();
    mutate(m);
    expect(() => parseManifest(m)).toThrow(DshManifestError);
  }

  it("accepts only a legal session id from the current discussion family", () => {
    for (const id of ["bt-turn-abc-p1-11111111-1111-1111-1111-111111111111", "bt-discussion-abc-moderator"]) {
      expect(parseManifest(validManifest({ sessionId: id })).sessionId).toBe(id);
    }
  });

  it("rejects missing or empty session id", () => {
    expectInvalid((m) => delete (m as { sessionId?: string }).sessionId);
    expectInvalid((m) => void (m.sessionId = ""));
  });

  it("rejects persona/moderator contradictions", () => {
    // moderator 不得有 persona
    expectInvalid((m) => {
      m.kind = "moderator";
      delete m.participantId;
      m.allowedSkills = [];
    });
    // persona 必须有 participantId 与 persona
    expectInvalid((m) => delete (m as { participantId?: string }).participantId);
    // persona 必须有 persona 块
    expectInvalid((m) => delete (m as { persona?: object }).persona);
    // moderator 不得携带普通 Skill
    expectInvalid((m) => {
      m.kind = "moderator";
      delete m.persona;
      delete m.participantId;
    });
    // moderator 不得打开 webSearch
    expectInvalid((m) => {
      m.kind = "moderator";
      delete m.persona;
      delete m.participantId;
      m.allowedSkills = [];
      m.toolPolicy = { webSearch: true, sideEffects: false };
    });
  });

  it("requires persona-profile inside allowedSkills to match the persona block exactly", () => {
    // 完全没有 persona-profile
    expectInvalid((m) => {
      m.allowedSkills = m.allowedSkills.filter((s) => s.name !== "persona-profile");
    });
    // version 不一致
    expectInvalid((m) => {
      m.allowedSkills = m.allowedSkills.map((s) => (s.name === "persona-profile" ? { ...s, version: "9.9.9" } : s));
    });
    // hash 不一致
    expectInvalid((m) => {
      m.allowedSkills = m.allowedSkills.map((s) =>
        s.name === "persona-profile" ? { ...s, contentHash: H("other") } : s
      );
    });
    // packageRoot 与 persona.snapshotRoot 不一致
    expectInvalid((m) => {
      m.allowedSkills = m.allowedSkills.map((s) =>
        s.name === "persona-profile" ? { ...s, packageRoot: "/elsewhere" } : s
      );
    });
  });

  it("rejects empty packageRoot and duplicate skill names", () => {
    // 空 packageRoot
    expectInvalid((m) => {
      m.allowedSkills = m.allowedSkills.map((s) => (s.name === "market-research" ? { ...s, packageRoot: "" } : s));
    });
    // 普通 Skill 覆盖 persona-profile
    expectInvalid((m) => {
      m.allowedSkills = [
        ...m.allowedSkills.filter((s) => s.name === "persona-profile"),
        { name: "persona-profile", version: "2.0.0", contentHash: H("dup"), packageRoot: "/dup", description: "dup", resourceIndex: [] },
      ];
    });
    // 重复名称
    expectInvalid((m) => {
      m.allowedSkills = [...m.allowedSkills, { ...m.allowedSkills[1] }];
    });
  });

  it("rejects invalid hashes (must be 64-char lowercase hex)", () => {
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona) persona.skillHash = "abc123";
      m.allowedSkills = m.allowedSkills.filter((s) => s.name !== "persona-profile");
    });
    expectInvalid((m) => {
      m.allowedSkills = m.allowedSkills.map((s) =>
        s.name === "market-research" ? { ...s, contentHash: "not-a-hash" } : s
      );
    });
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona) persona.referenceIndex = [{ rel: "references/a.md", name: "a.md", size: 10, hash: "bad" }];
    });
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona) persona.referenceIndex = [{ rel: "references/a.md", name: "a.md", size: 10, hash: "A".repeat(64) }];
    });
  });

  it("rejects unsafe resource index paths", () => {
    // 绝对路径
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona) persona.referenceIndex = [{ rel: "/etc/passwd.md", name: "passwd.md", size: 10, hash: H("x") }];
    });
    // 路径穿越
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona) persona.referenceIndex = [{ rel: "references/../../secret.md", name: "secret.md", size: 10, hash: H("x") }];
    });
    // 不允许 references/ 之外的前缀
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona) persona.referenceIndex = [{ rel: "docs/a.md", name: "a.md", size: 10, hash: H("x") }];
    });
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona) persona.referenceIndex = [{ rel: "references", name: "a.md", size: 10, hash: H("x") }];
    });
    // 重复条目
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona)
        persona.referenceIndex = [
          { rel: "references/a.md", name: "a.md", size: 10, hash: H("x") },
          { rel: "references/a.md", name: "a.md", size: 10, hash: H("x") },
        ];
    });
    // 负 size / 超限 size
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona) persona.referenceIndex = [{ rel: "references/a.md", name: "a.md", size: -1, hash: H("x") }];
    });
    expectInvalid((m) => {
      const persona = m.persona;
      if (persona)
        persona.referenceIndex = [{ rel: "references/a.md", name: "a.md", size: 1024 * 1024 + 1, hash: H("x") }];
    });
  });
});
