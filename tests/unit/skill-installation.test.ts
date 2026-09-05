import { describe, it, expect } from "vitest";
import {
  hashContent,
  resolveVersion,
  toKebabName,
  normalizeInternalRel,
} from "@/lib/skills/installation";

describe("skill installation — pure rules", () => {
  it("hashes content deterministically (sha256 hex)", () => {
    const a = hashContent("hello");
    const b = hashContent("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(hashContent("world"));
  });

  it("keeps a valid semver; falls back to 0.0.0+hash12 otherwise", () => {
    const h = "aaaaaaaaaaaaaaaa";
    expect(resolveVersion("1.2.3", h)).toBe("1.2.3");
    expect(resolveVersion("1.0.0-beta.1", h)).toBe("1.0.0-beta.1");
    expect(resolveVersion("0.1.0+abc", h)).toBe("0.1.0+abc");
    // 非法/空 → 0.0.0+hash12
    expect(resolveVersion(null, h)).toBe(`0.0.0+${h.slice(0, 12)}`);
    expect(resolveVersion("", h)).toBe(`0.0.0+${h.slice(0, 12)}`);
    expect(resolveVersion("not-a-version", h)).toBe(`0.0.0+${h.slice(0, 12)}`);
  });

  it("normalizes names to kebab-case and rejects empty", () => {
    expect(toKebabName("Market Research")).toBe("market-research");
    expect(toKebabName("  Competitor_Analysis ")).toBe("competitor-analysis");
    expect(toKebabName("就 a b 中文")).toBe("a-b");
    expect(toKebabName("  ")).toBe("");
  });

  it("normalizes resource relative paths and blocks traversal", () => {
    expect(normalizeInternalRel("references/foo.md")).toBe("references/foo.md");
    expect(normalizeInternalRel("examples/bar.md")).toBe("examples/bar.md");
    expect(normalizeInternalRel("references/sub/deep.md")).toBe("references/sub/deep.md");
    // traversal / wrong prefix rejected
    expect(normalizeInternalRel("../secret.md")).toBeNull();
    expect(normalizeInternalRel("../../etc/passwd")).toBeNull();
    expect(normalizeInternalRel("references/../../x.md")).toBeNull();
    expect(normalizeInternalRel("notes/foo.md")).toBeNull();
    expect(normalizeInternalRel("SKILL.md")).toBeNull();
  });
});
