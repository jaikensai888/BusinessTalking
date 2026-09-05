# BusinessTalking DSH Runtime 融合实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox - [ ] syntax for tracking.

**Goal:** 将 BusinessTalking 的 1v1 讨论和多人讨论迁移到 DSH Runtime，使 DSH 负责 Agent Loop、Session、Skill 发现与按需加载、工具调用和原始事件；BusinessTalking 继续负责讨论业务、参与者、轮次、结构化状态、消息投影和归档。

**Architecture:** BusinessTalking Server 通过 dsh-sdk-client 长期持有一个 DSH Runtime，使用每个讨论参与者独立的 DSH Session 隔离人格上下文。BusinessTalking 在首次运行前生成不可变的 Persona/Skill snapshot 和 Session manifest，DSH patch 中关闭默认 filesystem Skill provider，挂载 BusinessTalking 的 scoped Skill provider 和只读工具。多人讨论第一期由 BusinessTalking 按轮次串行驱动，所有参与者完成一轮后再由独立的中立 Moderator Session 生成 StateProposal，由 BusinessTalking 校验并原子提交。

**Tech Stack:** Next.js 16、React 19、TypeScript、Prisma 6、SQLite、pnpm、Vitest、@deepseek-ai/dsh-sdk-client 0.1.2-rc.1、@deepseek-ai/dsh 0.1.2-rc.1、DSH Cordis patch/plugin。

**Spec:** [dsh-runtime-migration.md](./dsh-runtime-migration.md)、[1v1-discussion-dsh-skill-loading.md](./1v1-discussion-dsh-skill-loading.md)、[nvn-discussion-dsh.md](./nvn-discussion-dsh.md)、[useskill-dsh.md](./useskill-dsh.md)

## Global Constraints

1. 新的讨论执行路径强制使用 DSH Runtime。DSH 进程启动失败、握手失败、协议错误、Session 错误和不支持的模型路由都必须抛出错误；禁止自动回退到 AI SDK。
2. AI SDK 旧实现可以暂时保留为开发者显式选择的对照路径，但不得被异常处理隐式调用。生产默认和用户新建讨论均使用 DSH。
3. 一个 Worker 长期复用一个 DSH Runtime，Runtime 内有多个相互隔离的 Session；不得为每个 Persona、Discussion 或请求启动独立 DSH 进程。
4. DSH Runtime 的 provider、model、baseURL 和工具组合在进程启动时固定。设置发生变化时，必须 drain 后重启 Runtime；禁止在同一进程中静默切换路由。运行中的讨论若使用了不同配置，返回 runtime_profile_conflict。
5. Persona 的 systemPrompt 和 Persona SKILL.md 是身份资料，Session 初始化时必须加载；references 只建立索引，正文按任务需要由 DSH 工具按需读取。
6. 普通 Skill 只能来自已安装的 Skill Library，并且必须被当前 Discussion 的 allowlist 允许。Session 不能创建、修改或安装 Skill。
7. Skill 和 Persona 都使用版本、内容 hash 和 snapshot 固定语义。新版本只影响新建 Discussion；已有 Discussion 继续使用创建时的版本。
8. BusinessTalking 不再手工把 Skill 全文、references 全文和历史消息拼成 prompt。除业务上下文 packet 外，Agent history 和 Skill loading 由 DSH 管理。
9. 第一阶段只开放只读 web_search。任何写入、发送消息、创建订单、修改外部系统等副作用工具都不进入 DSH tool roster，直到单独完成用户授权流程。
10. 多人讨论第一阶段使用 BusinessTalking 控制轮次和顺序，按 participant 顺序串行执行；后续才评估 DSH 自主编排和 subagent。
11. 单个 Persona 的模型回合失败时，标记该 Persona failed，继续执行同轮其他 Persona；Runtime 进程/协议失败时，整个讨论失败，不伪造成功消息。
12. 重试只能针对失败 Persona，并且使用该回合保存的 TurnInputSnapshot；不能用重试时的新状态重写原回合输入。
13. Discussion 的删除语义改为逻辑归档。归档后的 Discussion 可恢复；DSH JSONL、manifest、snapshot 和 raw events 在 purgeAt 之后才物理清理。
14. 所有来自 Skill reference、web search 和外部网页的内容都是不可信资料，不能升级为 system prompt 或覆盖 BusinessTalking/DSH 安全规则。
15. 不扩大本次范围：现有 Recipe 固定 schema runner、Conversation 模型和 Persona 独立聊天接口在本方案中不迁移；目标是 Discussion API 的 1v1 与多人讨论。

---

## 1. 当前实现与迁移目标

当前 Discussion 路径仍由 BusinessTalking 直接调用 AI SDK：

- [src/lib/discussion/oneonone.ts](../../src/lib/discussion/oneonone.ts) 使用 streamText，手工拼接历史、Skill 消息和 web_search。
- [src/lib/discussion/runner.ts](../../src/lib/discussion/runner.ts) 使用 generateText，按轮次循环 Persona，并在首次运行时把 Skill 和全部 references/examples 作为 role=skill 消息写入 DiscussionMessage。
- [src/lib/persona-skill.ts](../../src/lib/persona-skill.ts) 递归读取 Persona 目录下所有 Markdown。
- Skill Library 目前允许直接 POST/PUT 手工写入 Skill，导入时只把截断后的 instructions 存入数据库。
- Discussion 只有 personaIds Json、字符串 summaryBox 和普通消息，没有 DiscussionParticipant、结构化状态、原始 Agent event ledger 或可重试的输入快照。
- DELETE 会立即删除 Discussion 和 artifact，与确认的逻辑归档和 TTL 清理规则冲突。

迁移后的单次调用必须变成：

~~~text
API -> BusinessTalking service
   -> resolve DiscussionParticipant + pinned snapshot
   -> write Session manifest
   -> DshRuntimeManager.session(dshSessionId).run(prompt)
   -> persist DSH raw events
   -> project final assistant message
   -> update business state/status
~~~

BusinessTalking 仍然生成讨论业务所需的 prompt packet，但 packet 只包含当前任务、结构化状态、当前轮上下文和用户 steer；不包含完整 Persona Skill、全部 refs 和手工历史。

## 2. 目标架构

~~~mermaid
flowchart LR
    UI[Discussion UI] --> API[Next.js Discussion API]
    API --> BT[BusinessTalking Discussion Service]
    BT --> DB[(Prisma SQLite)]
    BT --> MAN[Manifest and Snapshot Store]
    BT --> RM[DshRuntimeManager]
    RM --> SDK[DeepSeekHarness SDK]
    SDK --> PROC[One DSH Runtime Process]
    PROC --> PLUGIN[BusinessTalking DSH Plugin]
    PLUGIN --> SP[Scoped SkillProvider]
    SP --> LIB[Installed Skill Library]
    PLUGIN --> REF[Read Skill Reference]
    PLUGIN --> SEARCH[Read-only web_search]
    SEARCH --> INTERNAL[Internal BT Search Endpoint]
    PROC --> EVENTS[DSH Session Events]
    EVENTS --> BT
    BT --> STATE[DiscussionState and StateProposal]
    STATE --> DB
~~~

### 2.1 职责边界

| 能力 | BusinessTalking | DSH Runtime |
|---|---|---|
| 讨论、参与者、轮次顺序 | 负责 | 不负责 |
| DiscussionState、StateProposal 校验和原子提交 | 负责 | 只生成 proposal |
| Persona 选择和版本 pin | 负责 | 不决定版本 |
| Agent Loop、模型上下文、Session history | 不负责 | 负责 |
| Skill catalog、Skill body loading | 提供受限数据源 | 发现、选择、加载 |
| references 正文读取 | 提供 snapshot 和权限边界 | 按需读取和注入 |
| web_search 执行 | 提供内部服务实现 | 以 DSH tool 形式调用 |
| DSH 原始 event | 持久化和去重 | 产生 |
| 用户可见 DiscussionMessage | 产生投影 | 不直接写业务表 |
| 失败分类、HTTP 映射、重试入口 | 负责 | 报告原始错误 |
| Skill 安装和版本发布 | 负责 | 只消费已安装版本 |

### 2.2 Session 隔离

每个 DiscussionParticipant 拥有一个稳定的 dshSessionId。相同 Persona 被多个 Discussion 使用时，只复用 Skill 文件和版本，不复用 Session。

~~~mermaid
flowchart TB
    R[One DSH Runtime] --> S1[Discussion A / Persona P / Session A-P]
    R --> S2[Discussion B / Persona P / Session B-P]
    R --> S3[Discussion A / Persona Q / Session A-Q]
    S1 -. no history sharing .- S2
    S1 -. no prompt sharing .- S3
~~~

Session ID 必须在 participant 创建时生成并持久化，格式使用稳定、不可猜测且不含用户原始内容的 ID，例如 bt-discussion-{discussionId}-{participantId}。DSH Runtime 重启不改变该 ID；DSH 自己的持久化日志负责恢复。

## 3. 数据模型和持久化契约

修改 [prisma/schema.prisma](../../prisma/schema.prisma)。保留现有字段以兼容旧数据，但新 DSH 路径只使用下面的结构。

### 3.1 SkillRevision

Skill 保留为逻辑名称和 Recipe 兼容记录；不可变内容放进 SkillRevision。

~~~text
SkillRevision
  id
  skillId
  name                 // kebab-case，作为 DSH skill name
  version              // semver 或 0.0.0+<hash12>
  contentHash          // 完整 SKILL.md 的 sha256
  description
  instructions         // 完整正文，不再截断到 2000 字符
  packageRoot          // data/skill-library/<name>/<version>
  source               // builtin | npx
  sourceRef
  manifest             // frontmatter、资源索引和安装元数据
  installedAt
  Skill
  DiscussionSkill[]
  unique(name, version)
  unique(name, contentHash)
~~~

规则：

- 安装包有合法 semver 时使用包或 SKILL.md 的 version。
- 没有 version 时使用 0.0.0+ 加 contentHash 前 12 位，保证每个内容版本可追踪且不可覆盖。
- 已存在相同 name/version 但 hash 不同，安装失败；不能覆盖旧版本。
- 现有手工 Skill 没有 packageRoot 时标记 legacy，只能继续被旧 Recipe 使用，不能被 DSH provider 暴露。

### 3.2 DiscussionParticipant 与 DiscussionSkill

~~~text
DiscussionParticipant
  id
  discussionId
  personaId
  dshSessionId       // unique
  personaSkillVersion
  personaSkillHash
  personaSnapshotRoot
  status             // pending | running | completed | failed | archived
  lastEventSeq       // 默认 0
  lastError
  createdAt
  updatedAt
  unique(discussionId, personaId)

DiscussionSkill
  id
  discussionId
  skillRevisionId
  createdAt
  unique(discussionId, skillRevisionId)
~~~

新 Discussion 创建时将请求中的 SkillRevision IDs 校验为已安装、未卸载、当前可用后写入 DiscussionSkill。Persona Skill 不走普通 allowlist，但必须在 Persona snapshot 中固定。

### 3.3 Discussion、DiscussionMessage、AgentEvent、DiscussionTurn

在 Discussion 增加：

~~~text
runtimeMode             // dsh | legacy-ai-sdk，默认 dsh；生产只允许 dsh
runtimeProfile          // JSON：provider、model、baseUrl、profileHash
discussionState         // JSON：DiscussionState
stateVersion            // 默认 0，乐观锁
moderatorSessionId
moderatorStatus
moderatorLastEventSeq
archivedAt
purgeAt
~~~

在 DiscussionMessage 增加：

~~~text
participantId?
sessionId?
attempt               // 默认 1
sourceEventId?
~~~

新增 AgentEvent：

~~~text
AgentEvent
  id
  discussionId
  participantId?       // Moderator event 为空
  sessionId
  seq
  eventType
  payload              // 清理凭据、header 和不需要的敏感字段后保存
  createdAt
  unique(sessionId, seq)
  index(discussionId, createdAt)
~~~

新增 DiscussionTurn：

~~~text
DiscussionTurn
  id
  discussionId
  participantId?       // Persona turn 有值，Moderator turn 为空
  sessionId
  kind                 // persona | moderator
  round
  attempt
  inputSnapshot        // 完整 prompt packet、stateVersion、引用消息 ID
  status               // running | completed | failed
  outputMessageId?
  errorCode?
  errorMessage?
  createdAt
  completedAt?
  index(discussionId, round)
~~~

### 3.4 DiscussionState

在 [src/lib/discussion/state.ts](../../src/lib/discussion/state.ts) 定义 Zod schema 和 TypeScript 类型，禁止使用任意字符串替代结构化字段。

~~~text
DiscussionState
  schemaVersion: 1
  brief: string
  round: number
  summary: string
  evidence: [
    {
      id: string
      claim: string
      sourceMessageIds: string[]
      sourceEventIds: string[]
    }
  ]
  decisions: string[]
  openQuestions: string[]
  userSteers: [
    {
      id: string
      content: string
      targetParticipantIds: string[]
      createdAt: string
    }
  ]
  participantStatuses: [
    {
      participantId: string
      status: string
      lastOutputMessageId?: string
    }
  ]
~~~

Moderator 只能返回以下 StateProposal：

~~~text
StateProposal
  schemaVersion: 1
  basedOnStateVersion: number
  round: number
  summary: string
  evidence: Evidence[]
  decisions: string[]
  openQuestions: string[]
  acceptedMessageIds: string[]
~~~

BusinessTalking 使用 Zod 严格校验 proposal，检查 basedOnStateVersion、round、acceptedMessageIds 都属于当前讨论。校验失败不提交 state，Moderator turn 标记 failed，并把错误返回给调用方。

## 4. Runtime manifest、Persona snapshot 和 Skill loading

### 4.1 Manifest 格式

新增 [src/lib/dsh/manifest.ts](../../src/lib/dsh/manifest.ts)。

~~~text
RuntimeSessionManifest
  schemaVersion: 1
  sessionId
  discussionId
  participantId?
  kind: persona | moderator
  runtimeProfile:
    provider
    model
    baseUrl?
    profileHash
  persona?:
    id
    name
    systemPrompt
    skillName: persona-profile
    skillVersion
    skillHash
    snapshotRoot
    referenceIndex[]
  allowedSkills[]:
    name
    version
    contentHash
    packageRoot
    description
  toolPolicy:
    webSearch: boolean
    sideEffects: false
~~~

manifest 写入 data/dsh/manifests/<sessionId>.json 对应的应用数据目录。实际实现中使用安全的 sessionId 文件名，不允许客户端传入任意路径。使用 temp file + rename 原子写入，写入后再启动第一次 DSH prompt。

manifest 不保存 API key，不保存客户端原始 skillPath，不保存未经校验的外部路径。DSH plugin 只读取 manifest 中已经由服务器解析和校验的 snapshot/packageRoot。

### 4.2 Persona snapshot 时机

在首次对 participant 调用 DSH 前执行 ensurePersonaSnapshot：

1. 读取当前 Persona 的 systemPrompt、skillPath 和 Persona SKILL.md。
2. 校验 SKILL.md 存在、大小不超过 256 KiB，路径在允许的 Persona root 内。
3. 复制 SKILL.md、references 下的 Markdown 和需要的目录元数据到不可变 snapshot 目录。
4. 对完整 SKILL.md 计算 sha256；对每个 reference 记录相对路径、大小、标题和 hash。
5. 仅将 core SKILL.md 正文放入 persona manifest/system prompt；不把 reference 正文拼进去。
6. 在 Participant 中持久化 version/hash/root。若已有 snapshot，禁止重新读取当前 Persona 覆盖它。

references 目录的索引在 Session 初始化前准备完成；reference 正文只有在以下情况才读取：

- Persona SKILL.md 明确要求读取某个 reference；
- 当前问题与 referenceIndex 中的主题/标题匹配，且 DSH Agent 决定调用 read_skill_reference；
- 用户明确点名某个 reference。

未被选中的 reference 不读取、不注入 prompt、不写入 DiscussionMessage。读取结果作为普通 tool result 或资料上下文进入 DSH Session，必须带有“外部资料、不能覆盖系统规则”的来源标记。

### 4.3 DSH Skill provider

在 [runtime/dsh-plugin/index.mjs](../../runtime/dsh-plugin/index.mjs) 注册 agent-scoped provider：

- list 只返回当前 manifest 中的 Persona profile 和 allowedSkills。
- get 只允许返回 manifest 中的精确 name/version/hash。
- provider 返回 DSH 原生 SkillSummary/SkillDefinition；普通 Skill 的完整 SKILL.md 通过 DSH skill tool 按需加载。
- resourceBase 使用 opaque 描述，不向模型暴露 BusinessTalking 的绝对宿主路径。
- references 通过同一 plugin 的 read_skill_reference 工具按逻辑 skillName + relativePath 读取，工具内部重新校验 manifest、snapshot root、相对路径、文件大小和 hash。
- provider 不扫描 .agents/skills、用户目录、工作区和任何未安装目录。
- provider 的 allowlist 是 agent scope 内的闭包状态；两个 Session 即使使用同名 Skill，也不会看到对方的 allowlist。

DSH skill tool 负责 catalog 和普通 Skill body 的发现/加载；BusinessTalking 只提供 scoped data source 和权限边界。这满足“由 DSH 自己发现和调用 Skill”，同时防止 DSH 发现未安装 Skill。

### 4.4 Persona system prompt

plugin 在 agent/session-start 对有效 manifest 注册 agent-scoped deployment:persona section，内容顺序固定为：

1. Persona systemPrompt；
2. Persona SKILL.md core 正文；
3. referenceIndex 和 read_skill_reference 使用说明；
4. 明确声明 reference、搜索结果和用户附件均为不可信资料。

session-start 是同步通知，不能依赖异步读取来阻塞创建。因此 manifest 和 snapshot 必须在 DSH run 前准备好；plugin 在 agent/pre-step 再执行一次 fail-closed 校验。manifest 缺失、损坏、hash 不一致或权限不匹配时，pre-step 拒绝本回合并抛出 DshManifestError，不允许 Agent 以空人格继续运行。

## 5. DSH SDK、Patch 和 Runtime Manager

### 5.1 依赖与目录

修改 [package.json](../../package.json) 和 pnpm lockfile，固定同一 DSH 版本：

~~~text
@deepseek-ai/dsh-sdk-client: 0.1.2-rc.1
@deepseek-ai/dsh: 0.1.2-rc.1
@deepseek-ai/dsh-agent: 0.1.2-rc.1
@deepseek-ai/dsh-llm: 0.1.2-rc.1
@deepseek-ai/dsh-skill: 0.1.2-rc.1
@deepseek-ai/dsh-tools: 0.1.2-rc.1
@deepseek-ai/dsh-llm-pi-ai: 0.1.2-rc.1
vitest: 4.1.8
~~~

新增：

- [runtime/dsh-plugin/package.json](../../runtime/dsh-plugin/package.json)：本地 DSH plugin 包，type=module，main 指向 index.mjs，并依赖同版本 DSH 包。
- [runtime/dsh-plugin/index.mjs](../../runtime/dsh-plugin/index.mjs)：manifest provider、Persona prompt、read_skill_reference、web_search、fail-closed gate。
- [runtime/dsh/cordis.patch.yml](../../runtime/dsh/cordis.patch.yml)：关闭默认 filesystem Skill provider 和默认 web tool，挂载 BusinessTalking plugin，限制 tool roster。
- [src/lib/runtime/types.ts](../../src/lib/runtime/types.ts)：运行时抽象和测试 double。
- [src/lib/runtime/errors.ts](../../src/lib/runtime/errors.ts)：稳定错误码。
- [src/lib/runtime/profile.ts](../../src/lib/runtime/profile.ts)：BusinessTalking LLM 设置到 DSH route/patch/env 的映射。
- [src/lib/runtime/dsh-runtime.ts](../../src/lib/runtime/dsh-runtime.ts)：DeepSeekHarness 封装。
- [src/lib/runtime/manager.ts](../../src/lib/runtime/manager.ts)：Worker 级 Runtime 生命周期、Session 锁和关闭。

### 5.2 Provider route 映射

当前 BusinessTalking 的 provider 只有 openai 和 anthropic：

| BusinessTalking | DSH route | patch 配置 | child env |
|---|---|---|---|
| openai | openai | api=openai-completions，baseURL 使用 llm.baseUrl，models 只声明当前 defaultModel | BT_DSH_LLM_API_KEY |
| anthropic | anthropic | api=anthropic-messages，保留配置的 baseURL，models 只声明当前 defaultModel | BT_DSH_LLM_API_KEY |

profile builder 必须：

1. 从 getSetting 读取 llm.provider、llm.baseUrl、llm.defaultModel、llm.timeoutSeconds。
2. 用现有 encryption 解密 apiKey，只把解密后的值放到 DSH child 的环境变量，不写 manifest、DB、patch 或普通日志。
3. 生成不含 secret 的 runtime patch，覆盖 llm-pi-ai 配置，并关闭 llm-deepseek 的未使用 route，避免 DSH 默认 provider 抢占。
4. 生成 profileHash，至少包含 provider、model、baseURL、patch 内容和 tool roster。
5. provider/model/baseURL 缺失或不被当前 DSH 版本支持时，在第一次 prompt 前抛出 DshRouteUnsupportedError。
6. 不使用 DeepSeekHarness 的默认 deepseek-official 路由承接当前 openai 兼容配置；必须通过 llm-pi-ai 的 openai route 保留现有 OpenAI/DeepSeek-compatible baseURL 语义。

DSH patch 变更必须通过 dsh --profile sdk --dump-config 验证。patch entry 使用 DSH 当前版本的 id 替换语义，必须明确确认以下 entry 最终状态：

- skill-filesystem：disabled；
- tool-web、web-search-deepseek、web-fetch-http：disabled；
- llm-pi-ai：只包含被选中的 openai 或 anthropic route；
- BusinessTalking plugin：active；
- bash、write、edit、外部副作用工具：disabled；
- skill 和 read_skill_reference、web_search：active。

### 5.3 Runtime Manager 规则

Runtime Manager 对外暴露以下最小接口：

~~~text
ensureStarted(profile): Promise<void>
run(sessionId, prompt, onNotification): Promise<RunResult>
assertHealthy(): void
close(): Promise<void>
~~~

实现规则：

- 第一次 run 时惰性创建 DeepSeekHarness；options 使用 profile=sdk、cwd=BusinessTalking 项目目录、processCwd=同一绝对目录、patches=[cordis.patch.yml, runtime patch]、provider 和 model。
- 一个 manager 生命周期内只允许一个 profileHash。新 profileHash 与当前活动 Runtime 不同，且有活动 Session 时抛出 runtime_profile_conflict。
- 没有活动 run 时可以关闭旧 Runtime 并启动新配置；生产部署的设置保存流程应显式触发 drain/restart。
- per-session 使用 mutex；同一 Session 有并发请求时返回 DshSessionBusyError，不隐式排队两个用户回合。
- SDK 没有 per-session close。归档/Participant 删除只删除 BusinessTalking 逻辑关系和过期 snapshot，不调用 Runtime close；整个 Runtime 只在 Worker shutdown 或 manager drain 时 close。
- run 的 onNotification 只持久化当前 Session tree，按 sessionId 和 seq 去重。subagent 事件第一阶段记录但不启用 subagent roster。
- 检查 RunResult 的 turn/end reason。如果 DSH 返回模型回合 error，抛出 DshTurnError；如果 transport、initialize、JSON-RPC 或事件校验失败，抛出 DshRuntimeError。
- 不捕获错误后调用 legacy AI SDK。唯一允许的 legacy 路径是调用方在开发配置中明确指定 runtimeMode=legacy-ai-sdk。

### 5.4 事件投影

在 [src/lib/dsh/events.ts](../../src/lib/dsh/events.ts) 实现：

1. 将 DSH notification 的 session.event 转成 AgentEvent；
2. 去除凭据、请求 header、绝对路径和不必要的 prompt secret；
3. 使用 upsert(sessionId, seq) 保证重复回调不产生重复记录；
4. 识别 assistant/message 的最终文本，交给 Discussion service 写 DiscussionMessage；
5. 记录 tool call、tool result、turn/end、status 供调试和重放；
6. AgentEvent 与 DiscussionMessage 分离，前者不直接对用户展示。

1v1 SSE 可以沿用当前 delta/done/error 事件名以减少 UI 改动，但 DSH SDK 第一阶段按完整 assistant/message 事件发送一条最终 delta，不承诺 token 级别流式。不能把事件间的状态文字当作模型正文。

## 6. 只读工具设计

### 6.1 read_skill_reference

由 [runtime/dsh-plugin/index.mjs](../../runtime/dsh-plugin/index.mjs) 注册。输入：

~~~text
{
  skillName: string,
  relativePath: string
}
~~~

执行时：

1. 从当前 agent 的 manifest 查找 skillName；
2. 仅允许 manifest referenceIndex 中存在的相对路径；
3. 使用 path.relative/realpath 检查不能逃逸 snapshot/packageRoot；
4. 只读 Markdown，单文件不超过 512 KiB，总 snapshot 不超过 8 MiB；
5. 读取后校验 hash；
6. 返回 source=skill-reference 的资料结果，并加不可信内容边界；
7. 不把正文写入 system prompt。

### 6.2 web_search

保留 [src/lib/search/web.ts](../../src/lib/search/web.ts) 作为搜索实现，但不再直接作为 AI SDK tool。新增内部服务：

- [src/app/api/internal/dsh/web-search/route.ts](../../src/app/api/internal/dsh/web-search/route.ts)
- 只接受本机 DSH plugin 请求；
- 使用随机 BT_INTERNAL_TOKEN，token 只存在父进程和 child env；
- 输入限制 query 长度和 maxResults；
- 调用 searchWeb 并返回结构化结果；
- 不暴露给浏览器和普通 API 客户端；
- 失败返回工具错误，不返回伪造的搜索成功。

DSH plugin 的 web_search 只调用该内部 endpoint，设置 toolPolicy.webSearch=true 时才注册。第一阶段不注册 write、edit、bash、MCP、外部消息发送等工具。

## 7. 1v1 Discussion 迁移

### 7.1 新建与首次运行

修改 [src/app/api/v1/discussions/route.ts](../../src/app/api/v1/discussions/route.ts)：

1. 校验 personaIds 非空、去重并确认 Persona 存在。
2. 校验 skillRevisionIds 全部属于可用 Skill Library。
3. 一个事务创建 Discussion、DiscussionParticipant、DiscussionSkill 和初始 DiscussionState。
4. 为每个 participant 生成稳定 dshSessionId；不在创建接口直接启动 DSH 进程。
5. 单 Persona 只启动 1v1 service；多 Persona 进入多人 orchestrator。

修改 [src/app/api/v1/discussions/[id]/steer/route.ts](../../src/app/api/v1/discussions/[id]/steer/route.ts)：

- 1v1：先写 user DiscussionMessage 和 userSteer state，再调用对应 Session；
- 需要 ensurePersonaSnapshot 和 writeManifest；
- prompt 只发送当前用户问题、DiscussionState 投影和必要的最近业务 packet；
- 不查询并手工拼接 DSH history；
- DSH 成功后写 assistant message、AgentEvent 和 Participant status；
- DSH 失败返回稳定错误，不创建失败文本作为 assistant 正文。

修改 [src/app/api/v1/discussions/[id]/followup/route.ts](../../src/app/api/v1/discussions/[id]/followup/route.ts)：

- 使用 participantId 找到稳定 Session；
- 将 followup 作为普通下一回合 prompt；
- 禁止直接使用 summaryBox、skill message 或独立 AI SDK model；
- 若 Session 正在运行返回 409；
- 保持最终消息和 raw event 的分离。

修改 [src/app/api/v1/discussions/[id]/stream/route.ts](../../src/app/api/v1/discussions/[id]/stream/route.ts) 和 [src/lib/discussion/broadcast.ts](../../src/lib/discussion/broadcast.ts)：

- 广播 Discussion change、participant status、new message、runtime error；
- SSE 断开不取消 DSH Session，客户端重连后按 Discussion API 读取持久化状态；
- 广播只做实时提醒，不能作为唯一数据源。

### 7.2 要删除的旧逻辑

在 1v1 DSH 路径中移除：

- ensureSkillLoaded 写入 role=skill 消息；
- findSkillMessage、toSkillMessage；
- loadSkill 对 references/examples 的 eager concat；
- oneonone.ts 中 history.slice、system prompt 拼接和 AI SDK streamText；
- 1v1 对 web_search 的 AI SDK tool 定义。

可以保留这些函数的 legacy 副本，但必须放在显式 legacy adapter 中，默认不会被导入或调用。

## 8. 多人 Discussion 迁移

### 8.1 Orchestrator

修改 [src/lib/discussion/runner.ts](../../src/lib/discussion/runner.ts)，将现有 AI SDK loop 改为 [src/lib/discussion/orchestrator.ts](../../src/lib/discussion/orchestrator.ts)：

~~~text
runDiscussion(discussionId)
  load discussion + participants + allowlist
  assert runtime profile
  for round = currentRound .. rounds
    for participant in stable participant order
      create TurnInputSnapshot
      ensure participant Persona snapshot
      write participant manifest
      run participant DSH Session
      persist AgentEvent
      on turn success: persist Persona DiscussionMessage
      on turn failure: mark participant failed and continue
    create Moderator TurnInputSnapshot
    run Moderator DSH Session
    validate StateProposal
    transactionally commit DiscussionState + summary projection
  set completed
~~~

参与者 prompt packet 固定包含：

- brief；
- 当前 round；
- 上一版本 DiscussionState；
- 当前轮已经完成的参与者输出摘要/正文；
- 当前轮用户 steer；
- 当前参与者身份引用；
- 输出格式要求。

其他 Persona 的输出作为当前轮业务 packet 传给当前 Persona，不写进其 DSH Session 的历史。该 packet 必须记录 source message IDs，避免无法追溯。

### 8.2 Persona 失败和 Runtime 失败

分类规则：

| 错误 | 参与者 | Discussion |
|---|---|---|
| DshTurnError、模型拒答、模型单回合失败 | failed | 继续同轮 |
| Skill manifest/hash/allowlist 错误 | failed | 继续同轮，但记录错误 |
| DSH Runtime 进程退出 | 不能继续 | failed |
| JSON-RPC/协议解析错误 | 不能继续 | failed |
| Moderator 输出 JSON 校验失败 | 保留参与者输出 | paused/failed，等待显式 retry |
| stateVersion 冲突 | 不覆盖新状态 | failed，并报告冲突 |

失败参与者不写 assistant 伪消息。用户可调用新增：

[src/app/api/v1/discussions/[id]/participants/[participantId]/retry/route.ts](../../src/app/api/v1/discussions/[id]/participants/[participantId]/retry/route.ts)

该 route 只允许 status=failed 的 participant，读取指定失败回合的 DiscussionTurn.inputSnapshot，使用同一 dshSessionId 发送相同 prompt。成功后用新 attempt 写入真实结果，不能以当前 DiscussionState 重新生成原输入。

### 8.3 Moderator

Moderator 使用独立 dshSessionId，不绑定任何 Persona。其 manifest：

- kind=moderator；
- system prompt 是固定的中立状态整理规则；
- allowedSkills 为空，tool roster 只有需要的只读工具；
- 不加载任何参与者 Persona SKILL；
- prompt 中接收结构化 current state 和本轮结果。

Moderator 必须输出单个 JSON 对象，不得输出 Markdown。先用 parseStateProposal 做严格 Zod 校验，再以以下条件执行事务：

~~~text
transaction:
  read Discussion.stateVersion
  assert it equals proposal.basedOnStateVersion
  assert discussion is running
  write discussionState = proposal
  write stateVersion = old + 1
  update summaryBox as a display projection
  persist moderator DiscussionTurn and AgentEvent references
~~~

无法校验的 proposal 不得使用字符串截断或正则修复后提交。

### 8.4 用户 steer

多人 steer 仍由 BusinessTalking 接收和持久化，但不直接打断正在执行的 participant turn。它进入 DiscussionState.userSteers，并在下一次尚未开始的 TurnInputSnapshot 中按 targetParticipantIds 发送。

如果多人 Discussion 正在运行：

- steer 可以进入队列；
- 已经完成的 participant 不重跑；
- 尚未开始的 participant 使用包含 steer 的新 snapshot；
- 当前 round 全部结束后 Moderator 看到该 steer；
- 如果用户要求立即中止，返回 DSH 当前版本支持范围内的明确错误；第一阶段不实现 mid-turn cancel。

## 9. Skill Library 改造

修改：

- [src/app/api/v1/skills/route.ts](../../src/app/api/v1/skills/route.ts)
- [src/app/api/v1/skills/[id]/route.ts](../../src/app/api/v1/skills/[id]/route.ts)
- [src/app/api/v1/skills/import/[jobId]/confirm/route.ts](../../src/app/api/v1/skills/import/[jobId]/confirm/route.ts)
- [src/lib/import/parser.ts](../../src/lib/import/parser.ts)
- [src/lib/import/runner.ts](../../src/lib/import/runner.ts)
- [src/components/skills/skill-form.tsx](../../src/components/skills/skill-form.tsx)
- [src/components/skills/import-dialog.tsx](../../src/components/skills/import-dialog.tsx)
- 新增 [src/lib/skills/installation.ts](../../src/lib/skills/installation.ts)

### 9.1 安装流程

导入确认必须保存完整 Skill bundle：

~~~text
data/skill-library/
  <kebab-name>/
    <version>/
      SKILL.md
      references/
      examples/
      manifest.json
~~~

流程：

1. npx runner 只负责下载/解包到 job 临时目录；
2. parser 读取完整 frontmatter、完整 SKILL.md、references/examples 文件清单；
3. confirm 重新校验路径、symlink、文件大小、name、version 和 hash；
4. installation service 将文件复制到不可变版本目录；
5. Prisma 写入 Skill/SkillRevision；
6. 全部写入成功后才将 revision 标记 installed；
7. 任何一步失败都不创建可见的半安装版本。

### 9.2 禁止会话创建 Skill

- POST /skills 不再创建任意 manual Skill，返回 409 skill_install_required；
- PUT /skills/:id 不允许修改已安装 revision；只能修改展示元数据且不影响执行内容，或直接返回 409 immutable_skill_revision；
- DELETE 只允许卸载未被 active Discussion、Recipe 或 snapshot 引用的 revision；卸载不删除历史 revision 文件；
- SkillForm 改为只读/移除“新建和编辑正文”入口；
- import-dialog 显示版本、contentHash、来源和资源数量；
- Discussion 创建页只列出已安装 revision，并把选择的 revision IDs 提交到后端。

### 9.3 兼容旧数据

执行一次 backfill：

- 每个现有 builtin 且有完整 instructions 的 Skill 创建一个 SkillRevision；
- 计算 contentHash；
- 没有 packageRoot 的 manual Skill 标记 legacy；
- 旧 Discussion 不自动改写历史消息；
- 新 DSH Discussion 不允许引用 legacy manual Skill。

## 10. API、错误和归档

### 10.1 API 返回契约

修改 [src/app/api/v1/discussions/[id]/route.ts](../../src/app/api/v1/discussions/[id]/route.ts)、[src/app/api/v1/discussions/[id]/summary/route.ts](../../src/app/api/v1/discussions/[id]/summary/route.ts) 和 [src/app/api/v1/discussions/by-short/[shortId]/route.ts](../../src/app/api/v1/discussions/by-short/[shortId]/route.ts)：

- GET 返回 participants、pinned Persona/Skill version/hash、runtime status、DiscussionState、stateVersion、archive fields；
- 用户消息和 Persona/Moderator 可见消息正常返回；
- AgentEvent 默认不随普通消息返回，通过 debug/admin 查询或 server log 读取；
- summary endpoint 返回结构化 state 的 display projection，不再把 summaryBox 当唯一事实来源。

定义稳定错误码：

~~~text
DSH_NOT_INSTALLED
DSH_START_FAILED
DSH_INITIALIZE_FAILED
DSH_PROTOCOL_FAILED
DSH_ROUTE_UNSUPPORTED
DSH_CREDENTIAL_INVALID
DSH_MANIFEST_INVALID
DSH_SKILL_NOT_ALLOWED
DSH_SESSION_BUSY
DSH_TURN_FAILED
DISCUSSION_STATE_CONFLICT
DISCUSSION_ARCHIVED
SKILL_INSTALL_REQUIRED
IMMUTABLE_SKILL_REVISION
~~~

HTTP 映射：

- 409：Session busy、runtime profile conflict、state conflict、archived、immutable/allowlist conflict；
- 422：请求和 Skill/Persona manifest 校验失败；
- 502：模型回合失败或 web_search 上游失败；
- 503：DSH Runtime 启动、握手、进程或协议失败；
- 500：数据库事务、事件去重或状态提交失败。

错误消息可以展示 provider/model 和修复建议，但绝不能包含 apiKey、完整请求 header 或内部凭据路径。

### 10.2 归档和清理

修改 DELETE /api/v1/discussions/:id：

1. 将 status 改为 archived；
2. 写 archivedAt；
3. 根据配置计算 purgeAt；
4. 不 cascade delete messages、participants、AgentEvent、DSH session files 或 snapshots；
5. 归档 Discussion 不再接受新的 turn，但可以由 restore route 恢复；
6. 新增 cleanup service，在启动时和固定间隔查找 purgeAt <= now；
7. cleanup 先停止仍在运行的相关工作，再删除 DSH session JSONL、manifest、snapshot、events and artifacts，最后物理删除 DB 记录；
8. cleanup 每一步可重试，不能删除未到 purgeAt 的数据。

## 11. 旧代码迁移边界

### 11.1 需要替换

- [src/lib/discussion/runner.ts](../../src/lib/discussion/runner.ts)：AI SDK loop 替换为 orchestrator；
- [src/lib/discussion/oneonone.ts](../../src/lib/discussion/oneonone.ts)：AI SDK stream 替换为 DSH adapter；
- [src/lib/persona-skill.ts](../../src/lib/persona-skill.ts)：保留安全读取和 snapshot 功能，删除 eager references 拼接；
- [src/lib/llm/providers.ts](../../src/lib/llm/providers.ts)：只保留设置展示或 legacy adapter，不被 DSH Discussion 路径调用；
- [src/app/api/v1/discussions/route.ts](../../src/app/api/v1/discussions/route.ts) 及其子路由：统一调用 Discussion service。

### 11.2 可以保留但必须显式隔离

- [src/app/api/v1/personas/[id]/chat/route.ts](../../src/app/api/v1/personas/[id]/chat/route.ts) 当前独立 Persona chat；
- AI SDK 依赖和 legacy adapter，用于开发者显式对照；
- Recipe 相关 Skill 字段和固定 schema runner；
- 旧 Discussion 的 role=skill 历史数据，只读兼容，不再产生新记录。

目标 Discussion 文件中不得同时出现 generateText/streamText 和 DSH run。运行时选择必须在入口处完成，不能在 catch 分支中切换。

## 12. 测试、验证和完成标准

当前项目没有测试脚本，因此先修改 [package.json](../../package.json) 增加：

~~~text
test: vitest run
test:watch: vitest
~~~

新增测试：

- [tests/unit/dsh-profile.test.ts](../../tests/unit/dsh-profile.test.ts)：provider/baseURL/model/credential env 映射，profileHash 稳定，secret 不进入 patch。
- [tests/unit/dsh-manifest.test.ts](../../tests/unit/dsh-manifest.test.ts)：manifest schema、原子写入、路径逃逸、hash mismatch、版本 pin。
- [tests/unit/skill-installation.test.ts](../../tests/unit/skill-installation.test.ts)：完整 bundle、无 version hash 版本、重复 version 冲突、symlink 和大小限制。
- [tests/unit/discussion-state.test.ts](../../tests/unit/discussion-state.test.ts)：StateProposal 严格解析、source IDs、stateVersion 乐观锁。
- [tests/unit/dsh-errors.test.ts](../../tests/unit/dsh-errors.test.ts)：Runtime/turn/manifest/route 错误到 HTTP 状态的映射。
- [tests/integration/dsh-plugin.test.ts](../../tests/integration/dsh-plugin.test.ts)：同一 Runtime 中两个 Session 的 provider allowlist、Persona、reference 隔离。
- [tests/integration/dsh-runtime.test.ts](../../tests/integration/dsh-runtime.test.ts)：DeepSeekHarness fake client、通知收集、session mutex、close、无 fallback。
- [tests/integration/discussion-1v1.test.ts](../../tests/integration/discussion-1v1.test.ts)：首次 snapshot、resume、reference lazy loading、用户 steer、DSH failure。
- [tests/integration/discussion-nvn.test.ts](../../tests/integration/discussion-nvn.test.ts)：串行轮次、每个 Persona 独立 Session、单 Persona failure continue、Moderator 原子 state commit、failed retry snapshot。
- [tests/integration/archive-purge.test.ts](../../tests/integration/archive-purge.test.ts)：DELETE 只归档，TTL 前可恢复，TTL 后才物理清理。
- [tests/e2e/dsh-config-smoke.test.ts](../../tests/e2e/dsh-config-smoke.test.ts)：使用本地 DSH build 和 sdk profile dump-config，确认 plugin active、filesystem Skill provider disabled、写工具 disabled、目标 route active。

执行模型必须完成以下验证：

~~~text
pnpm lint
pnpm test
pnpm prisma validate
pnpm prisma migrate deploy
pnpm build
~~~

并且手工完成一个带 mock/fake LLM 的 DSH 端到端回合：

1. 创建两个使用同一 Persona 的 1v1 Discussion；
2. 确认只有一个 DSH child process；
3. 确认两个 dshSessionId 不同；
4. 在 Discussion A 加载某个 reference，确认 Discussion B 的事件和 prompt 中没有该正文；
5. 重启 DSH Runtime 后继续两个 Discussion，确认 Session ID、Persona hash、Skill version 不变；
6. 修改 Persona SKILL.md 和 Skill Library 新版本，确认旧 Discussion 仍使用旧 hash，新 Discussion 使用新版本；
7. 关闭 DSH child，确认 API 返回 DSH 503 错误，没有 AI SDK fallback 和伪造 assistant 消息；
8. 让一个多人 Persona 回合失败，确认其他 Persona 继续，失败回合可用原 inputSnapshot retry；
9. 让 Moderator 输出非法 JSON，确认 stateVersion 不变且不提交半成品 summary；
10. DELETE Discussion，确认只写 archivedAt/purgeAt，不立即删除任何 session/snapshot/event。

## 13. 推荐执行顺序

严格按以下顺序执行，每一步通过测试后再进入下一步：

- [ ] 0. 阅读本方案、四份现有设计文档、项目级 AGENTS.md，并检查 DSH 0.1.2-rc.1 的 SDK、patch、SkillProvider 和 event API；记录实际 API 与本方案的对应关系。
- [ ] 1. 安装固定版本 DSH SDK/包和 Vitest，添加测试脚本，完成 dsh sdk profile 的最小启动/config dump smoke。
- [ ] 2. 扩展 Prisma schema，加入 SkillRevision、DiscussionSkill、DiscussionParticipant、AgentEvent、DiscussionTurn 和 Discussion 新字段；生成 migration，执行旧数据 backfill。
- [ ] 3. 实现 Skill Library 不可变安装、完整 bundle 保存、版本/hash、安装校验和旧 manual Skill 隔离；完成 import API/UI 改造。
- [ ] 4. 实现 Persona snapshot、Skill snapshot、manifest schema、原子文件存储和路径/hash 安全校验。
- [ ] 5. 实现 DSH plugin、scoped SkillProvider、Persona scoped system prompt、read_skill_reference、fail-closed pre-step 和受限 tool roster。
- [ ] 6. 实现 DSH profile patch、credential env 注入、DshRuntime、DshRuntimeManager、错误分类、Session mutex 和 AgentEvent 去重。
- [ ] 7. 将 1v1 Discussion API/service 迁移到 DSH，移除 1v1 的手工历史/Skill/AI SDK 调用，完成 SSE 和 resume。
- [ ] 8. 实现 DiscussionState、DiscussionTurn、多人串行 orchestrator、Moderator Session、StateProposal 校验和原子提交。
- [ ] 9. 加入 Persona failure continue、failed participant retry、Runtime fatal error、state conflict 和 archive/purge。
- [ ] 10. 更新 Discussion UI/API projection、Skill 选择 UI、runtime/error 状态显示；不把 raw AgentEvent 默认展示为聊天消息。
- [ ] 11. 删除或隔离旧 runner/oneonone 的默认调用，全文搜索确认 Discussion DSH path 不再导入 generateText/streamText/buildModel。
- [ ] 12. 完成全部 unit/integration/e2e、lint、migration、build 和上述手工验收。
- [ ] 13. 更新 [dsh-runtime-migration.md](./dsh-runtime-migration.md)、[useskill-dsh.md](./useskill-dsh.md) 中与最终实现冲突的内容，尤其是“AI SDK fallback”和“会话创建 Skill”；在本方案末尾记录实际 DSH 版本和已知限制。

## 14. 完成判定

只有同时满足以下条件才算迁移完成：

- 新建 1v1 和多人 Discussion 全部经由 DSH Runtime；
- 一个 Runtime 可以承载多个 Session，且同一 Persona 的不同 Discussion 没有上下文串线；
- Persona SKILL.md 在 Session 初始化时生效，references 只索引不 eager load，正文由 DSH 按需读取；
- 普通 Skill 只能来自已安装且被 allowlist 的不可变 revision；
- DiscussionState 是多人讨论的事实来源，summaryBox 只是展示投影；
- raw AgentEvent 和用户可见 DiscussionMessage 分离且可去重；
- 单 Persona 回合失败可继续，Runtime/协议失败不可降级；
- failed Persona retry 使用原始 TurnInputSnapshot；
- 归档可恢复，TTL 前不物理删除；
- DSH 进程关闭、Skill 不允许、manifest 损坏、路由不支持时都能得到明确错误；
- lint、test、prisma validate、migration deploy、build 全部通过。

执行其他模型时，应要求它按本文件的 checkbox 顺序推进；每完成一个阶段，报告修改文件、测试命令、测试结果和未解决的 DSH API 差异，不得自行引入未在 Global Constraints 中批准的 fallback、自动 Skill 安装、并行多人调度或副作用工具。
