import { describe, expect, it } from "vitest";
import { buildChildRuntimeEnv, emptyReplyDiagnostic } from "../../scripts/dsh-session.mjs";
import fs from "node:fs";
import path from "node:path";
import { ensurePluginPatch } from "../../src/lib/runtime/singleton";
import { apply as applySessionResume, shouldResumePersistedSession } from "../../runtime/dsh-session-resume/index.mjs";

describe("dsh session runtime environment", () => {
  it("forwards the DSH search endpoint override to the SDK child", () => {
    const source = {
      NODE_ENV: "test" as const,
      DEEPSEEK_SEARCH_BASE_URL: "https://search.example.test/anthropic/v1",
      BT_DSH_APPROVAL_URL: "http://127.0.0.1:3001/api/internal/dsh/approval",
      BT_DSH_APPROVAL_TOKEN: "test-approval-token",
    };

    const childEnv = buildChildRuntimeEnv(source) as NodeJS.ProcessEnv;

    expect(childEnv.DEEPSEEK_SEARCH_BASE_URL).toBe(source.DEEPSEEK_SEARCH_BASE_URL);
    expect(childEnv.BT_DSH_APPROVAL_URL).toBe(source.BT_DSH_APPROVAL_URL);
    expect(childEnv.BT_DSH_APPROVAL_TOKEN).toBe(source.BT_DSH_APPROVAL_TOKEN);
  });

  it("keeps the underlying turn error message in an empty-reply diagnostic", () => {
    const diagnostic = emptyReplyDiagnostic({
      events: [
        { type: "agent/inbox/spliced", data: {} },
        { type: "turn/start", data: { turn: 4 } },
        {
          type: "turn/end",
          data: {
            reason: {
              kind: "error",
              error: { code: "UNKNOWN", message: "manifest 校验失败：snapshotRoot 不存在" },
            },
          },
        },
      ],
    });

    expect(diagnostic).toContain("failures=turn:UNKNOWN");
    expect(diagnostic).toContain("failureDetails=turn:UNKNOWN:manifest 校验失败：snapshotRoot 不存在");
  });

  it("installs the SDK session-resume overlay for runtime restarts", () => {
    const projectRoot = path.resolve(process.cwd());
    const patchPath = ensurePluginPatch(projectRoot);
    const patch = fs.readFileSync(patchPath, "utf8");

    expect(patch).toContain("id: business-talking-session-resume");
    expect(patch).toContain("runtime/dsh-session-resume/index.mjs");
  });

  it("recognizes a persisted session by its durable header id", () => {
    expect(shouldResumePersistedSession([
      { header: { id: "other-session" } },
      { header: { id: "target-session" } },
    ], "target-session")).toBe(true);
    expect(shouldResumePersistedSession([{ header: { id: "other-session" } }], "target-session")).toBe(false);
  });

  it("routes a cold create request to agents.resume when the id is persisted", async () => {
    const calls: Array<{ kind: string; value: unknown }> = [];
    const agents = {
      create: async (options: unknown) => {
        calls.push({ kind: "create", value: options });
        return "created";
      },
      resume: async (options: unknown) => {
        calls.push({ kind: "resume", value: options });
        return "resumed";
      },
      get: () => undefined,
    };
    let dispose: (() => void) | undefined;
    const ctx = {
      get(name: string) {
        if (name === "agents") return agents;
        if (name === "sessionQuery") return { listSessions: async () => [{ header: { id: "target-session" } }] };
        return undefined;
      },
      effect(effect: () => () => void) {
        dispose = effect();
        return dispose;
      },
    };

    applySessionResume(ctx as never);
    const result = await agents.create({ sessionId: "target-session", agentOptions: { model: "deepseek-chat" }, meta: { cwd: "ignored" } });

    expect(result).toBe("resumed");
    expect(calls).toEqual([{
      kind: "resume",
      value: { resumeSessionId: "target-session", agentOptions: { model: "deepseek-chat" } },
    }]);
    dispose?.();
  });
});
