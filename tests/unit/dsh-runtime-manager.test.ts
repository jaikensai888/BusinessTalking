import { describe, it, expect, vi } from "vitest";
import { DshRuntimeManager } from "@/lib/runtime/manager";
import type { DshRuntime, RuntimeProfile } from "@/lib/runtime/types";
import { DshRuntimeProfileConflictError, DshSessionBusyError, DshStartFailedError } from "@/lib/dsh/errors";

const PROFILE: RuntimeProfile = { provider: "openai", model: "m", profileHash: "h1" };
const PROFILE2: RuntimeProfile = { provider: "openai", model: "m2", profileHash: "h2" };

function fakeRuntime(overrides: Partial<DshRuntime> = {}): DshRuntime {
  return {
    ensureStarted: vi.fn(async () => {}),
    run: vi.fn(async () => ({ sessionId: "s", finalResponse: "ok", events: [], notifications: [] })),
    assertHealthy: vi.fn(() => {}),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("dsh runtime manager", () => {
  it("lazily starts, reuses same profile, and closes the runtime", async () => {
    const created: DshRuntime[] = [];
    const mgr = new DshRuntimeManager({ cwd: ".", patches: [] }, () => {
      const r = fakeRuntime();
      created.push(r);
      return r;
    });
    await mgr.ensureStarted(PROFILE);
    await mgr.ensureStarted(PROFILE);
    expect(created).toHaveLength(1);
    expect(mgr.isStarted).toBe(true);
    await mgr.close();
    expect(created[0].close).toHaveBeenCalled();
    expect(mgr.isStarted).toBe(false);
  });

  it("rejects an active-run profile switch (runtime_profile_conflict)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const man = new DshRuntimeManager({ cwd: ".", patches: [] }, () =>
      fakeRuntime({
        run: vi.fn(async () => {
          await gate;
          return { sessionId: "s", finalResponse: "", events: [], notifications: [] };
        }),
      })
    );
    await man.ensureStarted(PROFILE);
    const p = man.run("s", "hi");
    await Promise.resolve();
    await expect(man.ensureStarted(PROFILE2)).rejects.toThrow(DshRuntimeProfileConflictError);
    release();
    await p;
  });

  it("serializes per-session runs and rejects concurrent ones (session busy)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const man = new DshRuntimeManager({ cwd: ".", patches: [] }, () =>
      fakeRuntime({
        run: vi.fn(async () => {
          await gate;
          return { sessionId: "s", finalResponse: "", events: [], notifications: [] };
        }),
      })
    );
    await man.ensureStarted(PROFILE);
    const p = man.run("s", "hi");
    await Promise.resolve();
    await expect(man.run("s", "again")).rejects.toThrow(DshSessionBusyError);
    const p2 = man.run("s2", "hi2");
    release();
    await p;
    await p2;
  });

  it("fails loud when run is called before ensureStarted", async () => {
    const man = new DshRuntimeManager({ cwd: ".", patches: [] }, () => fakeRuntime());
    await expect(man.run("s", "hi")).rejects.toThrow(DshStartFailedError);
  });
});
