import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discussionFindUnique: vi.fn(),
  discussionUpdate: vi.fn(),
  discussionDelete: vi.fn(),
  participantUpdateMany: vi.fn(),
  participantFindMany: vi.fn(),
  closeDiscussion: vi.fn(),
  capabilityGrantDeleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    discussion: {
      findUnique: mocks.discussionFindUnique,
      update: mocks.discussionUpdate,
      delete: mocks.discussionDelete,
    },
    discussionParticipant: {
      updateMany: mocks.participantUpdateMany,
      findMany: mocks.participantFindMany,
    },
    discussionCapabilityGrant: { deleteMany: mocks.capabilityGrantDeleteMany },
  },
}));

vi.mock("@/lib/runtime/singleton", () => ({
  getDiscussionSessionManager: () => ({ closeDiscussion: mocks.closeDiscussion }),
  projectRoot: () => process.cwd(),
  runtimeDshHome: (cwd: string) => path.join(cwd, "data", "dsh-home"),
}));

import { deleteDiscussion } from "@/lib/discussion/archive";

function dshEncodeSegment(raw: string): string {
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    out += ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)
      ? ch
      : `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

function dshProjectKey(cwd: string): string {
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/, "") || "root";
  return `--${slug.slice(0, 251)}--`;
}

function sessionDir(root: string, sessionId: string): string {
  return path.join(root, "data", "dsh-home", "sessions", dshProjectKey(root), dshEncodeSegment(sessionId));
}

function projectionPath(root: string, sessionId: string): string {
  return path.join(root, "data", "dsh-home", "storages", "session_projcache", "sessions", `${sessionId}.json`);
}

function manifestPath(root: string, sessionId: string): string {
  return path.join(root, "data", "dsh", "manifests", `${sessionId}.json`);
}

function writeSessionArtifacts(root: string, sessionId: string, snapshotRoot?: string): void {
  const logDir = sessionDir(root, sessionId);
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, "session.jsonl.zstd"), "session", "utf8");

  const projection = projectionPath(root, sessionId);
  fs.mkdirSync(path.dirname(projection), { recursive: true });
  fs.writeFileSync(projection, "projection", "utf8");

  if (snapshotRoot) {
    fs.mkdirSync(snapshotRoot, { recursive: true });
    fs.writeFileSync(path.join(snapshotRoot, "SKILL.md"), "persona", "utf8");
    fs.mkdirSync(path.dirname(manifestPath(root, sessionId)), { recursive: true });
    const hash = "a".repeat(64);
    fs.writeFileSync(manifestPath(root, sessionId), JSON.stringify({
      schemaVersion: 1,
      sessionId,
      discussionId: "d1",
      participantId: "p1",
      kind: "persona",
      runtimeProfile: { provider: "deepseek", model: "test", profileHash: "b".repeat(64) },
      persona: {
        id: "persona-1",
        name: "Persona",
        systemPrompt: "",
        skillName: "persona-profile",
        skillVersion: "1.0.0",
        skillHash: hash,
        snapshotRoot,
        referenceIndex: [],
      },
      allowedSkills: [{
        name: "persona-profile",
        version: "1.0.0",
        contentHash: hash,
        packageRoot: snapshotRoot,
        description: null,
        resourceIndex: [],
      }],
      toolPolicy: { webSearch: false, sideEffects: false },
      permissions: { mode: "read-only", approvalPolicy: "ask" },
    }), "utf8");
  }
}

let tempRoot = "";
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "business-talking-delete-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  mocks.discussionUpdate.mockResolvedValue({});
  mocks.discussionDelete.mockResolvedValue({});
  mocks.participantUpdateMany.mockResolvedValue({ count: 1 });
  mocks.participantFindMany.mockResolvedValue([]);
  mocks.closeDiscussion.mockResolvedValue(undefined);
  mocks.capabilityGrantDeleteMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("hard discussion deletion", () => {
  it("terminates the runner, removes the real DSH artifacts, then deletes the DB row", async () => {
    const participantSessionId = "bt-d1-p1";
    const moderatorSessionId = "bt-d1-moderator";
    const participantSnapshot = path.join(tempRoot, "data", "dsh", "snapshots", "persona-a");
    const moderatorSnapshot = path.join(tempRoot, "data", "dsh", "snapshots", "moderator");
    const unrelatedSessionId = "bt-other-p1";
    const order: string[] = [];

    writeSessionArtifacts(tempRoot, participantSessionId, participantSnapshot);
    writeSessionArtifacts(tempRoot, moderatorSessionId, moderatorSnapshot);
    writeSessionArtifacts(tempRoot, unrelatedSessionId);

    mocks.discussionFindUnique.mockResolvedValue({
      id: "d1",
      moderatorSessionId,
      participants: [{ dshSessionId: participantSessionId, personaSnapshotRoot: participantSnapshot }],
    });
    mocks.discussionUpdate.mockImplementation(async () => { order.push("discussion"); return {}; });
    mocks.closeDiscussion.mockImplementation(async () => { order.push("close"); });
    mocks.participantUpdateMany.mockImplementation(async () => { order.push("participants"); return { count: 1 }; });
    mocks.discussionDelete.mockImplementation(async () => { order.push("delete"); return {}; });

    await expect(deleteDiscussion("d1")).resolves.toEqual({ id: "d1", deleted: true });

    expect(order).toEqual(["discussion", "close", "participants", "delete"]);
    expect(mocks.discussionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: {
        status: "archived",
        moderatorStatus: "archived",
        archivedAt: expect.any(Date),
        purgeAt: expect.any(Date),
      },
    });
    expect(mocks.closeDiscussion).toHaveBeenCalledWith("d1", { reason: "delete" });
    expect(mocks.discussionDelete).toHaveBeenCalledWith({ where: { id: "d1" } });
    expect(mocks.capabilityGrantDeleteMany).toHaveBeenCalledWith({ where: { discussionId: "d1" } });

    expect(fs.existsSync(sessionDir(tempRoot, participantSessionId))).toBe(false);
    expect(fs.existsSync(sessionDir(tempRoot, moderatorSessionId))).toBe(false);
    expect(fs.existsSync(projectionPath(tempRoot, participantSessionId))).toBe(false);
    expect(fs.existsSync(projectionPath(tempRoot, moderatorSessionId))).toBe(false);
    expect(fs.existsSync(manifestPath(tempRoot, participantSessionId))).toBe(false);
    expect(fs.existsSync(manifestPath(tempRoot, moderatorSessionId))).toBe(false);
    expect(fs.existsSync(participantSnapshot)).toBe(false);
    expect(fs.existsSync(moderatorSnapshot)).toBe(false);

    expect(fs.existsSync(sessionDir(tempRoot, unrelatedSessionId))).toBe(true);
    expect(fs.existsSync(projectionPath(tempRoot, unrelatedSessionId))).toBe(true);
  });

  it("does not delete the DB row when artifact cleanup fails", async () => {
    const sessionId = "bt-d1-p1";
    mocks.discussionFindUnique.mockResolvedValue({
      id: "d1",
      moderatorSessionId: null,
      participants: [{ dshSessionId: sessionId, personaSnapshotRoot: null }],
    });
    const logDir = sessionDir(tempRoot, sessionId);
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, "session.jsonl"), "session", "utf8");
    const rmSpy = vi.spyOn(fs, "rmSync").mockImplementationOnce(() => {
      throw new Error("session file is busy");
    });

    await expect(deleteDiscussion("d1")).rejects.toThrow("session file is busy");
    expect(mocks.discussionDelete).not.toHaveBeenCalled();

    rmSpy.mockRestore();
  });

  it("keeps a persona snapshot that another Discussion still references", async () => {
    const sessionId = "bt-d1-p1";
    const snapshotRoot = path.join(tempRoot, "data", "dsh", "snapshots", "shared-persona");
    writeSessionArtifacts(tempRoot, sessionId, snapshotRoot);
    mocks.discussionFindUnique.mockResolvedValue({
      id: "d1",
      moderatorSessionId: null,
      participants: [{ dshSessionId: sessionId, personaSnapshotRoot: snapshotRoot }],
    });
    mocks.participantFindMany.mockResolvedValue([{ personaSnapshotRoot: snapshotRoot }]);

    await expect(deleteDiscussion("d1")).resolves.toEqual({ id: "d1", deleted: true });

    expect(fs.existsSync(snapshotRoot)).toBe(true);
    expect(fs.existsSync(sessionDir(tempRoot, sessionId))).toBe(false);
    expect(fs.existsSync(manifestPath(tempRoot, sessionId))).toBe(false);
  });
});
