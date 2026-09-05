import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const scriptPath = path.join(projectRoot, "scripts", "dsh-turn.mjs");
const loaderPath = path.join(projectRoot, "tests", "fixtures", "dsh-sdk-client-loader.mjs");
const relativePath = (filePath: string) => `./${path.relative(projectRoot, filePath).split(path.sep).join("/")}`;

function runScript(env: Record<string, string | undefined>): { exitCode: number; payload: Record<string, unknown> } {
  try {
    const result = execFileSync(process.execPath, ["--experimental-loader", relativePath(loaderPath), relativePath(scriptPath)], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    return { exitCode: 0, payload: JSON.parse(result) as Record<string, unknown> };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string };
    return { exitCode: err.status ?? 1, payload: JSON.parse(err.stdout ?? "{}") as Record<string, unknown> };
  }
}

describe("dsh turn runner", () => {
  it("passes the turn session manifest identity into the DSH harness child", () => {
    const { exitCode, payload } = runScript({
      BT_DSH_SESSION_ID: "bt-discussion-correct-session",
      BT_DSH_PROMPT: "hello",
      BT_DSH_PROVIDER: "deepseek-official",
      BT_DSH_MODEL: "deepseek-v4-flash",
      BT_DSH_CWD: projectRoot,
      BT_DSH_HOME: path.join(os.tmpdir(), "business-talking-dsh-home"),
      BT_DSH_PATCHES: path.join(projectRoot, "runtime", "dsh", "cordis.patch.yml"),
    });
    expect(exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(JSON.parse(payload.finalResponse as string)).toEqual({
      childSessionId: "bt-discussion-correct-session",
      dshHome: path.join(os.tmpdir(), "business-talking-dsh-home"),
    });
  });

  it("fails closed when required env is missing instead of using implicit defaults", () => {
    // 只给 session 和 prompt，不给 provider/model/cwd/home —— 旧实现会回退到
    // deepseek-official/deepseek-v4-flash/process.cwd()
    const { exitCode, payload } = runScript({
      BT_DSH_SESSION_ID: "bt-discussion-missing-env",
      BT_DSH_PROMPT: "hello",
    });
    expect(exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("DSH_ROUTE_UNSUPPORTED");
    expect(payload.error).toMatch(/缺少 BT_DSH_PROVIDER/);
  });

  it("fails closed on missing session id", () => {
    const { exitCode, payload } = runScript({
      BT_DSH_PROMPT: "hello",
      BT_DSH_PROVIDER: "deepseek-official",
      BT_DSH_MODEL: "deepseek-v4-flash",
      BT_DSH_CWD: projectRoot,
      BT_DSH_HOME: path.join(os.tmpdir(), "business-talking-dsh-home"),
    });
    expect(exitCode).toBe(1);
    expect(payload.code).toBe("DSH_MANIFEST_INVALID");
    expect(payload.error).toMatch(/缺少 BT_DSH_SESSION_ID/);
  });

  it("maps SDK protocol errors to a fatal protocol code", () => {
    const { exitCode, payload } = runScript({
      BT_DSH_SESSION_ID: "bt-discussion-protocol-error",
      BT_DSH_PROMPT: "hello",
      BT_DSH_PROVIDER: "deepseek-official",
      BT_DSH_MODEL: "test-protocol-error",
      BT_DSH_CWD: projectRoot,
      BT_DSH_HOME: path.join(os.tmpdir(), "business-talking-dsh-home"),
      BT_DSH_PATCHES: path.join(projectRoot, "runtime", "dsh", "cordis.patch.yml"),
    });
    expect(exitCode).toBe(1);
    expect(payload.code).toBe("DSH_PROTOCOL_FAILED");
  });

  it("fails closed when the turn prompt is missing", () => {
    const { exitCode, payload } = runScript({
      BT_DSH_SESSION_ID: "bt-discussion-missing-prompt",
      BT_DSH_PROMPT: undefined,
      BT_DSH_PROVIDER: "deepseek-official",
      BT_DSH_MODEL: "deepseek-v4-flash",
      BT_DSH_CWD: projectRoot,
      BT_DSH_HOME: path.join(os.tmpdir(), "business-talking-dsh-home"),
      BT_DSH_PATCHES: path.join(projectRoot, "runtime", "dsh", "cordis.patch.yml"),
    });
    expect(exitCode).toBe(1);
    expect(payload.code).toBe("DSH_START_FAILED");
    expect(payload.error).toMatch(/缺少 BT_DSH_PROMPT/);
  });

  it("fails closed when the read-only patch list is missing", () => {
    const { exitCode, payload } = runScript({
      BT_DSH_SESSION_ID: "bt-discussion-missing-patch",
      BT_DSH_PROMPT: "hello",
      BT_DSH_PROVIDER: "deepseek-official",
      BT_DSH_MODEL: "deepseek-v4-flash",
      BT_DSH_CWD: projectRoot,
      BT_DSH_HOME: path.join(os.tmpdir(), "business-talking-dsh-home"),
      BT_DSH_PATCHES: undefined,
    });
    expect(exitCode).toBe(1);
    expect(payload.code).toBe("DSH_START_FAILED");
    expect(payload.error).toMatch(/缺少 BT_DSH_PATCHES/);
  });
});
