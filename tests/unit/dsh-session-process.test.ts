import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { DshProtocolError, DshSessionBusyError, DshTurnError } from "@/lib/dsh/errors";
import { buildDshChildEnv } from "@/lib/runtime/dsh-child-env";
import { DshSessionProcess } from "@/lib/runtime/session-process";

const root = process.cwd();
const fixture = path.join(root, "tests", "fixtures", "dsh-session-runner.mjs");
const sessions: DshSessionProcess[] = [];

function createSession(onNotification?: (requestId: string, notification: unknown) => Promise<void> | void) {
  const session = new DshSessionProcess({
    cwd: root,
    dshBin: "fixture-dsh",
    dshHome: path.join(root, "data", "dsh-home"),
    patches: ["fixture.patch.yml"],
    provider: "fixture-provider",
    model: "fixture-model",
    runnerScript: fixture,
    onNotification,
  });
  sessions.push(session);
  return session;
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

describe("DshSessionProcess", () => {
  it("keeps session and prompt out of the persistent child environment", () => {
    const env = buildDshChildEnv({
      cwd: root,
      dshBin: "dsh-bin",
      dshHome: "dsh-home",
      patches: ["base.patch"],
      provider: "provider",
      model: "model",
      apiKey: "secret",
    });
    expect(env.BT_DSH_SESSION_ID).toBeUndefined();
    expect(env.BT_DSH_PROMPT).toBeUndefined();
    expect(env.DSH_PERMISSION_MODE).toBe("read-only");
    expect(env.BT_DSH_PROVIDER).toBe("provider");
    expect(env.BT_DSH_MODEL).toBe("model");
    expect(env.BT_DSH_PATCHES).toBe("base.patch");
  });

  it("receives ready before accepting a run", async () => {
    const session = createSession();
    await expect(session.start()).resolves.toBeUndefined();
    await expect(session.run({ sessionId: "session-ready", prompt: "hello" })).resolves.toEqual({
      sessionId: "session-ready",
      finalResponse: "reply:session-ready",
    });
  });

  it("does not resolve a run before its final event callback", async () => {
    const seen: string[] = [];
    const session = createSession(async (_requestId, notification: unknown) => {
      expect(notification).toMatchObject({ method: "session.event" });
      await new Promise((resolve) => setTimeout(resolve, 15));
      seen.push("event");
    });

    const result = await session.run({ sessionId: "session-callback", prompt: "hello" });
    expect(result.finalResponse).toBe("reply:session-callback");
    expect(seen).toEqual(["event"]);
  });

  it("rejects concurrent runs for one Session but correlates different Sessions", async () => {
    const session = createSession();
    await session.start();
    const first = session.run({ sessionId: "session-a", prompt: "slow-a" });
    await expect(session.run({ sessionId: "session-a", prompt: "slow-a" })).rejects.toBeInstanceOf(DshSessionBusyError);
    const second = session.run({ sessionId: "session-b", prompt: "slow-b" });
    await expect(first).resolves.toEqual({ sessionId: "session-a", finalResponse: "reply:session-a" });
    await expect(second).resolves.toEqual({ sessionId: "session-b", finalResponse: "reply:session-b" });
  });

  it("fails malformed, unknown, mismatched, closed, and nonzero runner outcomes", async () => {
    for (const prompt of ["corrupt", "unknown-request", "mismatch", "close", "nonzero"]) {
      const session = createSession();
      await session.start();
      await expect(session.run({ sessionId: `session-${prompt}`, prompt })).rejects.toBeInstanceOf(DshProtocolError);
      await session.close();
    }
  });

  it("closes all pending runs on a fatal frame and maps a turn error locally", async () => {
    const fatalSession = createSession();
    await fatalSession.start();
    const fatal = fatalSession.run({ sessionId: "session-fatal", prompt: "fatal" });
    const pending = fatalSession.run({ sessionId: "session-pending", prompt: "slow-a" });
    await expect(fatal).rejects.toBeInstanceOf(DshProtocolError);
    await expect(pending).rejects.toBeInstanceOf(DshProtocolError);

    const turnSession = createSession();
    await turnSession.start();
    await expect(turnSession.run({ sessionId: "session-error", prompt: "error" })).rejects.toBeInstanceOf(DshTurnError);
  });

  it("makes close idempotent and does not turn close cleanup into a run error", async () => {
    const session = createSession();
    await session.start();
    await expect(session.run({ sessionId: "session-error-close", prompt: "error" })).rejects.toBeInstanceOf(DshTurnError);
    await expect(Promise.all([session.close(), session.close(), session.close()])).resolves.toEqual([undefined, undefined, undefined]);
  });
});
