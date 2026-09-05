import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const scriptPath = path.join(projectRoot, "scripts", "dsh-turn.mjs");
const loaderPath = path.join(projectRoot, "tests", "fixtures", "dsh-sdk-client-loader.mjs");
const relativePath = (filePath: string) => `./${path.relative(projectRoot, filePath).split(path.sep).join("/")}`;

describe("dsh turn runner", () => {
  it("passes the turn session manifest identity into the DSH harness child", () => {
    const result = execFileSync(process.execPath, ["--experimental-loader", relativePath(loaderPath), relativePath(scriptPath)], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        BT_DSH_SESSION_ID: "bt-discussion-correct-session",
        BT_DSH_PROMPT: "hello",
        BT_DSH_HOME: path.join(os.tmpdir(), "business-talking-dsh-home"),
      },
      timeout: 30_000,
    });

    const payload = JSON.parse(result) as {
      ok: boolean;
      finalResponse: string;
    };
    expect(payload.ok).toBe(true);
    expect(JSON.parse(payload.finalResponse)).toEqual({
      childSessionId: "bt-discussion-correct-session",
      dshHome: path.join(os.tmpdir(), "business-talking-dsh-home"),
    });
  });
});
