import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  KNOWN_FORBIDDEN_TOOLS,
} from "@/lib/dsh/tool-policy";

/**
 * Resolve the `dsh` bin shipped with the same-version `@deepseek-ai/dsh` package
 * and run `dsh --profile sdk --dump-config` with the project's P0 patch.
 * This is the fastest deterministic smoke that the DSH runtime profile composes,
 * that the pieces named by the execution plan are actually present, and — after
 * applying `runtime/dsh/cordis.patch.yml` — that no P0-forbidden tool remains in
 * the active roster.
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

function dumpConfig(patch?: string): string {
  const bin = resolveDshBin();
  const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), "business-talking-dsh-"));
  try {
    return execFileSync(
      process.execPath,
      [bin, "--profile", "sdk", ...(patch ? ["--patch", patch] : []), "--dump-config"],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, DSH_HOME: dshHome },
      }
    );
  } finally {
    fs.rmSync(dshHome, { recursive: true, force: true });
  }
}

/** 解析 dump 文本中的 entries（id + disabled 状态）。
 *  dump 按 patch 层输出：同一 id 可能先出现在「patched by」覆盖层、后出现在原始层。
 *  覆盖层在前，因此首次出现即最终生效状态；后续出现不再覆盖（first-wins）。 */
function parseEntries(cfg: string): Map<string, boolean> {
  const final = new Map<string, boolean>();
  const seen = new Set<string>();
  let id: string | null = null;
  let lastDisabled: boolean | null = null;
  const flush = () => {
    if (id !== null && !seen.has(id)) {
      final.set(id, lastDisabled === true);
      seen.add(id);
    }
  };
  for (const line of cfg.split("\n")) {
    const idMatch = /^ *- id: (.+)$/.exec(line);
    if (idMatch) {
      flush();
      id = idMatch[1].trim();
      lastDisabled = null;
      continue;
    }
    const disMatch = /^ *disabled: (true|false)$/.exec(line);
    if (disMatch && id) lastDisabled = disMatch[1] === "true";
  }
  flush();
  return final;
}

/** 忽略平台条件 disabled（如 `!!js process.platform === 'win32'`）以外的判定。 */
function activeNames(entries: Map<string, boolean>): string[] {
  return [...entries.entries()].filter(([, disabled]) => !disabled).map(([id]) => id);
}

const projectRoot = process.cwd();

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

  it("keeps every P0-forbidden tool out of the patched active roster", () => {
    const patch = path.join(projectRoot, "runtime", "dsh", "cordis.patch.yml");
    expect(fs.existsSync(patch), "P0 patch must exist").toBe(true);
    const cfg = dumpConfig(patch);
    const entries = parseEntries(cfg);
    const active = activeNames(entries);

    for (const name of KNOWN_FORBIDDEN_TOOLS) {
      expect(active, `P0-forbidden tool must be disabled: ${name}`).not.toContain(name);
    }

    // 必需组件必须仍在 active roster（前提：patch 不能把运行时拆散）
    for (const required of ["skill", "agent-loop", "system-prompt", "session-projection", "tools", "llm-pi-ai"]) {
      expect(active, `required component must stay active: ${required}`).toContain(required);
    }
  });
});
