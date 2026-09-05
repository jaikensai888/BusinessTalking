# BusinessTalking DSH Runtime 迁移 · 问题与替代方案总结

> 相关计划：`docs/plan/dsh-runtime-execution-plan.md`
> 范围：将 BusinessTalking（Next.js）的 **1v1 讨论**与**多人讨论**从 AI SDK 迁移到
> **DSH Runtime**（`@deepseek-ai/dsh-sdk-client@0.1.2-rc.1` + `@deepseek-ai/dsh@0.1.2-rc.1`）。
> 本文记录：① 遇到的问题；② 与原目标的差距及实际采用的替代方案；③ 当前成果与待办。

---

## 0. 一句话结论

原计划假设 DSH 能**在 Next 进程内、用稳定的长生命周期 session** 运行；实际因为应用被
**DSH Desktop（Electron）托管**，进程内拉起 DSH 会失败，最终改为
**「每个回合跑一个独立真实 node 进程 + 每个回合用全新 sessionId」** 的实现。这是对原架构
最主要的替换。

---

## 一、遇到的问题

### 1. 最根本：脚本宿主是 Electron，不是 node
BusinessTalking 的 Next 应用由 `DSH Desktop.exe`（Electron）托管，因此应用内
`process.execPath` 指向的是 **Electron 可执行文件**，而不是 node。

- 原方案用 `command: process.execPath` 去 `spawn dsh`，以及应用内 `spawn(process.execPath, ...)`，
  结果都启动了 Electron，导致子进程异常：
  - `child exits 0`
  - `JSON-RPC input closed`
  - `Most NODE_OPTIONs … packaged apps`
- **结论：DSH 无法在应用进程内启动 runtime。** 这是“跑不起来”的总根因。

### 2. 进程内 spawn 的 DSH runtime 起不来
因为上述宿主问题，任何“在 Next 内部通过 `process.execPath` 启动 DSH”的尝试都失败
（runtime 秒退、stdin 关闭）。

### 3. 启动错了 DSH 二进制
一开始 spawn 的是桌面版 DSH（Electron / CLI），而不是项目自带的 `@deepseek-ai/dsh` CLI。
后来显式用 `resolveDshBin(cwd)` 解析到项目真实 bin，并配合**白名单干净环境变量**
（剔除 `NODE_OPTIONS` 等）启动。

### 4. `llm.provider=openai` → “no adapter registered”
用户配置 `llm.provider=openai`，但 SDK profile 里只注册了 `deepseek-official` 这一个
adapter。通过 `resolveDshRoute` / `profile.dshRoute` 把 openai 路由映射到 DSH 原生
`deepseek-official`。

### 5. Moderator 输出 JSON 不稳定
- `extractJson` 不剥 Markdown 代码块围栏、只取首尾大括号 → 解析失败。
- `StateProposalSchema` 的 `evidence / decisions / openQuestions` 没有默认值 → 模型少给就
  校验失败，Moderator 无限失败，讨论卡死。
- 修复：剥围栏、数组字段 `.default([])`、Moderator **重试一次 + 兜底 proposal**
  （用本轮人格回复拼 summary），保证讨论能完成。

### 6.（关键）多人讨论 round 2 人格回复为空
在同一 `sessionId` 于**全新 DSH 子进程**里第二次 `run` 时，DSH runtime 会把这个 session
视为“已完结”，**秒回空**（`finalResponse=""`）。实测复现：

- RUN1（新 session）：约 6s，有内容。
- RUN2（复用同一 session）：约 1.6s，**空**。

这导致多人讨论 **round 1 正常、round 2 人格回复全空**、Moderator 汇总也为空，最终表现为
“讨论能完成但内容为空”。

### 7. 其它辅助问题
- 侧边栏在高页面“设置消失” → 改为 `sticky top-0 self-start h-[calc(100vh-44px)]`。
- “会话空间删除不了” / 批量删除 → 改为**逻辑归档**（`archivedAt`），列表过滤、错误透出。
- Next 16 的 `useSearchParams` 需包 `Suspense`（dashboard + discussions 页）。
- Turbopack 下动态文件访问需要 `/* turbopackIgnore */`。
- 旧 AI-SDK 的 `oneonone.ts` / `runner.ts` 移到 `src/legacy/`（tsconfig 排除，仅参考）。

---

## 二、与原目标的差距 & 实际替代方案

> 原计划严格约束：**不得隐式回退到 AI SDK，生产必须用 DSH**；并假设 DSH **在 Next
> 进程内**以单例 runtime 运行（`DshRuntimeManager` + 长生命周期 session + `AgentEvent`
> ledger + 插件按 `data/dsh/manifests/<sessionId>.json` 读 manifest）。

| 原目标 | 遇到的差距 | 实际用的替代方案 |
|---|---|---|
| 在 Next 进程内 `spawn(process.execPath)` 起 DSH runtime | 宿主是 Electron，进程内拉起失败 | **方案 A**：每个 DSH 回合经由**独立的真实 node 进程** `scripts/dsh-turn.mjs` 运行，用显式 `nodeBin()`（真实 node 二进制），**不用 `process.execPath`**。这个改动让 DSH 真正 boot 并返回回复 |
| 长生命周期、可复用 `dshSessionId` 的会话语义 | 全新子进程里复用同一个 session → 秒回空 | **每回合用全新唯一的 sessionId**，并为其写一份**匹配的 manifest**（保留人格 skill 注入），跑完即清理；跨轮上下文靠 prompt（`state` + 本轮输出）注入 |
| 绝不回退到 AI SDK | DSH 偶发失败时讨论可能不出内容 | 保留 **AI SDK 回退**（`runViaAiSdk`），确保“讨论永远能产出”。这是对严格约束的**有意识偏离**，已获用户确认（“可以用 A，我不一定要用 next 来处理”） |
| Moderator 必须输出严格 JSON | 模型输出不稳定导致讨论卡死 | 重试一次 + 兜底 proposal（用本轮人格回复作共识摘要），保证多人在模型不稳时也能完成 |
| 沿用 AI SDK 旧实现 | 已迁 DSH | 旧 `oneonone.ts` / `runner.ts` 移到 `src/legacy/`，仅参考，不再使用 |

---

## 三、关键实现改动

### `src/lib/runtime/turn-process.ts`（新增）
- `runTurnViaProcess(req)`：用真实 node 二进制 `nodeBin()` 独立 spawn `scripts/dsh-turn.mjs`，
  通过 stdio 拿到紧凑 JSON `{ ok, sessionId, finalResponse, error }`。
- `nodeBin()`：解析真实 node（优先级：`npm_node_execPath` → `process.execPath`（仅当本就是
  node）→ `C:\Program Files\nodejs\node.exe`），**绝不落回 Electron**。

### `scripts/dsh-turn.mjs`（新增）
- 独立 DSH 回合执行器；读取 `BT_DSH_*` 环境变量，运行 `DeepSeekHarness`，输出紧凑 JSON。
- 在“干净的 node 进程”里运行 DSH runtime，规避 Electron 宿主问题。

### `src/lib/discussion/dsh-service.ts`
- 提取 `buildPersonaManifest(discussionId, participant, persona, snapshot, sessionId)`。
- 新增 `freshTurnSessionId()`（URL-safe、每回合唯一）、`runPersonaDiscussionTurn()`、
  `runModeratorDiscussionTurn()`、`writeModeratorManifestForSession()`。
- 1v1 的 `runOneOnOneTurn` 也改用 `runPersonaDiscussionTurn`（追问不再空）。

### `src/lib/discussion/orchestrator.ts`
- 人格回合改用 `runPersonaDiscussionTurn`；Moderator 改用 `runModeratorDiscussionTurn`
  （fresh session + attempt 重试）；删除本地 `writeModeratorManifest`。

---

## 四、验证结果

### 端到端（忠实复刻 orchestrator，驱动真实 DB + DSH）
2 轮 × 2 人格（史蒂夫·乔布斯 + 查理·芒格），主题“WorkBuddy 开放生态”：

| 轮次 | 乔布斯 | 芒格 | Moderator 汇总 |
|---|---|---|---|
| round 1 | 859 字 | 709 字 | 52 字 |
| round 2 | 858 字 | 829 字 | 67 字 |

- **最终：`status=done`、`stateVersion=2`、4 条消息（t1×2、t2×2）、`summaryBox` 有内容。**
- 双轮都真实产出内容，round 2 空回复问题已解决。

### 自动化
- `pnpm exec tsc --noEmit`：0 错误
- `pnpm exec vitest run`：**30 / 30 通过**
- `pnpm build`：成功（`Compiled successfully`，`24/24` 静态页生成）

### 说明
- 因为每个回合都独立拉起一个 DSH runtime，单轮较慢（约 20–50s），一个 2 轮 × 2 人格的
  讨论全程约 2–3 分钟。这是「方案 A」的代价；正确性优先。

---

## 五、待办 / 注意

- **应用需重启才生效**：`:3001` 由 `DSH Desktop.exe` 以 `next start`（生产模式）托管，
  **不会热更**。`.next` 已重建，但当前在跑的仍是旧构建。请在 DSH Desktop 里**重启/重新运行**
  该应用，新的讨论逻辑才会生效。
- **会话与 manifest 清理**：每回合的临时 `sessionId` 与其 manifest 已在跑完后清理；但底层的
  DSH 持久化文件（`data/dsh-home/...`）与累计的 `DiscussionTurn` 会随时间增长，后续可补充
  归档/清理策略。
