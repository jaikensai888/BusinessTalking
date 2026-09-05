import { describe, it, expect } from "vitest";
import {
  buildRuntimeProfile,
  computeProfileHash,
  normalizeProvider,
  dshRouteName,
  buildRuntimePatchYaml,
  credentialEnvKeys,
} from "@/lib/runtime/profile";
import { DshRouteUnsupportedError } from "@/lib/dsh/errors";

describe("dsh profile builder", () => {
  it("normalizes provider compatibly (deepseek/ollama -> openai)", () => {
    expect(normalizeProvider("deepseek")).toBe("openai");
    expect(normalizeProvider("ollama")).toBe("openai");
    expect(normalizeProvider("openai")).toBe("openai");
    expect(normalizeProvider("anthropic")).toBe("anthropic");
    expect(normalizeProvider(null)).toBe("openai");
  });

  it("builds a profile with stable hash, no secret in patch", () => {
    const p = buildRuntimeProfile({ provider: "openai", baseUrl: "https://api.deepseek.com", defaultModel: "ds-v3" });
    expect(p.provider).toBe("openai");
    expect(p.model).toBe("ds-v3");
    expect(p.baseUrl).toBe("https://api.deepseek.com");
    expect(p.profileHash).toMatch(/^[0-9a-f]{64}$/);
    // 相同输入 → 相同 hash；不同 model → 不同 hash
    const p2 = buildRuntimeProfile({ provider: "openai", baseUrl: "https://api.deepseek.com", defaultModel: "ds-v3" });
    expect(p2.profileHash).toBe(p.profileHash);
    const p3 = buildRuntimeProfile({ provider: "openai", baseUrl: "https://api.deepseek.com", defaultModel: "ds-v4" });
    expect(p3.profileHash).not.toBe(p.profileHash);
  });

  it("throws when model is missing or provider unsupported", () => {
    expect(() => buildRuntimeProfile({ provider: "openai", defaultModel: null })).toThrow(DshRouteUnsupportedError);
    expect(() => buildRuntimeProfile({ provider: "openai", defaultModel: "" })).toThrow(DshRouteUnsupportedError);
  });

  it("maps provider to llm-pi-ai route and emits a key-less patch", () => {
    expect(dshRouteName("openai")).toBe("openai-completions");
    expect(dshRouteName("anthropic")).toBe("anthropic-messages");
    const patch = buildRuntimePatchYaml({ provider: "openai", model: "ds-v3", profileHash: "h" });
    expect(patch).toContain("llm-pi-ai");
    expect(patch).toContain("openai-completions");
    expect(patch).toContain("ds-v3");
    expect(patch).not.toContain("sk-"); // 不含 key
  });

  it("exposes a credential env key set (the key value is injected by the caller)", () => {
    expect(credentialEnvKeys()).toContain("BT_DSH_LLM_API_KEY");
  });

  it("computeProfileHash is deterministic and independent of value ordering", () => {
    const a = computeProfileHash({ provider: "openai", model: "m", baseUrl: "b" });
    const b = computeProfileHash({ provider: "openai", model: "m", baseUrl: "b" });
    expect(a).toBe(b);
    expect(computeProfileHash({ provider: "openai", model: "m" })).not.toBe(a);
  });
});
