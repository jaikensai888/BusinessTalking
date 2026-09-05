# 步骤 0：真实 DSH 0.1.2-rc.1 API 与方案对应关系

> 依据 `dsh-runtime-execution-plan.md` 第 13 节的第 0 步，核对真实 DSH SDK/patch/SkillProvider/event
> API 与本方案的对应关系。所有结论来自实际安装并运行 `@deepseek-ai/dsh-sdk-client@0.1.2-rc.1`、
> `@deepseek-ai/dsh@0.1.2-rc.1` 及其依赖，在隔离目录中做的真实冒烟（spawn runtime → initialize →
> 真实 agent 回合 → close）。

## 1. 可行性结论（已验证）

- 方案引用的所有 `@deepseek-ai/*@0.1.2-rc.1` 包在 npm 上均真实存在（`dsh-sdk-client`、`dsh`、
  `dsh-agent`、`dsh-llm`、`dsh-skill`、`dsh-tools`、`dsh-llm-pi-ai`）。
- `dsh --profile sdk --dump-config` 可正常打印完整的运行时组合树（真实、可 patch）。
- SDK client 可 spawn `dsh --profile sdk` 子进程、完成 initialize 握手、执行真实 agent 回合并返回
  `finalResponse` + `events` + `notifications`。**整条链路可行性已证实。**

## 2. `@deepseek-ai/dsh-sdk-client` 真实 API

导出：`DeepSeekHarness`, `HarnessSession`, `HarnessClient`, `RequestTimeoutError`,
`SdkProtocolError`, `TransportClosedError`, `JsonRpcResponseError`（来自 `dsh-sdk-protocol`），
类型 `RunResult`, `DeepSeekHarnessOptions`, `HarnessClientOptions`, `HarnessNotification`,
`SdkPromptContentBlock` 等。

```ts
class DeepSeekHarness implements AsyncDisposable {
  constructor(options?: DeepSeekHarnessOptions)
  get client(): HarnessClient
  start(): Promise<void>
  session(sessionId?: string): HarnessSession
  run(input: string | SdkPromptContentBlock[], options?: RunOptions): Promise<RunResult>
  close(): Promise<void>
}
interface DeepSeekHarnessOptions extends HarnessClientOptions {
  cwd?: string
  provider?: string       // 默认 deepseek-official
  model?: string          // 默认 deepseek-v4-flash
  reasoningEffort?: ReasoningEffortId
  maxTokens?: number
}
interface HarnessClientOptions {
  dshBin?: string
  profile?: string        // 默认 sdk
  patches?: string[]
  dshHome?: string
  processCwd?: string
  env?: NodeJS.ProcessEnv // 整体替换子进程环境（credential 策略归调用方）
  initializeTimeoutMs?: number  // 默认 10000
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  disposeEofGraceMs?: number
  disposeGraceMs?: number
}
interface RunResult {
  sessionId: string
  finalResponse: string
  events: SessionEvent[]
  notifications: HarnessNotification[]
}
interface RunOptions {
  sessionId?: string
  onNotification?: (n: HarnessNotification) => void   // 整个 session tree 的逐条通知
}
```

### 与方案 5.3 的差异

| 方案描述 | 真实 API | 处理 |
|---|---|---|
| `ensureStarted(profile)` | `harness.start()`（惰性，首次 run 自动） | Manager 用 `run()` 首启，或显式 `start()` |
| `run(sessionId, prompt, onNotification)` | `harness.run(prompt, { sessionId, onNotification })` 或 `harness.session(id).run(prompt, { onNotification })` | 一致，只是参数顺序不同 |
| `assertHealthy()` | `harness.client` 存在；无内置 health API | 用 `TransportClosedError`/client 状态判断 |
| `close()` | `close()`（幂等，stdin-EOF→SIGTERM→SIGKILL 阶梯） | 一致 |
| 主动提供 per-session close | 无 per-session close | 逻辑归档只删 BT 关系与 snapshot，不 close 整个 Runtime（与方案一致） |
| mid-turn cancel | **无**（协议层无 prompt-cancel；放弃轮次只能关闭 Runtime） | 一期不实现 mid-turn cancel，符合方案 |
| per-prompt 结果归属 | `finalResponse` 是该 interval 最后一条根会话 assistant 文本，**不因果归属**prompt | 事件投影用 events 做最终消息，不依赖因果归属 |

## 3. 错误分类（真实类型）

- `JsonRpcResponseError`：JSON-RPC 错误响应（code+data）→ 方案 `DshProtocolError`
- `RequestTimeoutError`：请求超时 → `DshRuntimeError`
- `SdkProtocolError`：响应超出协议 → `DshProtocolError`
- `TransportClosedError`：Runtime 进程消失（含退出码+stderr 尾部）→ `DshRuntimeError`（进程级，不得降级）

## 4. 事件/通知词汇（真实采集）

一次真实回合的 `RunResult.events[]` 的 `type`：

```
agent/inbox/spliced   turn/start   step/start   user/message   session/title
request/header        request/context   assistant/chunk   assistant/message
step/end              turn/end
```

通知 method 集：

```
session.event   session.status
```

`session.event` 每个事件的形状：`{ type, seq, time, data }`；`assistant/message` 携带该条 assistant
文本，最终 assistant 文本可用 `finalResponse()`/`RunResult.finalResponse` 提取。`agent/inbox/spliced`
记录用户 prompt 入队（含 `id`），用于等待入队回执。

> 与方案 5.4 对应：`session.event` → `AgentEvent`；`assistant/message` → 最终 `DiscussionMessage`
> 投影；`seq` → `AgentEvent.seq`，`(sessionId, seq)` 唯一；`session.status` → 调试/状态。

## 5. sdk profile 组合（可从 `--dump-config` patch 的关键 id）

`dsh --profile sdk --dump-config` 产出的组合（真实存在，方案 5.2 的 patch 以此为准）：

| id | 状态 | 说明 |
|---|---|---|
| `skill-filesystem` | 默认存在 | 方案要求 **disabled**（关闭默认 filesystem Skill provider） |
| `skill` | 默认存在 | DSH skill 机制（catalog/按需加载） |
| `tool-web`, `web-search-deepseek`, `web-fetch-http` | 默认存在 | 方案要求 **disabled**（用私有的只读 web_search 替代） |
| `llm-pi-ai` | 默认存在 | 承载 openai/anthropic route（方案：只保留被选中 route） |
| `llm-deepseek` | 默认存在 | 方案要求关闭未使用的 route，避免抢占 |
| `tool-bash`, `tool-goal`, `tool-todo`, `tool-workflow`, `tool-jobs` | 默认存在 | 方案要求 **disabled**（无副作用工具） |
| `agent-loop`, `system-prompt`, `subagent`, `session-projection` | 默认存在 | 保留 |

## 6. 插件注入点（待最终核对，属步骤 5 深度工作）

Runtime 用 `--profile sdk --patch ./cordis.patch.yml` 挂载 BusinessTalking plugin，plugin 内注册
agent-scoped SkillProvider、Persona prompt（session-start/deployment section）、`read_skill_reference`、
只读 `web_search`、fail-closed pre-step。SDK client 的 `patches` 数组即对应 `--patch`，方案 5.3 的
`patches=[cordis.patch.yml, runtime patch]` 成立。具体 Cordis/SkillProvider/hook 事件名与
`deployment:persona` section 的精确形态需在步骤 5 开始前对 `@deepseek-ai/dsh-skill`、
`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-android-base` 等包的类型逐一核实（本阶段未定稿）。

## 7. 环境本身

- `dsh` CLI 同时在 `C:\Users\jaike\AppData\Roaming\DSH Desktop\host-commands\desktop\bin\dsh.cmd`
  找到（桌面 bundle）,但 SDK client 解析的是「同版本 `@deepseek-ai/dsh` 包」的 bin，二者互不依赖。
- 冒烟中真实回合返回了模型输出，说明当前环境存在可用的 deepseek 凭证（继承自父环境或本地配置）。

## 8. 对方案措辞的重要提醒

- 方案第 4 步写 `@deepseek-ai/dsh-sdk-client` 等 7 个包固定为 `0.1.2-rc.1` —— 全部**真实存在**。
- 方案 5.2 的 provider route 映射中 `llm` id 在 sdk profile 里叫 `llm-pi-ai`，且 `llm-deepseek`
  默认也在；patch 时应以真实 id 为准。
- 方案 5.4 的 `onNotification` 是**整个 session tree** 的通知，需按 sessionId+seq 去重；subagent
  事件第一期记录但不启用 subagent roster（与方案一致）。
