/**
 * BusinessTalking DSH plugin（见方案 §4.3/§4.4/§6；P0 修复计划 Task 2/3）。
 *
 * 职责：
 *  - 监听 `agent/created`，对每个 payload.agent 同步执行 mountAgentScope(agent)：
 *      * 只读取并验证 agent.id 对应的 manifest（不接受调用方传入的 sessionId）；
 *      * 在 agent.ctx（scoped context）上注册 SkillProvider、systemPrompt section、
 *        只读工具 read_skill_reference（web_search 仅在 manifest 明确允许时注册，P0 默认关闭）；
 *      * agent.ctx.tools.restrict({ allow: P0 只读 list }) + agent.ctx.tools.guard(...) 双保险。
 *  - 所有 tool 执行从 exec.agent?.id 取当前 Agent id，再加载同一 manifest；缺 exec.agent、
 *    id 与 manifest 不一致或 manifest 不存在时直接拒绝（fail-closed）。
 *  - 不写任何 marker/工作区文件；不改全局 context。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  loadManifest,
  readVerifiedFile,
  resolveEntryRoot,
  resolveRoot,
  isSafeReferenceRel,
  ManifestError,
  isSafeSessionId,
} from "./manifest.mjs";

/** system-prompt section 名（对应 dsh-system-prompt 的 PERSONA_SECTION 常量；不直接依赖该包） */
const PERSONA_SECTION = "deployment:persona";

const CWD = () => process.cwd();

/** 模型可见的 P0 只读工具 allowlist（与 src/lib/dsh/tool-policy.ts 保持一致的语义） */
const P0_ALLOWED_TOOLS = Object.freeze(["skill", "read_skill_reference"]);
const P0_WEB_SEARCH = "web_search";

function text(v) {
  return [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v) }];
}

function dshError(code, message) {
  const e = new Error(`${code}: ${message}`);
  e.code = code;
  return e;
}

function skillDescription(name, description) {
  const value = typeof description === "string" ? description.trim() : "";
  return value || `Skill ${name}`;
}

function opaqueResourceBase(name) {
  return { kind: "opaque", description: `${name} resources (business-talking)` };
}

function candidateRecord(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw dshError("DSH_SKILL_NOT_ALLOWED", "Skill candidate 非法");
  }
  const locator = candidate.locator;
  if (!locator || typeof locator !== "object" || Array.isArray(locator)) {
    throw dshError("DSH_SKILL_NOT_ALLOWED", "Skill locator 非法");
  }
  if (typeof candidate.name !== "string" || !candidate.name) {
    throw dshError("DSH_SKILL_NOT_ALLOWED", "Skill candidate name 非法");
  }
  return { candidate, locator };
}

/** 只读 web_search：访问 BT 内部 endpoint（仅当 manifest.toolPolicy.webSearch 且内部 endpoint/token 存在时注册） */
function buildWebSearchTool() {
  return defineTool({
    name: P0_WEB_SEARCH,
    description: "联网搜索最新的产品、竞品、参数、市场数据。需要具体事实时使用。",
    parameters: {
      query: { type: "string", required: true, description: "搜索查询词，尽量具体" },
      maxResults: { type: "integer", description: "结果数量上限" },
    },
    output: {
      schema: { type: "json" },
      render: (_a, v) => text(v),
    },
    execute: async (args, exec) => {
      const { sessionId } = assertAgentIdentity(exec);
      const manifest = loadManifest(CWD(), sessionId);
      if (!manifest.toolPolicy?.webSearch) {
        throw dshError("DSH_SKILL_NOT_ALLOWED", "web_search 未在 manifest 允许");
      }
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
}

/**
 * 只读 read_skill_reference：按当前 agent 的 manifest 校验 skillName（persona 或 allowlist 确切版本），
 * 再从该 Skill 自己的 resource index 查找 relativePath；只允许 references/、examples/；
 * 拒绝绝对路径、`..`、空路径、未索引文件、非 Markdown、超大小与 hash 不匹配。
 */
function buildReadSkillRefTool() {
  return defineTool({
    name: "read_skill_reference",
    description: "读取当前人格/技能的一个参考文档（references/examples 下的 .md）。仅当明确需要某份资料时使用。",
    parameters: {
      skillName: { type: "string", required: true, description: "skill 名（persona-profile 或 allowlist 内 skill）" },
      relativePath: { type: "string", required: true, description: "references/ 或 examples/ 下的相对路径" },
    },
    output: {
      schema: { type: "json" },
      render: (_a, v) => text(v),
    },
    execute: async (args, exec) => {
      const { sessionId } = assertAgentIdentity(exec);
      const manifest = loadManifest(CWD(), sessionId);

      const skillName = args.skillName;
      if (typeof skillName !== "string" || !skillName) {
        throw dshError("DSH_SKILL_NOT_ALLOWED", "缺少 skillName");
      }
      const rel = args.relativePath;
      if (typeof rel !== "string" || !isSafeReferenceRel(rel) || !rel.toLowerCase().endsWith(".md")) {
        throw dshError("DSH_SKILL_NOT_ALLOWED", `reference 路径非法：${String(rel)}`);
      }

      // 定位 Skill：persona 或 allowlist 中的确切版本
      let entry;
      let root;
      if (manifest.persona?.skillName === skillName) {
        entry = { name: skillName, contentHash: manifest.persona.skillHash, packageRoot: manifest.persona.snapshotRoot };
        root = resolveSnapshotRoot(CWD(), manifest);
      } else {
        entry = manifest.allowedSkills?.find((s) => s.name === skillName);
        if (!entry) throw dshError("DSH_SKILL_NOT_ALLOWED", `Skill 不在 allowlist：${skillName}`);
        root = resolveEntryRoot(CWD(), manifest, entry);
      }

      // 从该 Skill 自己的 resource index 查找（禁止未索引文件）
      const index = entry.resourceIndex ?? [];
      const target = index.find((r) => r.rel === rel);
      if (!target) {
        throw dshError("DSH_SKILL_NOT_ALLOWED", `reference 不在索引中：${skillName}#${rel}`);
      }
      // 读取前 realpath boundary check（readVerifiedFile 内已做）
      const body = readVerifiedFile(root, rel, target.hash, CWD(), 512 * 1024, target.size);
      return {
        source: "skill-reference",
        skillName,
        rel: target.rel,
        name: target.name,
        size: target.size,
        hash: target.hash,
        content: body,
      };
    },
  });
}

/** 从 exec 校验 agent.id（Session 身份的唯一来源）；不一致直接拒绝 */
function assertAgentIdentity(exec) {
  const agent = exec?.agent;
  if (!agent?.id) {
    throw dshError("DSH_MANIFEST_INVALID", "缺少执行 Agent 身份");
  }
  const sessionId = String(agent.id);
  if (!isSafeSessionId(sessionId)) {
    throw dshError("DSH_MANIFEST_INVALID", "Agent session id 非法");
  }
  // 与 env 中的回合 session 一致（双保险；env 缺失时至少以 agent.id 为准）
  const envSession = process.env.BT_DSH_SESSION_ID;
  if (envSession && envSession !== sessionId) {
    throw dshError("DSH_MANIFEST_INVALID", "执行 Agent 与回合 session 不一致");
  }
  return { sessionId };
}

/** persona 快照根：data/dsh/snapshots 内（绝对路径做边界） */
function resolveSnapshotRoot(cwd, manifest) {
  const root = manifest.persona?.snapshotRoot;
  if (!root) throw new ManifestError("DSH_MANIFEST_INVALID", "persona 缺 snapshotRoot");
  return resolveRoot(cwd, root, "snapshot");
}

/** 找到 persona 的完整 SKILL.md 正文（hash 校验） */
function readPersonaSkill(cwd, manifest) {
  const root = resolveSnapshotRoot(cwd, manifest);
  const body = readVerifiedFile(root, "SKILL.md", manifest.persona.skillHash, cwd, 256 * 1024);
  return body;
}

/**
 * 在 agent 的 scoped context 上注册 provider/tools/restrict/guard（P0 Task 2.2）。
 * 不接受调用方传入 sessionId：全部从 agent.id 取得。
 */
function mountAgentScope(agent) {
  const sessionId = String(agent.id);
  if (!isSafeSessionId(sessionId)) {
    throw dshError("DSH_MANIFEST_INVALID", "Agent session id 非法");
  }
  // 启动时 fail-closed：manifest 必须存在且与 agent.id 精确一致
  const manifest = loadManifest(CWD(), sessionId);
  if (manifest.sessionId !== sessionId) {
    throw dshError("DSH_MANIFEST_INVALID", "manifest sessionId 与 Agent 不一致");
  }
  if (manifest.toolPolicy?.webSearch === true) {
    throw dshError("DSH_MANIFEST_INVALID", "P0 未开启 web_search：内部搜索 endpoint 尚未提供");
  }

  // Cordis service properties are only available from an injected context.
  // `agent.ctx` itself is a context proxy, not a service bag; reading
  // `agent.ctx.skills` directly fails with "without inject" in the real DSH.
  return agent.ctx.inject(["skills", "systemPrompt", "tools"], (scoped) => {
    const after = new Set(P0_ALLOWED_TOOLS);
    if (manifest.toolPolicy?.webSearch) after.add(P0_WEB_SEARCH);

    const providerName = "business-talking";
    // SkillProvider：list/get 只返回当前 manifest 的 Persona profile + allowedSkills（fail-closed）
    scoped.skills.registerProvider((_control) => ({
    name: providerName,
    async list() {
      const m = loadManifest(CWD(), sessionId);
      const out = [];
      if (m.persona) {
        out.push({
          name: m.persona.skillName,
          description: `Persona: ${m.persona.name}`,
          invocation: { modelInvocable: true, userInvocable: false },
          source: "custom",
          provider: providerName,
          resourceBase: opaqueResourceBase(m.persona.skillName),
          rank: 600,
          locator: {
            kind: "persona",
            name: m.persona.skillName,
            version: m.persona.skillVersion,
            hash: m.persona.skillHash,
          },
        });
      }
      for (const s of m.allowedSkills ?? []) {
        if (m.persona?.skillName === s.name) continue;
        out.push({
          name: s.name,
          description: skillDescription(s.name, s.description),
          invocation: { modelInvocable: true, userInvocable: false },
          source: "custom",
          provider: providerName,
          resourceBase: opaqueResourceBase(s.name),
          rank: 600,
          locator: { kind: "skill", name: s.name, version: s.version, contentHash: s.contentHash },
        });
      }
      return out;
    },
    async get(candidate) {
      const m = loadManifest(CWD(), sessionId);
      const { candidate: candidateValue, locator } = candidateRecord(candidate);
      if (locator.kind === "persona") {
        if (
          !m.persona ||
          m.persona.skillHash !== locator.hash ||
          m.persona.skillName !== locator.name ||
          m.persona.skillName !== candidateValue.name ||
          m.persona.skillVersion !== locator.version
        ) {
          throw dshError("DSH_SKILL_NOT_ALLOWED", "Persona hash/name 不匹配");
        }
        const skillContent = readPersonaSkill(CWD(), m);
        return {
          name: m.persona.skillName,
          description: `Persona: ${m.persona.name}`,
          invocation: { modelInvocable: true, userInvocable: false },
          source: "custom",
          provider: providerName,
          resourceBase: opaqueResourceBase(m.persona.skillName),
          content: `${skillContent}\n\n<persona ${m.persona.name}>\n${m.persona.systemPrompt}`,
        };
      }
      if (
        locator.kind !== "skill" ||
        typeof locator.name !== "string" ||
        typeof locator.version !== "string" ||
        typeof locator.contentHash !== "string" ||
        locator.name !== candidateValue.name
      ) {
        throw dshError("DSH_SKILL_NOT_ALLOWED", "Skill locator/name 不匹配");
      }
      const skill = m.allowedSkills.find(
        (s) => s.name === candidateValue.name && s.name === locator.name && s.version === locator.version && s.contentHash === locator.contentHash
      );
      if (!skill) throw dshError("DSH_SKILL_NOT_ALLOWED", "Skill 不在 allowlist 或 hash 不一致");
      // 完整 SKILL.md 由真实 packageRoot 读取并校验 contentHash（不返回占位文本）
      const skillRoot = resolveEntryRoot(CWD(), m, skill);
      const content = readVerifiedFile(skillRoot, "SKILL.md", skill.contentHash, CWD(), 256 * 1024);
      return {
        name: skill.name,
        description: skillDescription(skill.name, skill.description),
        invocation: { modelInvocable: true, userInvocable: false },
        source: "custom",
        provider: providerName,
        resourceBase: opaqueResourceBase(skill.name),
        content,
      };
    },
    }));

    // systemPrompt section（只对该 agent 生效，不覆盖全局）
    scoped.systemPrompt.section({
    name: PERSONA_SECTION,
    order: scoped.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA"),
    text: () => {
      const m = loadManifest(CWD(), sessionId);
      if (m.kind !== "persona" || !m.persona) return "";
      const skillBody = readPersonaSkill(CWD(), m);
      return `${skillBody}\n\n<persona ${m.persona.name}>\n${m.persona.systemPrompt}`;
    },
    });

    // scoped 只读工具（read_skill_reference 必注册；web_search 仅 manifest 允许时）
    scoped.tools.register(buildReadSkillRefTool());
    if (manifest.toolPolicy?.webSearch) scoped.tools.register(buildWebSearchTool());

    // `restrict()` filters only inherited/global tools. Scoped registrations
    // remain visible by design, so do not pass read_skill_reference or
    // web_search here; the guard below covers the complete visible roster.
    scoped.tools.restrict({ allow: ["skill"] });

    // tools.guard：执行前二次校验（即使某个默认 entry 因依赖仍被加载也不能执行）
    scoped.tools.guard((execution) => {
      const name = execution.name;
      if (!after.has(name)) {
        return `工具 ${name} 不在 P0 只读 allowlist，拒绝执行`;
      }
      try {
        assertAgentIdentity(execution);
      } catch (e) {
        return String(e.message ?? e);
      }
      return undefined;
    });
  });
}

/** Cordis 插件入口：监听 agent/created，为每个 agent 挂载 scoped 权限边界 */
export function apply(ctx) {
  ctx.on("agent/created", (payload) => {
    mountAgentScope(payload.agent);
  });
}
