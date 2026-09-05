# 步骤5：DSH plugin 真实 API 核对（已核验 + 待定）

> 依据 `dsh-runtime-execution-plan.md` §4.3/§4.4/§6，核对 `@deepseek-ai/dsh-skill` 与
> `@deepseek-ai/dsh-tools` 的插件/Provider/Tool API。已核验的部分可直接落地；
> 未定稿部分（prompt section、hook 事件名、SDK provider 值、插件装载机制-已解决）标注。

## 0. 插件装载机制（✅ 已核验 + 已修复，2026-09）

用 `cordis-plugin-loader` 的 `import()`（`lib/index.js` 第 275 行）确认：`name` 以 `.` 开头会被当作
**相对路径**导入（相对 dsh 进程 cwd）。`unwrapExports` 会展开 `default`/`__esModule`。

**实测发现并修复**
- **相对路径在 pnpm 布局下无法装载**：项目用 pnpm 严格 node_modules 时，`name: './runtime/dsh-plugin/index.mjs'`
  在 dsh 运行时里解析到错误 base、插件模块根本没加载（连只写标记的最小插件都不加载）。
- **修复**：`name` 用 `file://` 绝对路径（`pathToFileURL(绝对路径).href`）即可被装载。已在
  `src/lib/runtime/singleton.ts` 的 `ensurePluginPatch()` 里运行时生成（可移植），并作为第二张 patch 传入。
- **不能禁用 subagent**：patch 里 `- id: subagent disabled: true` 会破坏 `@deepseek-ai/dsh-subagent-spawn-in-process`
  （报 “8 entries did not activate”）。subagent 阶段由 BusinessTalking 侧控制，不在 patch 层 disable。

**E2E 验证通过（真实运行时）**：`dsh --profile sdk` + 插件 patch 跑真实 agent 回合，插件标记显示
`inject:ready` + `tools:read_skill_reference,web_search` + `skillprovider:business-talking`（SkillProvider 与两个
只读工具都注册成功），且模型回复体现 manifest 里的人格 systemPrompt（“我是测试人格…”，人格身份注入生效）。

Cordis 插件形态：`(ctx, config) => any` 函数 | `new (ctx, config)` 类 | `{ apply(ctx, config) }` 对象，
默认/命名 export 均可。因此 `runtime/dsh-plugin/index.mjs` 导出 `apply(ctx)` 即可被装载。
注册应由 `ctx.inject(["tools","skills"], cb)` 在 live 子上下文完成（避免在 inactive 根上下文注册失败）。

**manifest 通道**：插件从 `data/dsh/manifests/<sessionId>.json` 读取（sessionId 由 env `BT_DSH_SESSION_ID`
传入，生产应由 `agent/session-start` 的 agent id 决定）。

## 1. Skill Registry / Provider（已核验，`@deepseek-ai/dsh-skill`）

```ts
// ctx.skills: SkillRegistry
ctx.skills.registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void
ctx.skills.register(skill: SkillRegistration): () => void
ctx.skills.list(options?: SkillViewOptions): Promise<SkillSummary[]>
ctx.skills.get(name: string, options?: SkillViewOptions): Promise<SkillDefinition | undefined>
ctx.skills.snapshot(options?: SkillViewOptions): Promise<SkillCatalogSnapshot>

interface SkillProvider {
  readonly name: string
  list(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation>
  get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined>
}
interface SkillProviderControl { signal: AbortSignal; invalidate(): void }
interface SkillLookupOptions { cwd?: string; signal?: AbortSignal }

interface SkillCandidate extends SkillSummary {
  rank: number            // 越低越优先；packaged=600 (BUNDLED_SKILL_RANK)
  locator: unknown        // 不透明句柄，get() 时回传
  path?: string
  metadata?: Readonly<Record<string, unknown>>
}
interface SkillSummary {
  name: string            // kebab-case
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  source: SkillSource     // project-dsh|project-agents|runtime|user-*|custom|bundled|(string)
  provider: string
  resourceBase?: SkillResourceBase  // {kind:'directory',path}|{kind:'url',url}|{kind:'opaque',description}
}
interface SkillDefinition extends SkillSummary { content: string; path?: string; metadata?: Record<string,unknown> }
interface SkillRegistration extends Omit<SkillDefinition,'invocation'|'provider'> {
  invocation?: SkillInvocationPolicy; provider?: string
}
```

落地要点（BusinessTalking plugin）：
- 用 `ctx.skills.registerProvider(...)` 注册一个 **scoped provider**：`name:'business-talking'`。
- `list()` 只返回当前 manifest 的 Persona profile + allowedSkills（kebab name、description、可选的
  `resourceBase:{kind:'opaque',description:...}`），`rank` 用低值，`locator` 指向 manifest 中对应的
  allowed-skill/rev（最终 body 由 `get()` 返回，普通 Skill 完整 SKILL.md 由 DSH skill tool 按需加载）。
- `get()`：按 `locator` 精确定位 manifest 的 name/version/hash，返回 `{ name, content, ... }`；不在
  allowlist/非当前 manifest → 抛 `DshSkillNotAllowed`（fail-closed）。
- provider 的 allowlist 是 **agent scope 内的闭包状态**：两个 Session 即使同名 Skill 也互不可见。
  call 时用 `options.scope`（代理 agent 的 scope key）区分——但 `list/get` 的 options 只有
  `{cwd,signal}`，scope 由 **registration 上下文**（agent-scoped context）决定，即该 provider 必须
  在 **per-agent 的 scoped context** 上注册，才能保证隔离。这要求 plugin 在 `agent/session-start`
  （或 agent scope）内调用 `registerProvider`，而不是进程全局。

## 2. Tool Registry（已核验，`@deepseek-ai/dsh-tools`）

```ts
// ctx.tools: ToolRuntime
ctx.tools.register(definition: ToolDefinition): () => void
ctx.tools.restrict(filter: ToolRestriction): () => void  // {allow?,deny?} 全局工具掩码
ctx.tools.guard(guard: (execution: Readonly<ToolExecution>) => string | undefined): () => void

interface ToolDefinition extends ToolSchema {  // name/description/parameters
  output: ToolOutputDefinition                 // 必须
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  timeoutMs?: number
}
interface ToolOutputDefinition { schema: JsonSchemaNode; render(args: unknown, value: JsonValue): ContentBlock[] }
interface ToolRunContext extends ToolExecution { deferContext(ctx: UserMessage): void; concludeTurn(): void }
```

`defineTool(...)`（来自 `./schema.ts`）是推荐的高层封装，可省去手写 `output.render`。落地要点：
- `read_skill_reference({skillName, relativePath})` 和 `web_search({query,maxResults})` 用
  `ctx.tools.register(...)` 注册到 **agent scoped context**（per-agent 可见，配合 `ctx.tools.restrict`
  控制器 roster / 限制副作用工具）。
- 返回值是 `JsonValue`；`output.render` 负责把它转成 `ContentBlock[]`（text）。
- 通过 `ctx.tools.guard`/`restrict` 封禁 `tool-web`/`tool-bash` 等（更稳妥的是在 cordis.patch 直接
  `disabled` 这些 entry + install 一个 BusinessTalking 的 provider 白名单）。

## 3. 待定（需在真实 runtime 上验证后才能定稿）

1. **本地插件装入机制**：SDK 生成的 `dsh --profile sdk` runtime 如何装载一个**非 npm 包**的本地插件
   （`runtime/dsh-plugin/index.mjs`）。`--dump-config` 显示插件按 `name: 'dsh-plugin-desktop/terminal'`
   引用；本地路径插件是否可用 `patch` 的 `insert` 中的 `name: 'file:///...'` 或需先 `pnpm link` /
   装成包，需验证。
2. **`agent/session-start` / `agent/pre-step`**：方案提到的两个 hook 事件在 `dsh-agent` 的公开 `Agent`
   接口没有直接暴露（`Agent` 只有 `id`）；事件大多在 `dsh-agent-loop` 的 `SessionEventMap`（如
   `agent/inbox/spliced`）。需确认 session-start 的订阅点（可能是 `agent/session-start` 事件或
   CreateAgentOptions.setup / dsh-agent-loop 生命周期），以及 pre-step 的 fail-closed 校验点。
3. **Persona prompt section（`deployment:persona`）**：在哪儿注册 system-prompt 的自定义 section；
   `@deepseek-ai/dsh-agent-*`/`dsh-system-prompt` 的 section 注册 API 需确认（`user/message` 事件
   data 中出现 `sections:[{name,text}]`，说明有 section 机制，但注册入口未定稿）。
4. **SDK `provider` 值**：`DeepSeekHarness({provider})` 对 `llm-pi-ai` 的 openai/anthropic route 应传
   什么值（`openai-completions`? `llm-pi-ai`?）——我实测 `provider:'deepseek-official'` 成功；openai
   路由需要验证。`runtime/dsh-runtime.ts` 当前把 `profile.provider`（`openai`/`anthropic`）直接传给
   SDK，这与 `buildRuntimeProfile` 需进一步对齐。
5. **`dsh --profile sdk --dump-config`** 有当前机器注入的 `<system-reminder>`（AGENTS.md/CLAUDE.md/
   runtime context）。BusinessTalking 讨论 Session 若不希望项目 AGENTS.md 泄漏进讨论上下文，需在 patch
   里关闭或覆盖 `dsh-system-prompt`/指令注入。

## 4. `dsh --profile sdk --dump-config` 相关 id（步骤6 收尾 patch 用）

`skill-filesystem`、`tool-web`、`web-search-deepseek`、`web-fetch-http`、`llm-pi-ai`、`llm-deepseek`、
`tool-bash`、`tool-goal`、`tool-todo`、`tool-workflow`、`tool-jobs`、`subagent`、`agent-loop`、
`system-prompt`、`session-projection`。方案 §5.2 的 patch 逐一 `disabled` 上述不用的，仅保留
BusinessTalking plugin + 只读 `read_skill_reference`/`web_search`。
