import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseManifest,
  writeManifestAtomic,
  readManifest,
  deleteManifest,
  safeSessionFileName,
  RuntimeSessionManifestSchema,
  type RuntimeSessionManifest,
} from "@/lib/dsh/manifest";
import { DshManifestError } from "@/lib/dsh/errors";

/** 目录隔离：把 manifestsRoot 指向临时目录，避免污染工作区 */
const origCwd = process.cwd();

function validManifest(overrides: Partial<RuntimeSessionManifest> = {}): RuntimeSessionManifest {
  return RuntimeSessionManifestSchema.parse({
    schemaVersion: 1,
    sessionId: "bt-discussion-abc-p1",
    discussionId: "abc",
    participantId: "p1",
    kind: "persona",
    runtimeProfile: { provider: "openai", model: "gpt-4o", profileHash: "h1" },
    persona: {
      id: "p1",
      name: "xx",
      systemPrompt: "sys",
      skillName: "persona-profile",
      skillVersion: "1.0.0",
      skillHash: "abc123",
      snapshotRoot: "/tmp/snap",
      referenceIndex: [{ rel: "references/a.md", name: "a.md", size: 10, hash: "ha" }],
    },
    allowedSkills: [{ name: "market-research", version: "1.0.0", contentHash: "c", packageRoot: "/p", description: "d" }],
    toolPolicy: { webSearch: true, sideEffects: false },
    ...overrides,
  });
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
    expect(read.persona?.referenceIndex?.[0]?.hash).toBe("ha");
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
