import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => {
  const spawnImpl = vi.fn();
  return { spawnImpl };
});

vi.mock("node:child_process", () => ({
  spawn: (...a: unknown[]) => mocks.spawnImpl(...a),
}));

import { runTurnViaProcess } from "@/lib/runtime/turn-process";
import { DshProtocolError, DshTurnError, DshStartFailedError } from "@/lib/dsh/errors";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: (enc: string) => void };
    stderr: EventEmitter & { setEncoding: (enc: string) => void };
  };
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  mocks.spawnImpl.mockReturnValue(child);
  return child;
}

function emitChild(child: ReturnType<typeof fakeChild>, stdout: string, code: number | null) {
  child.stdout.emit("data", stdout);
  child.emit("close", code);
}

describe("runTurnViaProcess (P0 fail-closed)", () => {
  beforeEach(() => {
    mocks.spawnImpl.mockReset();
  });

  it("rejects a session mismatch between runner output and request", async () => {
    const child = fakeChild();
    const p = runTurnViaProcess({
      sessionId: "bt-turn-expected",
      prompt: "hi",
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      cwd: "G:/business-talking",
      dshHome: "G:/business-talking/data/dsh-home",
    });
    emitChild(child, JSON.stringify({ ok: true, sessionId: "bt-turn-OTHER", finalResponse: "x" }), 0);
    await expect(p).rejects.toBeInstanceOf(DshProtocolError);
  });

  it("rejects malformed stdout (corrupt JSON)", async () => {
    const child = fakeChild();
    const p = runTurnViaProcess({
      sessionId: "s1",
      prompt: "hi",
      provider: "p",
      model: "m",
      cwd: "G:/bt",
      dshHome: "G:/bt/data/dsh-home",
    });
    emitChild(child, "not-json{{", 0);
    await expect(p).rejects.toBeInstanceOf(DshProtocolError);
  });

  it("rejects a non-string response", async () => {
    const child = fakeChild();
    const p = runTurnViaProcess({
      sessionId: "s1",
      prompt: "hi",
      provider: "p",
      model: "m",
      cwd: "G:/bt",
      dshHome: "G:/bt/data/dsh-home",
    });
    emitChild(child, JSON.stringify({ ok: true, sessionId: "s1", finalResponse: 123 }), 0);
    await expect(p).rejects.toBeInstanceOf(DshTurnError);
  });

  it("maps a structured DSH error to its class by code", async () => {
    const child = fakeChild();
    const p = runTurnViaProcess({
      sessionId: "s1",
      prompt: "hi",
      provider: "p",
      model: "m",
      cwd: "G:/bt",
      dshHome: "G:/bt/data/dsh-home",
    });
    emitChild(child, JSON.stringify({ ok: false, code: "DSH_START_FAILED", stage: "env", error: "spawn failed" }), 1);
    await expect(p).rejects.toBeInstanceOf(DshStartFailedError);
  });

  it("rejects a child that exits nonzero without a parseable payload", async () => {
    const child = fakeChild();
    const p = runTurnViaProcess({
      sessionId: "s1",
      prompt: "hi",
      provider: "p",
      model: "m",
      cwd: "G:/bt",
      dshHome: "G:/bt/data/dsh-home",
    });
    emitChild(child, "", 1);
    await expect(p).rejects.toBeInstanceOf(DshProtocolError);
  });

  it("rejects an empty response field", async () => {
    const child = fakeChild();
    const p = runTurnViaProcess({
      sessionId: "s1",
      prompt: "hi",
      provider: "p",
      model: "m",
      cwd: "G:/bt",
      dshHome: "G:/bt/data/dsh-home",
    });
    emitChild(child, JSON.stringify({ ok: true, sessionId: "s1", finalResponse: "" }), 0);
    await expect(p).rejects.toBeInstanceOf(DshTurnError);
  });
});
