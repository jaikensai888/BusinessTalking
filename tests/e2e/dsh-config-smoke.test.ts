import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Resolve the `dsh` bin shipped with the same-version `@deepseek-ai/dsh` package
 * and run `dsh --profile sdk --dump-config`. This is the fastest deterministic
 * smoke that the DSH runtime profile composes and that the pieces named by the
 * execution plan are actually present (intended for a local DSH build / sdk
 * profile dump-config, per plan step 12).
 */
function resolveDshBin(): string {
  const req = createRequire(import.meta.url);
  let manifest: string;
  try {
    manifest = req.resolve("@deepseek-ai/dsh/package.json") as string;
  } catch {
    throw new Error("Cannot resolve @deepseek-ai/dsh; run pnpm install first.");
  }
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as { bin?: Record<string, string> };
  const binRel = pkg.bin?.dsh ?? pkg.bin;
  if (typeof binRel !== "string") throw new Error("dsh package exposes no bin.dsh");
  // manifest path is <pkg>/package.json; the bin path is relative to the package root.
  return path.join(path.dirname(manifest), binRel);
}

function dumpConfig(): string {
  const bin = resolveDshBin();
  const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), "business-talking-dsh-"));
  try {
    return execFileSync(process.execPath, [bin, "--profile", "sdk", "--dump-config"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, DSH_HOME: dshHome },
    });
  } finally {
    fs.rmSync(dshHome, { recursive: true, force: true });
  }
}

describe("dsh sdk profile config smoke", () => {
  it("composes the sdk profile and exposes the components named by the plan", () => {
    const cfg = dumpConfig();

    // Skill mechanism + default filesystem provider (must be disabled later).
    expect(cfg).toContain("id: skill");
    expect(cfg).toContain("id: skill-filesystem");

    // LLM routes: llm-pi-ai carries openai/anthropic; llm-deepseek is present by default.
    expect(cfg).toContain("id: llm-pi-ai");
    expect(cfg).toContain("id: llm-deepseek");

    // Tools that must be disabled / restricted later.
    expect(cfg).toContain("id: tool-web");
    expect(cfg).toContain("id: web-search-deepseek");
    expect(cfg).toContain("id: web-fetch-http");
    expect(cfg).toContain("id: tool-bash");

    // Agent loop / system prompt / subagent are part of the runtime.
    expect(cfg).toContain("id: agent-loop");
    expect(cfg).toContain("id: system-prompt");
    expect(cfg).toContain("id: subagent");
  });
});
