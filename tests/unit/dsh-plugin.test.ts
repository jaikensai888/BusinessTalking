import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const pluginUrl = pathToFileURL(path.join(projectRoot, "runtime", "dsh-plugin", "index.mjs")).href;
const previousSessionId = process.env.BT_DSH_SESSION_ID;
const previousCwd = process.cwd();

afterEach(() => {
  if (previousSessionId === undefined) delete process.env.BT_DSH_SESSION_ID;
  else process.env.BT_DSH_SESSION_ID = previousSessionId;
  process.chdir(previousCwd);
});

const H = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

interface MountedAgent {
  providerFactory: ((control?: unknown) => {
    list: () => Promise<unknown[]>;
    get: (candidate: unknown) => Promise<{ content: string }>;
  }) | undefined;
  registeredTools: Map<string, unknown>;
  restrictedAllow: string[] | undefined;
  guard: ((execution: { name: string; agent?: { id: string } }) => string | undefined) | undefined;
  sections: { name: string; order: number; text: () => string }[];
}

async function captureMount(sessionId: string) {
  let created: ((payload: { agent: unknown }) => void) | undefined;
  const mounted: MountedAgent = {
    providerFactory: undefined,
    registeredTools: new Map(),
    restrictedAllow: undefined,
    guard: undefined,
    sections: [],
  };

  const plugin = (await import(`${pluginUrl}?case=${sessionId}`)) as {
    apply: (ctx: unknown) => void;
  };

  const fakeAgentContext = {
    skills: {
      registerProvider: (factory: typeof mounted.providerFactory) => {
        mounted.providerFactory = factory;
        return () => undefined;
      },
    },
    tools: {
      register: (tool: unknown) => {
        mounted.registeredTools.set((tool as { name: string }).name, tool);
        return () => undefined;
      },
      restrict: (filter: { allow: string[] }) => {
        mounted.restrictedAllow = filter.allow;
        return () => undefined;
      },
      guard: (guard: MountedAgent["guard"]) => {
        mounted.guard = guard;
        return () => undefined;
      },
    },
    systemPrompt: {
      section: (s: { name: string; order: number; text: () => string }) => {
        mounted.sections.push(s);
        return () => undefined;
      },
      getSectionOrder: (name: string) => (name === "DEPLOYMENT_PERSONA" ? 0 : 500),
    },
  };

  plugin.apply({
    on: (_event: string, cb: typeof created) => {
      created = cb;
    },
  });
  if (!created) throw new Error("插件未订阅 agent/created");

  created({ agent: { id: sessionId, ctx: fakeAgentContext } });

  if (!mounted.providerFactory) throw new Error("插件未注册 SkillProvider");
  return { mounted, provider: mounted.providerFactory() };
}

function writeFixtureManifest(opts: {
  sessionId: string;
  snapshotRoot?: string;
  personaSkillContent?: string;
  allowedSkill?: { name: string; contentHash: string; version: string; packageRoot: string; resourceIndex?: unknown[] };
  toolPolicy?: { webSearch: boolean; sideEffects: boolean };
  kind?: "persona" | "moderator";
  persona?: object | null;
}) {
  const sessionId = opts.sessionId;
  const root = path.join(projectRoot, "data", "dsh");
  const manifestPath = path.join(root, "manifests", `${sessionId}.json`);
  const snapshotRoot = opts.snapshotRoot ?? path.join(root, "snapshots", sessionId);
  const personaSkillContent = opts.personaSkillContent ?? "---\nname: test-persona\n---\n\n# Full persona skill\nUse the test identity.";
  const persona = opts.persona === null ? undefined : {
    id: "persona-test",
    name: "测试人格",
    systemPrompt: "请保持测试身份。",
    skillName: "persona-profile",
    skillVersion: "0.0.0+test",
    skillHash: H(personaSkillContent),
    snapshotRoot: path.relative(projectRoot, snapshotRoot),
    referenceIndex: [{ rel: "references/a.md", name: "a.md", size: 10, hash: H("ref-a") }],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.join(snapshotRoot, "references"), { recursive: true });
  fs.writeFileSync(path.join(snapshotRoot, "SKILL.md"), personaSkillContent, "utf8");
  fs.writeFileSync(path.join(snapshotRoot, "references", "a.md"), "reference A", "utf8");
  const allowedSkills = opts.allowedSkill
    ? [
        { name: "persona-profile", version: "0.0.0+test", contentHash: H(personaSkillContent), packageRoot: path.relative(projectRoot, snapshotRoot), description: "Persona: 测试人格", resourceIndex: [{ rel: "references/a.md", name: "a.md", size: 10, hash: H("ref-a") }] },
        opts.allowedSkill,
      ]
    : [];
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      sessionId,
      discussionId: "discussion-test",
      participantId: "participant-test",
      kind: opts.kind ?? "persona",
      runtimeProfile: { provider: "openai", model: "test", baseUrl: null, profileHash: H("profile") },
      persona,
      allowedSkills,
      toolPolicy: opts.toolPolicy ?? { webSearch: false, sideEffects: false },
    }),
    "utf8"
  );
  return { manifestPath, snapshotRoot, skillContent: personaSkillContent };
}

describe("business-talking DSH plugin (P0 scoped mount)", () => {
  it("loads the full hashed Persona SKILL from the agent-scoped manifest", async () => {
    const sessionId = `bt-plugin-test-${crypto.randomUUID()}`;
    const { manifestPath, snapshotRoot, skillContent } = writeFixtureManifest({ sessionId });
    process.env.BT_DSH_SESSION_ID = sessionId;
    try {
      const { provider } = await captureMount(sessionId) as { provider: { list: () => Promise<unknown[]>; get: (c: unknown) => Promise<{ content: string }> } };
      const candidates = await provider.list();
      const persona = candidates.find((candidate) => (candidate as { name?: string }).name === "persona-profile");
      expect(persona).toBeDefined();
      const loaded = await provider.get(persona);
      expect(loaded.content).toContain(skillContent);
      expect(loaded.content).toContain("请保持测试身份。");
    } finally {
      fs.rmSync(manifestPath, { force: true });
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when BT_DSH_SESSION_ID is missing (no test manifest fallback)", async () => {
    delete process.env.BT_DSH_SESSION_ID;
    const sessionId = `bt-plugin-missing-${crypto.randomUUID()}`;
    await expect(captureMount(sessionId)).rejects.toThrow("未找到 manifest");
  });

  it("registers only read-only tools and applies restrict allowlist", async () => {
    const sessionId = `bt-plugin-roster-${crypto.randomUUID()}`;
    const { manifestPath, snapshotRoot } = writeFixtureManifest({ sessionId });
    process.env.BT_DSH_SESSION_ID = sessionId;
    try {
      const { mounted } = await captureMount(sessionId) as { mounted: MountedAgent };
      expect([...mounted.registeredTools.keys()].sort()).toEqual(["read_skill_reference"]);
      expect(mounted.restrictedAllow).toEqual(["skill", "read_skill_reference"]);
      expect(mounted.guard).toBeTypeOf("function");
    } finally {
      fs.rmSync(manifestPath, { force: true });
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    }
  });

  it("registers web_search only when manifest allows it", async () => {
    const sessionId = `bt-plugin-web-${crypto.randomUUID()}`;
    const { manifestPath, snapshotRoot } = writeFixtureManifest({
      sessionId,
      toolPolicy: { webSearch: true, sideEffects: false },
    });
    process.env.BT_DSH_SESSION_ID = sessionId;
    try {
      const { mounted } = await captureMount(sessionId) as { mounted: MountedAgent };
      expect([...mounted.registeredTools.keys()].sort()).toEqual(["read_skill_reference", "web_search"]);
      expect(mounted.restrictedAllow).toEqual(["skill", "read_skill_reference", "web_search"]);
    } finally {
      fs.rmSync(manifestPath, { force: true });
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    }
  });

  it("keeps Session A and B skill providers fully isolated", async () => {
    const sessionA = `bt-isol-a-${crypto.randomUUID()}`;
    const sessionB = `bt-isol-b-${crypto.randomUUID()}`;
    const contentA = "---\nname: shared-skill\n---\n\n# Skill A body\nOnly A may see this.";
    const contentB = "---\nname: shared-skill\n---\n\n# Skill B body\nOnly B may see this.";
    const skillRootA = path.join(projectRoot, "data", "skill-library", `shared-${crypto.randomUUID()}`);
    const skillRootB = path.join(projectRoot, "data", "skill-library", `shared-${crypto.randomUUID()}`);
    fs.mkdirSync(skillRootA, { recursive: true });
    fs.mkdirSync(skillRootB, { recursive: true });
    fs.writeFileSync(path.join(skillRootA, "SKILL.md"), contentA, "utf8");
    fs.writeFileSync(path.join(skillRootB, "SKILL.md"), contentB, "utf8");
    const mA = writeFixtureManifest({
      sessionId: sessionA,
      allowedSkill: { name: "shared-skill", contentHash: H(contentA), version: "1.0.0", packageRoot: path.relative(projectRoot, skillRootA) },
    });
    const mB = writeFixtureManifest({
      sessionId: sessionB,
      allowedSkill: { name: "shared-skill", contentHash: H(contentB), version: "1.0.0", packageRoot: path.relative(projectRoot, skillRootB) },
    });
    process.env.BT_DSH_SESSION_ID = sessionA;
    try {
      const A = await captureMount(sessionA) as { provider: { list: () => Promise<unknown[]>; get: (c: unknown) => Promise<{ content: string }> } };
      process.env.BT_DSH_SESSION_ID = sessionB;
      const B = await captureMount(sessionB) as { provider: { list: () => Promise<unknown[]>; get: (c: unknown) => Promise<{ content: string }> } };

      const listA = await A.provider.list();
      const listB = await B.provider.list();
      expect(listA.filter((s) => (s as { name?: string }).name === "shared-skill")).toHaveLength(1);
      expect(listB.filter((s) => (s as { name?: string }).name === "shared-skill")).toHaveLength(1);

      const candA = listA.find((s) => (s as { name?: string }).name === "shared-skill");
      const candB = listB.find((s) => (s as { name?: string }).name === "shared-skill");
      const bodyA = await A.provider.get(candA);
      const bodyB = await B.provider.get(candB);
      expect(bodyA.content).toContain("Only A may see this");
      expect(bodyB.content).toContain("Only B may see this");
      // 交叉访问：A 用 B 的 locator 必须被拒绝
      await expect(A.provider.get(candB)).rejects.toThrow("不在 allowlist");
      await expect(B.provider.get(candA)).rejects.toThrow("不在 allowlist");
    } finally {
      fs.rmSync(mA.manifestPath, { force: true });
      fs.rmSync(mB.manifestPath, { force: true });
      fs.rmSync(skillRootA, { recursive: true, force: true });
      fs.rmSync(skillRootB, { recursive: true, force: true });
      fs.rmSync(mA.snapshotRoot, { recursive: true, force: true });
      fs.rmSync(mB.snapshotRoot, { recursive: true, force: true });
    }
  });

  it("guard rejects out-of-allowlist calls and session mismatches", async () => {
    const sessionId = `bt-plugin-guard-${crypto.randomUUID()}`;
    const { manifestPath, snapshotRoot } = writeFixtureManifest({ sessionId });
    process.env.BT_DSH_SESSION_ID = sessionId;
    try {
      const { mounted } = await captureMount(sessionId) as { mounted: MountedAgent };
      const guard = mounted.guard;
      if (!guard) throw new Error("guard 未注册");
      expect(guard({ name: "tool-pwsh", agent: { id: sessionId } })).toMatch(/不在 P0 只读 allowlist/);
      expect(guard({ name: "read_skill_reference", agent: { id: sessionId } })).toBeUndefined();
      // 会话不一致（伪造 session id）拒绝
      expect(guard({ name: "read_skill_reference", agent: { id: "bt-other-session" } })).toMatch(/不一致/);
      expect(guard({ name: "read_skill_reference", agent: undefined })).toMatch(/缺少执行 Agent/);
    } finally {
      fs.rmSync(manifestPath, { force: true });
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    }
  });

  it("registers the persona systemPrompt section with deployment:persona order", async () => {
    const sessionId = `bt-plugin-prompt-${crypto.randomUUID()}`;
    const { manifestPath, snapshotRoot } = writeFixtureManifest({ sessionId });
    process.env.BT_DSH_SESSION_ID = sessionId;
    try {
      const { mounted } = await captureMount(sessionId) as { mounted: MountedAgent };
      const sec = mounted.sections.find((s) => s.name === "deployment:persona");
      expect(sec).toBeDefined();
      expect(sec?.order).toBe(0);
      expect(String(sec?.text())).toContain("请保持测试身份");
    } finally {
      fs.rmSync(manifestPath, { force: true });
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    }
  });
});
