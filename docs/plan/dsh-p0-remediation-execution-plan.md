# DSH P0 修复执行计划

> **给执行 AI：** 必须按本计划逐项执行。推荐使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`，每个任务先补失败测试，再做最小实现，完成后运行本任务验收命令并提交一次。不要用 `git reset --hard`、`git checkout --` 覆盖现有改动。

**目标：** 修复 DSH 讨论链路中会造成安全越权、人格/Skill 串用以及“DSH 已失败但业务显示成功”的 P0 问题，使每一条成功回复都能证明来自当前 Session 的合法 DSH 执行。

**当前真实基线：** 当前 checkout 的生产讨论路径是 `runOneOnOneTurn()` / `runDiscussion()` → `runTurnViaDsh()` → `runTurnViaProcess()` → `scripts/dsh-turn.mjs`；每个回合创建独立 Node 子进程，并通过 `BT_DSH_SESSION_ID` 选择 manifest。`DshRuntimeManager` 仍存在于 runtime 层，但本 P0 不把系统改成常驻 Manager，也不把旧的 `turn-process` 路径误判成已删除。

**架构决策：** P0 保留“每回合一个干净 Node 子进程”的隔离边界，先恢复安全和错误真实性；同一子进程内的 DSH Agent 仍必须通过 `agent.ctx` 做 scoped provider/tool/system-prompt 注册，不能把权限和 manifest 注册到全局。后续若切换到常驻 Runtime，必须继续使用同一套 Agent-scoped 约束，不能重新引入进程级环境变量承载多个 Session 的身份。

**技术栈：** Next.js 16、TypeScript、Prisma 6、SQLite、pnpm、Vitest、`@deepseek-ai/dsh-sdk-client@0.1.2-rc.1`、`@deepseek-ai/dsh@0.1.2-rc.1`、DSH Cordis plugin/patch。

**依据：**

- 总体方案：`docs/plan/dsh-runtime-execution-plan.md`
- 评审报告：`docs/plan/dsh-runtime-migration-review.md`
- DSH Skill/Tool API 核对：`docs/plan/step-5-dsh-plugin-api-notes.md`

## P0 范围

本计划只处理以下三个发布阻断项：

1. DSH 实际工具 roster 收敛到只读能力，不能执行 Shell、文件写入、编辑、子 Agent 或其他外部副作用。
2. 当前 DSH Agent 必须绑定当前 `BT_DSH_SESSION_ID` 对应的 manifest；Persona、Persona `SKILL.md`、普通 Skill 和 reference 必须使用固定版本、固定 hash、当前讨论 allowlist。
3. DSH 启动、握手、协议、manifest、权限或模型回合失败时，禁止隐式调用 AI SDK、禁止伪造空回复/Moderator proposal、禁止把讨论标记为成功。

明确不纳入本轮 P0：provider/baseURL 路由重构、1v1 跨回合历史承接、Moderator 完整发言正文、steer 状态接通、真正的 state CAS、AgentEvent 完整落库、snapshot 全资料包版本冻结、archive/purge 调度。这些另立 P1/P2 任务；本计划不得以“顺便重构”为理由扩大范围。前端 SSE/轮询保底已经有单独修复，不在本计划改动。

## 全局执行约束

- 开始前完整阅读根目录 `AGENTS.md`、本文件、总体方案和评审报告；先检查 `git status --short`，保留执行 AI 或用户已有改动。
- Next.js 代码修改前，按 `AGENTS.md` 要求读取当前安装版本 `node_modules/next/dist/docs/` 中与修改点相关的指南；不要套用旧版 Next.js 约定。
- 业务默认路径只能使用 DSH。旧的 `src/legacy/**` 可以保留，但任何 `catch`、重试或错误处理都不能调用它。
- 不扫描 `.agents/skills`、用户 home 或任意 workspace 文件来补 Skill；只读当前 manifest 指向的 snapshot/packageRoot。
- 不把 API key 写入 manifest、prompt、事件、日志或错误消息。子进程环境只能传给 DSH 所需的短期凭据和必要配置。
- 外部 reference/web search 返回内容始终是不可信资料，只能作为 tool result，不能覆盖 system prompt、BusinessTalking policy 或 P0 guard。
- 每个小任务遵循：先写失败测试 → 运行并确认失败原因 → 最小实现 → 运行该任务测试 → 再运行全量测试 → 提交。不要在一个提交中混入 P1/P2 改造。

## 执行前基线

- [ ] 记录 `git status --short`、当前分支和最近提交；若工作树有未提交内容，先在执行记录中列出，不得覆盖。
- [ ] 运行 `pnpm exec vitest run` 和 `pnpm exec tsc --noEmit --incremental false`，保存基线输出。
- [ ] 用当前项目依赖解析到的 `@deepseek-ai/dsh` 执行 `dsh --profile sdk --dump-config`，不要调用桌面版 DSH。确认 dump 中存在 `skill`、`skill-filesystem`、`llm-pi-ai`、`llm-deepseek`、`agent-loop`、`system-prompt` 以及现有 tool ids。
- [ ] 以当前文件为准记录生产链路：`src/lib/discussion/dsh-service.ts` 当前仍调用 `runTurnViaProcess`；不要依据过时文档把它改成另一条未经验证的运行方式。

---

## Task 1：建立 P0 policy、manifest 和错误分类测试

**目的：** 先把“允许什么、什么错误必须终止、manifest 最低合法形状”固化成可测试的契约，后续实现只能依赖这些契约。

**涉及文件：**

- `src/lib/dsh/errors.ts`
- `src/lib/dsh/manifest.ts`
- `tests/unit/dsh-manifest.test.ts`
- `tests/unit/dsh-errors.test.ts`（新建）
- `tests/unit/dsh-plugin.test.ts`（新建；如需测试 `.mjs`，同步调整 `vitest.config.mjs` 的 include）

### 1.1 错误契约

- [ ] 增加可复用的 `isDshError()`、`dshErrorCode()` 和 `isFatalDiscussionRuntimeError()` helper；不要在业务代码里通过错误 message 字符串判断。
- [ ] `DSH_START_FAILED`、`DSH_INITIALIZE_FAILED`、`DSH_PROTOCOL_FAILED`、`DSH_ROUTE_UNSUPPORTED`、`DSH_CREDENTIAL_INVALID`、`DSH_MANIFEST_INVALID`、`DSH_SKILL_NOT_ALLOWED`、`RUNTIME_PROFILE_CONFLICT` 和未知错误均属于 fail-closed 终止类。
- [ ] 只有明确的 `DSH_TURN_FAILED` 才能作为“单个 Persona 模型回合失败、同轮继续其他 Persona”的可继续类；`DshSessionBusyError` 不得被静默吞掉，按冲突错误返回并保持当前讨论非成功状态。
- [ ] 测试必须证明：运行时/协议/manifest/权限错误判断为 fatal；单纯模型回合错误判断为可标记 failed 的 turn 错误；未知 `Error` 默认 fatal。

### 1.2 manifest 合法性契约

- [ ] 保留 `schemaVersion: 1`，但把当前过宽的 schema 收紧：`sessionId`、`discussionId`、`kind`、`runtimeProfile`、`toolPolicy` 必须存在且为正确类型；hash 必须是 64 位小写 hex；size 必须是非负整数并受大小上限约束。
- [ ] `kind: "persona"` 必须有 `participantId`、`persona`，并且 `allowedSkills` 必须包含唯一的 `persona-profile`，其 version/hash/packageRoot 与 `persona` 完全一致。
- [ ] `kind: "moderator"` 不得有 `persona`，`allowedSkills` 必须为空，`toolPolicy.webSearch` 必须为 `false`。
- [ ] 普通 `allowedSkills` 的 `packageRoot` 不允许为 `null`；必须指向安装过的不可变目录。不能把旧的没有 `packageRoot` 的 manual Skill 作为可执行 Skill。
- [ ] `allowedSkills` 名称必须唯一，且不允许普通 Skill 覆盖 `persona-profile`；所有 resource index 的路径只允许 `references/` 或 `examples/`，禁止绝对路径、`..`、重复条目和不合法 hash。
- [ ] 在 `parseManifest()` 的测试中覆盖：缺 session、persona/moderator 字段互相矛盾、空 packageRoot、重复 Skill、路径穿越、错误 hash、`sideEffects: true`、旧 `bt-e2e` 之外的合法 session。

### 1.3 P0 工具 policy 契约

- [ ] 在 TypeScript 中定义单一的 P0 allowed tool 名称集合：`skill`、`read_skill_reference`，以及只有 manifest 明确允许且内部 endpoint/token 均存在时才可加入的 `web_search`。
- [ ] policy 必须同时用于“模型可见 schema”和“实际执行 guard”；不能只改 prompt 或只改 manifest 数据。
- [ ] 测试证明任意 `tool-bash`、`tool-pwsh`、`tool-fs`、`tool-fs-search`、`tool-str-replace-editor`、`tool-subagent*`、`tool-ralph`、`tool-web`、`web-fetch-http` 都不在 P0 allowlist。

- [ ] 完成本任务后提交：`test: define DSH P0 safety contracts`。

---

## Task 2：锁死实际 DSH 只读工具 roster

**目的：** 让 `toolPolicy.sideEffects=false` 不再只是 manifest 中的一段数据，而成为 patch、Agent scope 和执行前 guard 三层共同生效的权限边界。

**涉及文件：**

- `runtime/dsh/cordis.patch.yml`
- `runtime/dsh-plugin/index.mjs`
- `runtime/dsh-plugin/manifest.mjs`（新建；承载纯 manifest/path/hash helper）
- `src/lib/runtime/singleton.ts`
- `src/lib/runtime/turn-process.ts`
- `scripts/dsh-turn.mjs`
- `tests/e2e/dsh-config-smoke.test.ts`
- `tests/unit/runtime-singleton.test.ts`
- `tests/unit/dsh-plugin.test.ts`

### 2.1 Patch 层关闭默认副作用能力

- [ ] 根据当前 `dsh --profile sdk --dump-config` 的真实 entry id，在 `runtime/dsh/cordis.patch.yml` 中显式关闭：
  - `skill-filesystem`、`tool-web`、`web-search-deepseek`、`web-fetch-http`；
  - `tool-bash`、`tool-pwsh`、`tool-fs`、`tool-fs-search`、`tool-str-replace-editor`；
  - `tool-goal`、`tool-todo`、`tool-workflow`、`tool-jobs`、`tool-ralph`；
  - `tool-subagent`、`tool-subagent-fork` 及 dump 中对应的 `tool-subagent-*` rows、`workflow-worker-thread`；
  - 未使用的 `llm-deepseek`。
- [ ] 保留 `skill`、`agent-loop`、`system-prompt`、`session-projection` 以及 DSH 必需的 service。不要直接关闭 `subagent`/`dsh-subagent-spawn-in-process` service 本体，因为当前 DSH 版本存在依赖导致 profile boot 失败；即使 service 保留，也必须由下一层 Agent scoped restriction/guard 使其不可见、不可调用。
- [ ] 不以“patch 中找不到某 id”为成功条件。每个目标 entry 都要在同版本 dump-config 中被解析并显示 `disabled: true`；缺失或改名要让 smoke test 失败，促使执行者按当前实际 id 更新 patch。

### 2.2 Agent scoped roster 和 guard

- [ ] 删除 `runtime/dsh-plugin/index.mjs` 当前在全局 `ctx.inject()` 中注册两个 tool/provider 的实现。
- [ ] 在 DSH `agent/created` 事件中，对每个 `payload.agent` 同步执行 `mountAgentScope(agent)`：先读取并验证 `agent.id` 对应 manifest，再使用 `agent.ctx` 注册 provider、system prompt、tools、`tools.restrict({ allow: [...] })` 和 `tools.guard(...)`。DSH 的公开 API 已确认 `agent.ctx.skills.registerProvider()`、`agent.ctx.tools.register()`、`agent.ctx.tools.restrict()`、`agent.ctx.tools.guard()` 和 `agent.ctx.systemPrompt.section()` 可用。
- [ ] `mountAgentScope()` 不得接受调用方传入的 session id；所有 tool 执行从 `exec.agent?.id` 取得当前 Agent id，再加载同一 manifest。缺少 `exec.agent`、id 与 manifest 不一致或 manifest 不存在时直接拒绝。
- [ ] `skill` 是保留的 DSH Skill tool；BusinessTalking 只提供 scoped provider。`read_skill_reference` 和 `web_search` 必须是当前 Agent 的 scoped registration，不能在根 context 注册。
- [ ] guard 对任何不在 P0 allowlist 的实际调用返回拒绝原因；即使某个默认 entry 因 DSH 依赖仍被加载，也不能执行。
- [ ] `resourceBase` 只能使用 `{ kind: "opaque", description: "..." }`，description 不得包含 `G:\`、`C:\`、`/Users/` 等宿主绝对路径。

### 2.3 子进程权限环境

- [ ] `src/lib/runtime/turn-process.ts` 和 `scripts/dsh-turn.mjs` 继续使用显式环境白名单，但只额外传递当前回合所需的 `BT_DSH_SESSION_ID`、`BT_DSH_HOME`、`BT_DSH_PROVIDER`、`BT_DSH_MODEL`、`BT_DSH_CWD`、`BT_DSH_BIN`、`BT_DSH_PATCHES` 和必要 credential env。
- [ ] 显式设置 DSH 只读 sandbox/policy 所需的环境值（当前安装版本使用 `DSH_PERMISSION_MODE=read-only` 时必须传入）；如果某项只能通过 patch 设置，就在 patch 中固定为 read-only。不能保留 `workspace-write` 默认值。
- [ ] 不传递 `NODE_OPTIONS`、Electron 专用变量、桌面 DSH home、任意父进程 tool/MCP 配置；不要把内部 token 或 API key 打到启动诊断日志。
- [ ] 缺少 session、provider、model、cwd、DSH home 或 patch 时，runner 在启动模型前失败；不得使用 `bt-e2e`、`deepseek-official`、`deepseek-v4-flash` 等隐式默认值掩盖配置缺失。

### 2.4 web_search 的安全默认值

- [ ] 当前仓库没有可供 DSH plugin 调用的 `src/app/api/internal/dsh/web-search/route.ts`，所以 P0 默认将 manifest 的 `toolPolicy.webSearch` 设为 `false`，不得注册一个必然失败或可绕过授权的搜索工具。
- [ ] 本 P0 不新增内部搜索 endpoint，也不打开 `web_search`；它明确保持关闭。内部 endpoint、短期 token、上游失败语义和 `web_search` 能力另立 P1，避免执行 AI 在 P0 中自行扩展网络权限。

### 2.5 测试和验收

- [ ] 扩展 `dsh-config-smoke.test.ts`：使用项目同版本 DSH 和 `runtime/dsh/cordis.patch.yml`，解析每个目标 entry，断言其不在 active roster；同时断言 `skill`/`agent-loop`/`system-prompt` 仍存在。
- [ ] 为 plugin scoped mount 增加两个不同 session 的 fixture：Session A 的 provider 只能 list/get A 的 Skill，Session B 只能 list/get B 的 Skill；在 A 的 tool execution 中伪造 B 的 `skillName` 或 session id 必须拒绝。
- [ ] 测试 `resourceBase` 不泄漏宿主绝对路径，path boundary 使用 `path.relative()`/`realpath()`，不能用无分隔符的 `startsWith()` 作为唯一安全判断。
- [ ] 完成本任务后运行目标测试并提交：`fix: enforce DSH read-only tool roster`。

---

## Task 3：修复 manifest、Persona 和 Skill 的 Session 绑定

**目的：** 消除固定 `bt-e2e`、全局 provider、Persona Skill 占位文本和未授权普通 Skill，使每个 DSH Agent 只能看到当前讨论锁定的资料。

**涉及文件：**

- `src/lib/dsh/manifest.ts`
- `src/lib/dsh/snapshot.ts`（仅在需要暴露完整 Persona `SKILL.md` 校验信息时修改）
- `src/lib/discussion/dsh-service.ts`
- `src/app/api/v1/discussions/route.ts`（仅补创建时 allowlist/manifest 所需校验，不改 API 范围）
- `runtime/dsh-plugin/manifest.mjs`
- `runtime/dsh-plugin/index.mjs`
- `tests/unit/dsh-manifest.test.ts`
- `tests/unit/dsh-plugin.test.ts`
- `tests/unit/dsh-service-manifest.test.ts`（新建）

### 3.1 当前 Session 必须是唯一身份来源

- [ ] `runtime/dsh-plugin/manifest.mjs` 的 `loadManifest()` 只接受显式 `sessionId`；默认值、空字符串和 `bt-e2e` 一律删除。
- [ ] plugin 启动/Agent created 时读取 `process.env.BT_DSH_SESSION_ID`，验证它是安全文件名，并验证 `manifest.sessionId === BT_DSH_SESSION_ID`。任何不一致在模型请求前抛出 `DSH_MANIFEST_INVALID`。
- [ ] manifest 文件必须位于当前项目 `data/dsh/manifests`；snapshot/packageRoot 必须分别位于 `data/dsh/snapshots`、`data/skill-library` 之内。使用 `path.resolve` + `path.relative` + `realpath` 做边界检查，拒绝 symlink/路径逃逸。
- [ ] 删除 `runtime/dsh-plugin/index.mjs` 模块加载探针、`plugin-loaded.marker`、`plugin-ran.marker` 和所有硬编码 `G:/claude_project/...` 写入。插件加载不得创建或追加工作区文件。

### 3.2 Persona 初始化必须加载完整身份资料

- [ ] `agent.ctx.systemPrompt.section()` 注册名称固定为 `deployment:persona`，顺序使用 `agent.ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA")`；不得使用全局 section 覆盖其他 Agent。
- [ ] Persona section 至少包含 manifest 中的 `systemPrompt` 和经过 hash 校验的 snapshot `SKILL.md` 完整正文。读取失败、正文超限或 hash 不匹配时，在首个模型请求前抛 `DSH_MANIFEST_INVALID`。
- [ ] 返回给 DSH Skill registry 的 Persona definition 也必须包含完整 `SKILL.md`，不能返回“由 skill tool 按需加载”的占位文字。
- [ ] Persona reference 只返回索引；正文不 eager 注入 system prompt，仍由 `read_skill_reference` 按需读取。

### 3.3 普通 Skill allowlist 必须来自当前 Discussion

- [ ] 将 `buildPersonaManifest()` 改为异步函数，并查询：

  ```text
  prisma.discussionSkill.findMany({
    where: { discussionId },
    include: { skillRevision: true },
    orderBy: { createdAt: "asc" }
  })
  ```

- [ ] 每个 revision 必须有 `packageRoot`、完整 `SKILL.md`、数据库 `contentHash` 和可验证的资源 index；缺任一项都抛 `DshManifestError`，不能回退到 `Skill.instructions`、旧 Skill 表或 workspace 文件。
- [ ] manifest 的 `allowedSkills` 包含 Persona profile 加上当前 `DiscussionSkill` 选中的 revision，精确记录 `name/version/contentHash/packageRoot/description/resourceIndex`；同名或 hash 不一致直接失败。
- [ ] plugin provider 的 `list()` 只返回 manifest 中的 Persona profile 和普通 Skill；不调用 filesystem provider、不扫描任意 Skill 目录。
- [ ] provider `get(candidate)` 必须重新按 locator 校验 name/version/contentHash，读取对应 packageRoot 下完整 `SKILL.md`，计算 sha256 与 manifest 比较后返回全文。任何不一致抛 `DSH_SKILL_NOT_ALLOWED` 或 `DSH_MANIFEST_INVALID`。
- [ ] 普通 Skill 的返回内容不能是占位文本，不能把 `instructions` 截断，也不能让模型自行提供路径。

### 3.4 reference 读取必须绑定 Skill 和 hash

- [ ] `read_skill_reference({ skillName, relativePath })` 从 `exec.agent.id` 加载当前 manifest；先验证 `skillName` 是 Persona 或普通 allowlist 中的确切版本，再从该 Skill 自己的 resource index 查找 `relativePath`。
- [ ] 只允许 `references/`、`examples/`；拒绝绝对路径、`..`、空路径、未索引文件、非 Markdown、超过 512 KiB 文件和 hash 不匹配文件。
- [ ] 读取前后都做 realpath boundary check；返回 JSON 中标记 `source: "skill-reference"` 和不可信资料边界，但不把 reference 写入 system prompt。
- [ ] A/B 两个 Session 使用同名不同 hash Skill 时，A 不能读取 B 的 reference；错误应是明确的 `DSH_SKILL_NOT_ALLOWED`，不是空字符串或当前 Persona reference 的误读。

### 3.5 service manifest 生成与清理

- [ ] `ensurePersonaSession()` 先完成 Persona snapshot、当前 Discussion allowlist 和严格 manifest，再启动 DSH；不能先启动后补 manifest。
- [ ] `writeManifestAtomic()` 前调用 `parseManifest()`；`runTurnViaDsh()` 的 `finally` 仍清理本回合 manifest，但清理失败要记录错误并保持原始 DSH 错误，不得把清理异常转成成功。
- [ ] `writeModeratorManifestForSession()` 生成严格的 moderator manifest：无 Persona、无普通 Skill、无 web_search、无副作用工具。
- [ ] 不在本 P0 修改 `freshTurnSessionId()` 的历史语义；P0 只保证每个新回合的临时 session 与其 manifest 精确一致。稳定 Session/历史承接另做 P1。

### 3.6 测试和验收

- [ ] 测试缺 manifest、manifest session 不匹配、损坏 JSON、错误 Persona hash、错误普通 Skill hash、空 packageRoot、未授权 Skill、未索引 reference、路径穿越和资源 hash 变化均失败。
- [ ] 测试同一 Persona 两个 Discussion 生成不同 session 文件时，provider/Persona/system prompt 不串线。
- [ ] 测试创建 Discussion 时选择的 `skillRevisionIds` 全部进入 manifest；未选择的已安装 revision 不出现在 DSH catalog。
- [ ] 完成本任务后运行 `pnpm exec vitest run tests/unit/dsh-manifest.test.ts tests/unit/dsh-plugin.test.ts tests/unit/dsh-service-manifest.test.ts`，通过后提交：`fix: bind DSH identity and skill allowlists per session`。

---

## Task 4：删除隐式 AI SDK fallback 和伪成功路径

**目的：** DSH 失败必须在业务状态、SSE 和多人 orchestrator 中保持真实失败，不能因为兜底生成或 fallback proposal 把失败伪装成成功。

**涉及文件：**

- `src/lib/discussion/dsh-service.ts`
- `src/lib/discussion/orchestrator.ts`
- `src/lib/discussion/oneonone-dsh.ts`
- `src/lib/runtime/turn-process.ts`
- `scripts/dsh-turn.mjs`
- `src/lib/dsh/errors.ts`
- `tests/unit/orchestrator.test.ts`
- `tests/unit/dsh-turn-process.test.ts`（新建）
- `tests/unit/dsh-service.test.ts`（新建）

### 4.1 DSH runner 必须 fail-closed

- [ ] `scripts/dsh-turn.mjs` 删除 provider/model/session 的隐式默认值；缺少必填环境变量时在调用 Harness 前输出结构化失败：`{ ok:false, code:"DSH_MANIFEST_INVALID"|"DSH_ROUTE_UNSUPPORTED", error }`。
- [ ] runner 输出必须带请求 session id；父进程验证 `parsed.sessionId === req.sessionId`。返回其他 session、非字符串 response、损坏 JSON、非零退出码或无法确认 child 已结束，均按 DSH 失败处理。
- [ ] runner 捕获错误时保留稳定 `code`、stage 和安全的短错误信息；不得把 API key、完整 prompt 或宿主环境 dump 到 stdout/stderr。
- [ ] Harness 必须在成功和失败路径都 `close()`；close 失败不能覆盖更早的启动/协议错误，也不能令 `ok` 变为 true。
- [ ] `src/lib/runtime/turn-process.ts` 将 child payload 映射回已有 `DshError` 子类；解析异常映射 `DSH_PROTOCOL_FAILED`，启动/进程退出映射 `DSH_START_FAILED`，manifest/Skill 错误保留相应 code。

### 4.2 1v1 删除 AI SDK fallback

- [ ] 从 `src/lib/discussion/dsh-service.ts` 删除 `generateText`、`runViaAiSdk()` 以及为 fallback 服务的 `getSetting`/`decrypt`/`buildModel`/`llmTimeoutMs` imports。旧 AI SDK 实现只允许留在显式 legacy 路径。
- [ ] `runOneOnOneTurn()` 的唯一生成调用是 DSH runner。捕获 DSH error 后：将 `DiscussionTurn` 标为 `failed` 并保存稳定 `errorCode/errorMessage/completedAt`，将 participant 标为 `failed`，1v1 Discussion 标为 `failed`，publish change，然后返回失败结果或抛出给 SSE adapter。
- [ ] 失败发生在 `DiscussionTurn` 建立前时，也必须更新 participant/Discussion 状态，不能保持 `ready` 让 UI 误以为可成功继续。
- [ ] `finalResponse` 为空、全空白或不是字符串时视为 `DSH_TURN_FAILED`；不得创建 `DiscussionMessage`，不得使用“无回应”作为成功文本。
- [ ] `oneonone-dsh.ts` 只发送 `error` SSE；成功才发送 `delta` + `done`。错误消息使用 DshError 的稳定 message，不暴露 secret。

### 4.3 多人 orchestrator 禁止强制完成

- [ ] Persona 回合 catch 使用 Task 1 的 error classifier：只有 `DSH_TURN_FAILED` 可标记该 Persona failed 并继续同轮；runtime/transport/protocol/manifest/permission/unknown error 立即终止整场讨论并进入外层 failed 分支。
- [ ] Persona 空回复按 failed turn 处理，不更新为 completed，不加入 `roundOutputs` 或 `acceptedMessageIds`。
- [ ] 如果本轮没有任何真实 Persona message，禁止调用 Moderator 生成共识；直接标记 Discussion failed。
- [ ] 删除 Moderator 自动重试和 fallback proposal。Moderator DSH error、空回复、非法 JSON、schema 校验失败都必须保留旧 `discussionState`，设置 `moderatorStatus: "failed"` 和 Discussion `status: "failed"`，不写伪造 summary/evidence/decision，不进入下一轮。
- [ ] 外层 catch 不能把异常后的流程继续到 `status: "done"`；成功标记只允许出现在所有轮次和 Moderator proposal 都真实成功之后。
- [ ] `acceptedMessageIds`、roundOutputs 只能来自真实 `DiscussionMessage`；本 P0 不补 Moderator 正文输入，但绝不再用截断人格输出构造 fallback proposal。

### 4.4 重试边界

- [ ] 保留 Persona 显式 retry API，但 retry 必须继续使用失败 `DiscussionTurn.inputSnapshot`，创建新 attempt；不得在 catch 中自动切换 AI SDK。
- [ ] 本 P0 不新增 Moderator retry UI/API；若未来加入，必须是显式操作并重新校验原始输入快照，不能用当前状态静默重写失败回合。

### 4.5 测试和验收

- [ ] `dsh-turn-process.test.ts` 覆盖：缺 session、缺 model、session mismatch、损坏 stdout、结构化 DSH error、非零 exit、空 response；每项都不得解析为成功。
- [ ] `dsh-service.test.ts` mock DSH runner 抛启动/协议/manifest错误，断言 `src/lib/discussion/dsh-service.ts` 不再导入/调用 `ai.generateText`，没有 DiscussionMessage，turn/participant/discussion 状态均为 failed。
- [ ] `orchestrator.test.ts` 覆盖：`DshTurnError` 只失败当前 Persona；`DshProtocolError` 终止讨论；空 Persona output 不会产生 completed turn；Moderator 非法 JSON 不会产生 fallback proposal 或 `done`。
- [ ] `oneonone-dsh` 测试覆盖 DSH error SSE 只有 `error` 帧，成功 SSE 才有 `delta`/`done`。
- [ ] 完成本任务后运行相关测试并提交：`fix: fail closed on DSH runtime errors`。

---

## Task 5：真实 DSH 冒烟和发布验收

**目的：** 证明测试中的 fake policy 与实际 DSH profile、plugin、child env 一致，避免出现“单元测试通过但实际 roster 仍有 PowerShell/文件编辑”的假完成。

### 5.1 自动验证

- [ ] `pnpm exec vitest run`
- [ ] `pnpm exec tsc --noEmit --incremental false`
- [ ] `pnpm exec eslint src/lib/dsh src/lib/discussion src/lib/runtime runtime/dsh-plugin tests`；允许既有非阻断 warning，但不得有新增 error。
- [ ] `pnpm build`
- [ ] 用带 patch 的同版本 DSH 执行 `--profile sdk --dump-config`，将 active roster 保存到临时文件；确认不存在 P0 禁止工具，且存在 `skill`/Agent loop/system prompt 必需组件。

### 5.2 手工/集成场景

- [ ] 正常 1v1：创建一个 Persona + 已安装 Skill，确认 child 收到唯一 `BT_DSH_SESSION_ID`，Persona system prompt 和完整 snapshot `SKILL.md` 生效，普通 Skill catalog 只显示当前 Discussion allowlist。
- [ ] 隔离：连续运行 Session A、Session B；两者使用同名不同 hash 的 fixture Skill，分别只能返回自己的正文/reference。确认 `data/dsh/plugin-loaded.marker` 和 `plugin-ran.marker` 不再生成。
- [ ] 失败 manifest：删除/篡改 manifest 或改 hash 后运行，期望 SSE `error`、Discussion/participant/turn 为 failed、没有 DiscussionMessage；绝不能出现 AI SDK 生成文本。
- [ ] 失败 runtime：使用不可执行的 DSH bin 或使握手失败，确认没有 fallback、没有 Moderator fallback proposal、多人 Discussion 不会变成 `done`。
- [ ] 工具边界：通过真实 DSH Agent 尝试调用 `tool-pwsh`/`tool-fs`/`tool-subagent`，调用必须被 roster 或 guard 拒绝；`read_skill_reference` 对未授权路径必须报 `DSH_SKILL_NOT_ALLOWED`。
- [ ] 1v1 成功回归：确认 SSE 仍是 `init` → `delta` → `done`，失败是 `init` → `error`；P0 修复不回归此前已修复的前端实时显示。

### 5.3 发布门槛

- [ ] 所有 P0 自动测试、TypeScript、lint/build 和真实 DSH roster 检查通过。
- [ ] `git diff --check` 通过；`git status --short` 只包含计划内文件。
- [ ] 逐个检查 diff：没有 API key、BT internal token、完整 prompt、宿主绝对路径、marker 写入、AI SDK fallback、Moderator fallback proposal。
- [ ] 汇总最终 commit hash、测试命令和真实 dump-config 结果，再交给用户验收。未达到任一门槛时，不得称为“P0 已修复”。

## 提交顺序建议

按以下顺序提交，便于其他 AI 在任一阶段回退或 review：

1. `test: define DSH P0 safety contracts`
2. `fix: enforce DSH read-only tool roster`
3. `fix: bind DSH identity and skill allowlists per session`
4. `fix: fail closed on DSH runtime errors`
5. `test: verify DSH P0 acceptance`

如果某一提交同时包含无关的 provider/baseURL、历史重建、Moderator 正文/CAS、steer、archive/purge 或前端重构，应拆出并标为 P1/P2，不能作为 P0 完成条件。
