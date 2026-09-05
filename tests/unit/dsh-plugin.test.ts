import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const pluginUrl = pathToFileURL(path.join(projectRoot, "runtime", "dsh-plugin", "index.mjs")).href;
const previousSessionId = process.env.BT_DSH_SESSION_ID;

afterEach(() => {
  if (previousSessionId === undefined) delete process.env.BT_DSH_SESSION_ID;
  else process.env.BT_DSH_SESSION_ID = previousSessionId;
});

function captureProvider(plugin: { apply: (ctx: unknown) => void }) {
  let providerFactory: ((control?: unknown) => { list: () => Promise<unknown[]>; get: (candidate: unknown) => Promise<{ content: string }> }) | undefined;
  plugin.apply({
    inject: (_deps: unknown, callback: (ctx: unknown) => void) => {
      callback({
        tools: { register: () => undefined },
        skills: {
          registerProvider: (factory: typeof providerFactory) => {
            providerFactory = factory;
            return undefined;
          },
        },
      });
    },
  });
  if (!providerFactory) throw new Error("plugin 未注册 SkillProvider");
  return providerFactory();
}

describe("business-talking DSH plugin", () => {
  it("loads the full hashed Persona SKILL from the current session manifest", async () => {
    const sessionId = `bt-plugin-test-${crypto.randomUUID()}`;
    const snapshotRoot = path.join(projectRoot, "data", "dsh", "snapshots", sessionId);
    const manifestPath = path.join(projectRoot, "data", "dsh", "manifests", `${sessionId}.json`);
    const skillContent = "---\nname: test-persona\n---\n\n# Full persona skill\nUse the test identity.";
    const skillHash = crypto.createHash("sha256").update(skillContent).digest("hex");

    fs.mkdirSync(snapshotRoot, { recursive: true });
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(path.join(snapshotRoot, "SKILL.md"), skillContent, "utf8");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        sessionId,
        discussionId: "discussion-test",
        participantId: "participant-test",
        kind: "persona",
        runtimeProfile: { provider: "openai", model: "test", profileHash: "" },
        persona: {
          id: "persona-test",
          name: "测试人格",
          systemPrompt: "请保持测试身份。",
          skillName: "persona-profile",
          skillVersion: "0.0.0+test",
          skillHash,
          snapshotRoot,
          referenceIndex: [],
        },
        allowedSkills: [],
        toolPolicy: { webSearch: false, sideEffects: false },
      }),
      "utf8"
    );

    process.env.BT_DSH_SESSION_ID = sessionId;
    try {
      const plugin = (await import(`${pluginUrl}?test=${sessionId}`)) as { apply: (ctx: unknown) => void };
      const provider = captureProvider(plugin);
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

  it("fails closed instead of falling back to a test manifest", async () => {
    delete process.env.BT_DSH_SESSION_ID;
    const plugin = (await import(`${pluginUrl}?missing-session=${crypto.randomUUID()}`)) as { apply: (ctx: unknown) => void };
    const provider = captureProvider(plugin);
    await expect(provider.list()).rejects.toThrow("BT_DSH_SESSION_ID 未设置");
  });
});
