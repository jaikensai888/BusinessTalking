/**
 * BusinessTalking DSH plugin（见方案 §4.3/§4.4/§6）。
 *
 * 已核验：
 *  - 插件可被 dsh --profile sdk 装载（相对路径 name），apply(ctx) 在运行时内真实执行。
 *  - ctx.skills.registerProvider / ctx.tools.register(defineTool(...)) 的 API 签名（dsh-skill / dsh-tools）。
 *
 * 职责：
 *  - 注册 SkillProvider：list/get 只返回当前 manifest 的 Persona profile + allowedSkills（fail-closed）。
 *  - 注册只读工具 read_skill_reference / web_search（禁副作用）。
 *  - manifest 从 data/dsh/manifests/<sessionId>.json 读取（sessionId 来自 env BT_DSH_SESSION_ID；
 *    生产应由 agent/session-start 的 agent id 决定——本实现先用 env/固定值做功能验证）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";

// 模块加载探针：确认插件模块确实在 runtime 子进程被加载
try {
  fs.mkdirSync("G:/claude_project/code-agent/business-talking/data/dsh", { recursive: true });
  fs.writeFileSync(
    "G:/claude_project/code-agent/business-talking/data/dsh/plugin-loaded.marker",
    `module loaded at ${Date.now()}\n`
  );
} catch {
  /* ignore */
}

const MANIFESTS_ROOT = () => path.join(process.cwd(), "data", "dsh", "manifests");

function sessionId() {
  return process.env.BT_DSH_SESSION_ID || "bt-e2e";
}

function loadManifest() {
  const file = path.join(MANIFESTS_ROOT(), `${sessionId()}.json`);
  if (!fs.existsSync(file)) throw new Error(`DshManifestError: 未找到 manifest ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function text(v) {
  return [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v) }];
}

/** 只读 web_search：访问 BT 内部 endpoint（仅本机 plugin 使用 BT_INTERNAL_TOKEN） */
const webSearchTool = defineTool({
  name: "web_search",
  description: "联网搜索最新的产品、竞品、参数、市场数据。需要具体事实时使用。",
  parameters: {
    query: { type: "string", required: true, description: "搜索查询词，尽量具体" },
    maxResults: { type: "integer", description: "结果数量上限" },
  },
  output: {
    schema: { type: "json" },
    render: (_a, v) => text(v),
  },
  execute: async (args) => {
    const base = process.env.BT_INTERNAL_SEARCH_URL;
    const token = process.env.BT_INTERNAL_TOKEN;
    if (!base || !token) throw new Error("web_search 不可用：内部 endpoint 未配置");
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bt-internal-token": token },
      body: JSON.stringify({ query: args.query, maxResults: args.maxResults ?? 8 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`web_search 上游失败：${res.status}`);
    return await res.json();
  },
});

/** 只读 read_skill_reference：按 manifest referenceIndex 读取快照文件（防穿越、校验 hash） */
const readSkillRefTool = defineTool({
  name: "read_skill_reference",
  description: "读取当前人格/技能的一个参考文档（references 下的 .md）。仅当明确需要某份资料时使用。",
  parameters: {
    skillName: { type: "string", required: true, description: "skill 名（persona-profile 或 allowlist 内 skill）" },
    relativePath: { type: "string", required: true, description: "references/ 或 examples/ 下的相对路径" },
  },
  output: {
    schema: { type: "json" },
    render: (_a, v) => text(v),
  },
  execute: async (args) => {
    const m = loadManifest();
    const persona = m.persona;
    const refs = persona?.referenceIndex ?? [];
    const target = refs.find((r) => r.rel === args.relativePath || r.name === args.relativePath);
    if (!target) throw new Error(`DshSkillNotAllowed: reference 不在索引中：${args.relativePath}`);
    const root = path.resolve(process.cwd(), persona.snapshotRoot);
    const full = path.resolve(process.cwd(), persona.snapshotRoot, target.rel);
    if (!full.startsWith(root)) throw new Error("DshSkillNotAllowed: 路径越界");
    const body = fs.readFileSync(full, "utf8");
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    if (hash !== target.hash) throw new Error("DshManifestError: reference hash 不匹配");
    return { skillName: args.skillName, rel: target.rel, name: target.name, size: target.size, hash, content: body };
  },
});

/**
 * 注册 SkillProvider（fail-closed）。
 * ⚠️ 当前注册到调用层；严格 per-session 隔离需在每个 agent 的 scoped context 上注册
 *    （agent/session-start hook）。这里先按全局注册 + 按 env sessionId 读取 manifest，用于功能验证。
 */
function registerSkillProvider(ctx) {
  const providerName = "business-talking";
  return ctx.skills.registerProvider((control) => ({
    name: providerName,
    async list() {
      const m = loadManifest();
      const out = [];
      if (m.persona) {
        out.push({
          name: m.persona.skillName,
          description: `Persona: ${m.persona.name}`,
          invocation: { modelInvocable: true, userInvocable: false },
          source: "custom",
          provider: providerName,
          resourceBase: { kind: "opaque", description: m.persona.snapshotRoot },
          rank: 600,
          locator: { kind: "persona", hash: m.persona.skillHash },
        });
      }
      for (const s of m.allowedSkills ?? []) {
        out.push({
          name: s.name,
          description: s.description ?? "",
          invocation: { modelInvocable: true, userInvocable: false },
          source: "custom",
          provider: providerName,
          resourceBase: { kind: "opaque", description: s.packageRoot ?? s.name },
          rank: 600,
          locator: { kind: "skill", name: s.name, version: s.version, contentHash: s.contentHash },
        });
      }
      return out;
    },
    async get(candidate) {
      const m = loadManifest();
      if (candidate.locator.kind === "persona") {
        if (m.persona?.skillHash !== candidate.locator.hash) throw new Error("DshSkillNotAllowed: Persona hash 不匹配");
        return {
          name: candidate.name,
          description: candidate.description ?? "",
          invocation: candidate.invocation,
          source: candidate.source,
          provider: providerName,
          resourceBase: candidate.resourceBase,
          content: `<persona ${m.persona.name}>\n${m.persona.systemPrompt}`,
        };
      }
      const skill = m.allowedSkills.find((s) => s.name === candidate.locator.name && s.contentHash === candidate.locator.contentHash);
      if (!skill) throw new Error("DshSkillNotAllowed: Skill 不在 allowlist");
      return {
        name: skill.name,
        description: skill.description ?? "",
        invocation: candidate.invocation,
        source: candidate.source,
        provider: providerName,
        resourceBase: candidate.resourceBase,
        content: `SKILL: ${skill.name}@${skill.version}\n（完整 SKILL.md 由 DSH skill tool 按需加载；reference 用 read_skill_reference）`,
      };
    },
  }));
}

/** Cordis 插件入口：挂载到 live context 上注册 SkillProvider + 只读工具 */
export function apply(ctx) {
  const marker = "G:/claude_project/code-agent/business-talking/data/dsh/plugin-ran.marker";
  const append = (s) => {
    try {
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.appendFileSync(marker, `${s}\n`);
    } catch {
      /* ignore */
    }
  };
  try {
    append("apply:start");
    // Cordis 惯用法：等 tools/skills 可用时在 live 子上下文注册（避免在 inactive 根上下文注册失败）
    ctx.inject(["tools", "skills"], (c) => {
      append("inject:ready");
      try {
        c.tools.register(webSearchTool);
        c.tools.register(readSkillRefTool);
        append("tools:read_skill_reference,web_search");
        registerSkillProvider(c);
        append("skillprovider:business-talking");
      } catch (e) {
        append(`register-err:${e.message}`);
      }
    });
    append("inject:requested");
  } catch (e) {
    append(`apply-err:${e.message}`);
  }
}
