import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiscussionArchivedError,
  DshProtocolError,
  DshRuntimeProfileConflictError,
  DshSessionBusyError,
} from "@/lib/dsh/errors";
import { DiscussionSessionManager, type DiscussionSessionRunInput, type SessionProcessFactory } from "@/lib/runtime/discussion-session-manager";
import type { DshSessionProcessOptions } from "@/lib/runtime/session-process";
import type { RuntimeProfile } from "@/lib/runtime/types";

const PROFILE: RuntimeProfile = { provider: "openai", model: "m", profileHash: "profile-1" };
const PROFILE_2: RuntimeProfile = { provider: "openai", model: "m2", profileHash: "profile-2" };
const PROCESS_OPTIONS: DshSessionProcessOptions = {
  cwd: "G:/business-talking",
  dshBin: "G:/business-talking/node_modules/.bin/dsh.cmd",
  dshHome: "G:/business-talking/data/dsh-home",
  patches: ["base.patch.yml"],
  provider: "deepseek-official",
  model: "m",
};

type FakeProcess = {
  options: DshSessionProcessOptions;
  run: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

let processes: FakeProcess[];
let createProcess: ReturnType<typeof vi.fn>;

function manager() {
  return new DiscussionSessionManager(createProcess as unknown as SessionProcessFactory);
}

function createFakeProcess(options: DshSessionProcessOptions): FakeProcess {
  const process: FakeProcess = {
    options,
    run: vi.fn(async ({ sessionId }: { sessionId: string; prompt: string }) => {
      await options.onNotification?.("request-1", {
        method: "session.event",
        params: { sessionId, event: { type: "turn/start", seq: 1, data: {} } },
      });
      return { sessionId, finalResponse: `reply:${sessionId}` };
    }),
    close: vi.fn(async () => {}),
  };
  processes.push(process);
  return process;
}

function input(overrides: Partial<DiscussionSessionRunInput> = {}): DiscussionSessionRunInput {
  return {
    discussionId: "d1",
    participantId: "p1",
    sessionId: "s1",
    prompt: "hello",
    profile: PROFILE,
    processOptions: PROCESS_OPTIONS,
    onNotification: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  processes = [];
  createProcess = vi.fn((options: DshSessionProcessOptions) => createFakeProcess(options));
});

describe("DiscussionSessionManager", () => {
  it("reuses one process per Discussion while keeping participant Sessions distinct", async () => {
    const sessionManager = manager();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    await sessionManager.run(input({ sessionId: "session-a", participantId: "p1", onNotification: firstCallback }));
    await sessionManager.run(input({ sessionId: "session-b", participantId: "p2", onNotification: secondCallback }));

    expect(createProcess).toHaveBeenCalledTimes(1);
    expect(processes[0].run).toHaveBeenCalledTimes(2);
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledTimes(1);
  });

  it("rejects a busy Session immediately but allows a different Session", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sessionManager = manager();
    const process = createFakeProcess;
    createProcess.mockImplementationOnce((options: DshSessionProcessOptions) => {
      const fake = process(options);
      fake.run.mockImplementation(async ({ sessionId }: { sessionId: string }) => {
        await options.onNotification?.("request", { method: "session.event", params: { sessionId, event: { type: "turn/start", seq: 1 } } });
        await gate;
        return { sessionId, finalResponse: "ok" };
      });
      return fake;
    });
    const first = sessionManager.run(input({ sessionId: "session-a" }));
    await Promise.resolve();
    await expect(sessionManager.run(input({ sessionId: "session-a" }))).rejects.toBeInstanceOf(DshSessionBusyError);
    const second = sessionManager.run(input({ sessionId: "session-b", participantId: "p2" }));
    release();
    await expect(first).resolves.toMatchObject({ sessionId: "session-a" });
    await expect(second).resolves.toMatchObject({ sessionId: "session-b" });
  });

  it("multiplexes notifications for different Persona Sessions while both are active", async () => {
    const started = new Set<string>();
    const releases = new Map<string, () => void>();
    const callbacks = new Map<string, ReturnType<typeof vi.fn>>();
    createProcess.mockImplementationOnce((options: DshSessionProcessOptions) => {
      const fake = createFakeProcess(options);
      fake.run.mockImplementation(async ({ sessionId }: { sessionId: string }) => {
        started.add(sessionId);
        await options.onNotification?.(`start-${sessionId}`, {
          method: "session.event",
          params: { sessionId, event: { type: "turn/start", seq: 1, data: {} } },
        });
        await new Promise<void>((resolve) => releases.set(sessionId, resolve));
        await options.onNotification?.(`message-${sessionId}`, {
          method: "session.event",
          params: { sessionId, event: { type: "assistant/message", seq: 2, data: { text: sessionId } } },
        });
        return { sessionId, finalResponse: `reply:${sessionId}` };
      });
      return fake;
    });

    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    callbacks.set("session-a", firstCallback);
    callbacks.set("session-b", secondCallback);
    const sessionManager = manager();
    const first = sessionManager.run(input({ sessionId: "session-a", onNotification: firstCallback }));
    const second = sessionManager.run(input({ sessionId: "session-b", onNotification: secondCallback }));
    await vi.waitFor(() => expect(started).toEqual(new Set(["session-a", "session-b"])), { timeout: 1000 });
    releases.get("session-b")?.();
    releases.get("session-a")?.();
    await Promise.all([first, second]);

    expect(firstCallback.mock.calls.every(([event]) => event.params.sessionId === "session-a")).toBe(true);
    expect(secondCallback.mock.calls.every(([event]) => event.params.sessionId === "session-b")).toBe(true);
    expect(callbacks.size).toBe(2);
  });

  it("drains on an idle profile switch and rejects an active profile switch", async () => {
    const sessionManager = manager();
    await sessionManager.run(input());
    await sessionManager.run(input({ profile: PROFILE_2, processOptions: { ...PROCESS_OPTIONS, model: "m2" } }));
    expect(createProcess).toHaveBeenCalledTimes(2);
    expect(processes[0].close).toHaveBeenCalledTimes(1);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    createProcess.mockImplementationOnce((options: DshSessionProcessOptions) => {
      const fake = createFakeProcess(options);
      fake.run.mockImplementation(async ({ sessionId }: { sessionId: string }) => {
        await gate;
        return { sessionId, finalResponse: "ok" };
      });
      return fake;
    });
    const active = sessionManager.run(input({ profile: PROFILE_2, sessionId: "active" }));
    await Promise.resolve();
    await expect(sessionManager.run(input({ profile: PROFILE, sessionId: "other" }))).rejects.toBeInstanceOf(DshRuntimeProfileConflictError);
    release();
    await active;
  });

  it("propagates notification callback failures without manufacturing success", async () => {
    const sessionManager = manager();
    const callback = vi.fn(async () => { throw new DshProtocolError("ledger failed"); });
    await expect(sessionManager.run(input({ onNotification: callback }))).rejects.toBeInstanceOf(DshProtocolError);
  });

  it("does not auto-restart a fatal process or replay the failed prompt", async () => {
    const sessionManager = manager();
    const fatal = new DshProtocolError("fatal");
    processes = [];
    createProcess.mockImplementation((options: DshSessionProcessOptions) => {
      const fake = createFakeProcess(options);
      fake.run.mockImplementation(async () => {
        options.onFatal?.(fatal);
        throw fatal;
      });
      return fake;
    });
    await expect(sessionManager.run(input())).rejects.toBe(fatal);
    await expect(sessionManager.run(input({ sessionId: "retry-after-fatal" }))).rejects.toBe(fatal);
    expect(createProcess).toHaveBeenCalledTimes(1);
    expect(processes[0].run).toHaveBeenCalledTimes(1);
  });

  it("closes only the requested Discussion registry", async () => {
    const sessionManager = manager();
    await sessionManager.run(input({ discussionId: "d1", sessionId: "s1" }));
    await sessionManager.run(input({ discussionId: "d2", sessionId: "s2" }));
    await sessionManager.closeDiscussion("d1");
    expect(processes[0].close).toHaveBeenCalledTimes(1);
    expect(processes[1].close).not.toHaveBeenCalled();
    await sessionManager.run(input({ discussionId: "d2", sessionId: "s3" }));
    expect(createProcess).toHaveBeenCalledTimes(2);
  });

  it("maps an in-flight run interrupted by Discussion archive to DISCUSSION_ARCHIVED", async () => {
    let rejectRun!: (error: Error) => void;
    const sessionManager = manager();
    createProcess.mockImplementationOnce((options: DshSessionProcessOptions) => {
      const fake = createFakeProcess(options);
      fake.run.mockImplementation(() => new Promise((_resolve, reject) => {
        rejectRun = reject;
      }));
      return fake;
    });

    const active = sessionManager.run(input());
    await vi.waitFor(() => expect(rejectRun).toBeTypeOf("function"));
    await sessionManager.closeDiscussion("d1", { reason: "archive" });
    rejectRun(new DshProtocolError("runner closed"));

    await expect(active).rejects.toBeInstanceOf(DiscussionArchivedError);
  });
});
