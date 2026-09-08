# 讨论机制深度审查：1v1 与多人讨论（2026-09-08）

审查范围：1v1 链路（steer → streamOneOnOneDsh → runOneOnOneTurn → event-ledger → SSE）、多人链路（runDiscussion → runPersonaRound → runModeratorTurn → commitStateProposal）、followup / retry / summary / stream 路由、DiscussionSessionManager、归档交互。

---

## 🔴 P0-A：Moderator 看不到任何发言内容 —— 共识是基于消息 ID「编」出来的

`runModeratorTurn`（orchestrator.ts:83-88）给 Moderator 的 prompt 只有：

```
# 当前状态
{...DiscussionState JSON...}
# 本轮已接受的消息 ID
["msg_1", "msg_2", ...]
```

**没有一条消息的文本内容**。Moderator 是一个独立 DSH Session，persona 的发言写在他们各自的 session 和 event ledger 里，从没有喂给 Moderator。也就是说：

- `summary`（一句话共识）、`evidence`（带 sourceMessageIds 的主张）、`decisions` 全部是 Moderator **对着 ID 列表凭空编造**的；
- 而 persona 下一轮的 prompt 又注入这个 state 作为「当前共享状态」——**污染逐轮放大**；
- 前端 summaryBox 展示的「共识」与真实讨论内容无关。

这与代码里「P0：不写伪造数据」的纪律直接矛盾——机制本身在强制伪造。这是整场讨论质量问题的根因。

**修复方向**：commit 前把 `acceptedMessageIds` 对应的消息（sender + content）从 DB 取出，拼进 Moderator prompt（`# 本轮发言记录`），并限制单条长度/总 token；evidence.sourceMessageIds 校验才能真正成立。

## 🔴 P0-B：Persona 之间没有原始发言流动 —— 「多人讨论」实际是 N 个平行独白 + 一个内容盲的主持

`buildGroupPersonaPrompt` 只包含：brief、轮次、DiscussionState（即 P0-A 的产物）、本轮发言（**永远为空数组**，`roundOutputs` 死参数）、steers。Persona 的稳定 session 历史里只有**它自己的**历史发言。

信息流是「星型」的：A 看不到 B 的原话，B 也看不到 A 的原话，唯一共享通道是 Moderator 的 state 汇总——而 Moderator 又看不到任何原话（P0-A）。叠加效果：

- prompt 里要求「不重复别人、针对他人观点给出新观点」，但**没有人能真正引用或反驳他人的原始发言**；
- 多轮讨论不会产生真实的观点交锋，只会基于失真汇总各自演化。

**修复方向**：把上一轮全部 persona 消息（或全部历史消息的滚动窗口）注入每个 persona 的 prompt。这是产品语义层面的决策，但当前行为与 UI 呈现的「微信群聊式讨论」严重不符。

## 🔴 P0-C：进程重启 / 崩溃后多人讨论永久卡死在 running

- `discussions/route.ts:106` 用 `void runDiscussion(d.id)` fire-and-forget 启动；
- 服务重启（dev 模式热重载也一样）直接杀掉执行流，讨论停在 `status="running"`；
- run-lease 10 分钟后自动过期，但**过期只释放锁，不会复位 status，也没有任何 reconciliation/重触发机制**（全库无启动恢复逻辑，无 resume 端点）；
- 用户没有「重新开始」入口 → 讨论永久卡 running，前功尽弃（消息还在，但轮次推进丢失）。

**修复方向**：① 启动时（或 lease 过期时）把 `status="running" && runLeaseUntil < now` 的讨论复位为 failed/pending，并允许用户重跑；② 更好的方案：提供 resume —— `runDiscussion` 本身就是「读 state → 继续跑剩余轮次」的结构，从 `state.round` 续跑即可。

## 🟠 P1-D：followup 把 done 的多人讨论打成 running 且永不复位

`runOneOnOneTurn`（dsh-service.ts:418）**无条件**执行 `status: "running"`，但成功路径只在 `isOneOnOne` 时复位（`status: "ready"`）。对多人讨论做 followup（讨论结束后追问某人格）：

- 进入时 status: done → **running**；
- 成功 → 没有任何回写 → 永久 running；
- 失败 → 同样只有 isOneOnOne 才写 failed → 永久 running。

**修复方向**：进入前记录原状态，结束时恢复原状态；或多人讨论的 followup 不改 discussion.status。

## 🟠 P1-E：1v1 busy 拒绝后，会话永久卡在「等待回复」假象

steer 路由 1v1 分支**先落库 user 消息**，之后 `runOneOnOneTurn` 才检查 busy/lease 并返回 `DSH_SESSION_BUSY`。结果：

- user 消息已成为最后一条消息；
- 前端 `isOneOnOneReplyPending` 的判据是「最后一条是 user → 等待中」，而 busy 路径不标 participant failed；
- UI 永久转圈，用户没有任何办法除开再发一条新消息。

**修复方向**：把 busy/lease 检查提到消息落库之前；或 busy 时删除/标记该条消息。

## 🟠 P1-F：1v1 SSE 无心跳，断连后 enqueue 可能抛未捕获异常

`streamOneOnOneDsh` 整轮 DSH 跑完才发第一条 delta（设计如此，但可能持续数分钟，尤其带 web_search），期间**没有任何 heartbeat 帧**（对比：/stream 路由有 15s 心跳）——中间代理/浏览器可能掐断空闲连接。且客户端断开后 `controller.enqueue` 会 throw，catch 块里再次 enqueue 同样可能 throw，异常逃出 `start()` 成为 unhandled rejection。

**修复方向**：加 15s 心跳帧；`enqueue` 统一包 `try/catch`。

## 🟡 P2 级（机制细节）

1. **租约续约粒度太粗**：续约发生在回合之间，单回合内部（web_search 多跳可能超 10 分钟）不续约 → 租约中途过期 → 回合完成时 `isDiscussionRunOwner` 失败 → `DiscussionRunLeaseLostError` → 外层 catch 又因非 owner 不写状态 → 卡 running（与 P0-C 叠加）。建议在 `runDiscussionDshTurn` 的 onNotification 回调里周期性续约。
2. **retry 成功的消息不进共识**：retry 用旧快照 prompt 重跑，产出消息 round=N，但 Moderator 早已汇总过第 N 轮——该发言永远不进 evidence/state。
3. **summary 可重复生成**：每次 POST 都追加一条「综合建议」消息，无去重；连点产生重复气泡。
4. **1v1 状态机语义过载**：`ready` 同时表示「刚建好」和「问答空闲」，`failed` 表示「本轮失败」而非「讨论废弃」——建议拆分 discussion.status 与 turn 级状态的表达。
5. **Moderator / Persona session 无界增长**：整个讨论所有轮 prompt 都注入完整 state JSON + session 历史线性累积，长讨论 token 成本失控；state 里 evidence 只增不减。

## ✅ 做得好的

- **event-ledger**：`(sessionId, seq)` 唯一 + P2002 重试 + 事务内投影 assistant message，回放安全；
- **SSE /stream**：先装监听再查 backlog，AsyncQueue 桥接快照/实时边界，Last-Event-ID 断线续传 + 15s 心跳——这是教科书级实现；
- **DiscussionSessionManager**：fatalError 终态防止静默重放 prompt、profileHash/bridge 漂移检测、archive 生命周期取消；
- **run-lease**：条件更新无竞态获取，分阶段续约。

## 建议修复顺序

> **状态更新（2026-09-08 10:27）：P0-A / P0-B / P0-C 已全部修复并验证（tsc 干净、192 测试通过，含新增回归断言）。**
> - P0-A：`runModeratorTurn` 新增 `roundMessages` 参数，`runDiscussion` 每轮按 `acceptedMessageIds` 回查消息内容注入「# 本轮发言记录」（带消息 ID，供 evidence.sourceMessageIds 精确引用）；单条截断 3000 字符
> - P0-B：`buildGroupPersonaPrompt` 的死参数 `roundOutputs` 替换为 `history`；每轮注入此前各轮 persona/user 发言（最近 60 条，过滤本人发言避免与稳定 session 历史重复，过滤未消费 steers 避免重复注入）
> - P0-C：新增 `recovery.ts` + `src/instrumentation.ts`（服务器启动时自动恢复：1v1 过期 running 复位 ready，多人自动续跑）；新增 `POST /api/v1/discussions/:id/resume` 手动恢复入口；`runDiscussion` 改为从 `state.round + 1` 断点续跑
> - ⚠️ 注意：新增路由后需 `npx next typegen` 重新生成路由类型（已执行）；`prisma` mock 需包含 `discussionMessage.findMany`

1. ~~P0-A Moderator 注入消息内容~~ ✅
2. ~~P0-B persona prompt 注入上轮发言~~ ✅
3. ~~P0-C 启动恢复 / lease 过期复位 + resume~~ ✅
4. P1-D followup 状态恢复
5. P1-E busy 前置检查
6. P1-F SSE 心跳 + enqueue 防护
7. P2 按需清理
