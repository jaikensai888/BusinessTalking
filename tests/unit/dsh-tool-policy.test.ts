import { describe, it, expect } from "vitest";
import {
  DFH_READ_ONLY_TOOLS,
  KNOWN_FORBIDDEN_TOOLS,
  CONDITIONAL_WEB_SEARCH_TOOL,
  p0ToolAllowlist,
  isP0ToolAllowed,
} from "@/lib/dsh/tool-policy";
import type { ToolPolicy } from "@/lib/dsh/manifest";

const readOnlyPolicy: ToolPolicy = { webSearch: false, sideEffects: false };
const webSearchPolicy: ToolPolicy = { webSearch: true, sideEffects: false };

describe("P0 tool policy contract", () => {
  it("defines a single read-only allowlist used by both schema and guard", () => {
    expect(DFH_READ_ONLY_TOOLS).toEqual(["skill", "read_skill_reference"]);
    // 固定引用：同一数组（模型 schema 与 guard 必须看到同一份）
    expect(p0ToolAllowlist(readOnlyPolicy)).toBe(DFH_READ_ONLY_TOOLS);
  });

  it("keeps web_search out unless the manifest explicitly allows it", () => {
    expect(p0ToolAllowlist(readOnlyPolicy)).not.toContain(CONDITIONAL_WEB_SEARCH_TOOL);
    const withWeb = p0ToolAllowlist(webSearchPolicy);
    expect(withWeb).toContain("web_search");
  });

  it("never admits forbidden side-effect or external tools", () => {
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("tool-bash");
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("tool-pwsh");
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("tool-fs");
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("tool-fs-search");
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("tool-str-replace-editor");
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("tool-subagent");
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("tool-subagent-fork");
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("tool-ralph");
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("tool-web");
    expect(KNOWN_FORBIDDEN_TOOLS).toContain("web-fetch-http");

    for (const name of KNOWN_FORBIDDEN_TOOLS) {
      expect(isP0ToolAllowed(name, readOnlyPolicy), `expected ${name} rejected`).toBe(false);
      expect(isP0ToolAllowed(name, webSearchPolicy), `expected ${name} rejected even with webSearch`).toBe(false);
    }
  });
});
