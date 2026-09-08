# business-talking 代码设计评审（2026-09-08）

评审范围：`src/lib/discussion`（orchestrator / dsh-service / run-dsh-turn / run-lease / state）、`src/lib/runtime`（session-process / singleton）、`src/app/api/v1` 抽样、`src/app/(dashboard)/discussions/page.tsx`、prisma schema。
验证结果：`tsc --noEmit` 无错误；`vitest` 40 文件 191 用例全部通过。

---

## 一、总体评价

整体架构是清晰的：**Orchestrator 控轮次 → Persona 并行回合 → Moderator 串行汇总 → 乐观锁原子提交**，配合 run-lease 防并发、event ledger 做持久事件流、manifest 做 fail-closed 的 Skill 安全校验，P0「不伪造数据、不自动重试」的契约贯彻得很一致，测试覆盖也不错。这是一个设计意图明确、纪律性强的代码库。

主要问题集中在三类：**① 一条断链的功能（user steer）；② 事务/竞态上的薄弱点；③ 大文件与大组件的职责堆积**。

---

## 二、高优先级问题

### P1-1 多人讨论的用户插话（steer）是断链的 —— 功能实际不生效

- `steer/route.ts` 多人分支只写了一条 `DiscussionMessage(role="user")`，仅做记录。
- Orchestrator 构建 Persona prompt 时读取的是 `state.userSteers`（`orchestrator.ts:248` → `pendingSteers`）。
- 但**全代码库没有任何地方向 `state.userSteers` 写入数据**：`commitStateProposal` 每轮固定写 `userSteers: []`，Moderator 的 `StateProposalSchema` 里也没有 userSteers 字段。
- 结论：用户在多人讨论中的插话永远不会进入任何 Persona 的 prompt，该功能是死链路。前端却已提供插话输入框，用户会误以为生效了。

**修复方向**：steer 路由在写入 message 的同时，把 `{id, content, targetParticipantIds, createdAt}` 追加到 `discussionState.userSteers`（乐观锁更新）；或在 `runPersonaRound` 组 prompt 时从本轮未消费的 user message 读取。commit 后清空已消费的 steer 逻辑也要相应闭环。

### P1-2 `runDiscussion` 外层 catch 静默吞掉所有错误

```ts
} catch {
  // 外层 catch：绝不把异常后的流程继续到 status done…
```

错误对象被完全丢弃，不打日志、不落库（`orchestrator.ts:461`）。讨论失败时用户只看到 `status=failed`，排障只能靠猜。至少要 `console.error`，最好把错误摘要写入 `discussion.lastError` 之类的字段（participant 有 `lastError`，Discussion 层面反而没有）。

### P1-3 `commitStateProposal` 的乐观锁不是原子 CAS

先 `findUnique` 读 `stateVersion`，比较后 `update({ stateVersion: { increment: 1 } })`——check 与 act 之间没有原子性（`orchestrator.ts:153-188`）。目前靠 run-lease 单持有者缓解，但 lease 只在 `isDiscussionRunOwner` 检查点生效，两次检查之间仍有窗口。正确做法是用 `updateMany({ where: { id, stateVersion: prediction.stateVersion }, ... })` 并检查 `count === 1`，让数据库做真正的 CAS。

### P1-4 `runPersonaRound` 部分失败的静默丢弃

Persona 回合失败时只标记 participant failed，`runDiscussion` 拿到 `successfulResults` 继续让 Moderator 汇总「部分发言」。这意味着：**3 人讨论挂了 2 人，Moderator 会基于 1 个人的发言生成「共识」**，且状态上只有一个 participant 有 lastError，讨论本身标记为正常推进。是否允许部分成功应该是显式的产品决策；目前的行为既不是「全部成功」也不是「任一失败即终止」，处于模糊地带。至少应在 proposal 或 summary 中标注「本轮缺失发言者」。

---

## 三、中优先级问题

### P2-1 `buildGroupPersonaPrompt` 的 `roundOutputs` 是永久死参数

所有调用点都传 `[]`，prompt 里「# 本轮已完成发言」永远输出「（尚无）」（`orchestrator.ts:255`）。要么删掉参数，要么实现「同轮前序发言可见」的串行/混合模式。同理 `participantOrder()` 是一个带误导性注释的 no-op stub（注释说「以 DB 已建 participant 顺序为准」，实现直接返回 personaIds）。

### P2-2 `dsh-service.ts`（527 行）职责过载

一个文件同时承担：1v1 回合编排（`runOneOnOneTurn`）、manifest 组装、**安全关键的文件系统校验**（`realpathOrFail` / `isWithin` / `readVerifiedInstalledFile` 的路径穿越与 hash 校验）。后者是安全边界，值得独立成模块并配专项测试（symlink 逃逸、大小写不敏感文件系统、Windows 路径分隔符等用例），而不是埋在业务 service 里。重复的 `safeJson` 也在 orchestrator 与 dsh-service 各有一份。

### P2-3 `discussions/page.tsx` 是 1057 行的 God Component

- 约 25 个 `useState` + 多个 ref，创建表单、聊天流、审批面板、附件上传、@提及、追问全部塞在一个组件里。
- 数据获取是散装 `fetch().then()`（第 86-105 行），与后端 DTO 手工重复定义（`Msg`/`Discussion` 等接口应从 API 层共享类型）。
- SSE（`useDiscussionEvents`）+ 双 `setInterval` 轮询 + `steerStreamingRef` 防覆盖并存的刷新策略非常脆弱，竞态靠注释解释。
- 建议拆分：`DiscussionCreateForm` / `ChatStream` / `SteerInput` / `ApprovalDock` 各自独立，状态收敛到 `useDiscussion(id)` 一个 hook。

### P2-4 状态字符串缺少单一事实来源

`"ready" | "running" | "done" | "failed" | "archived"` 以裸字符串散布在 orchestrator、dsh-service、路由、前端 live-state 中，schema 里 Discussion.status 也是 String（而 RunStatus 反而有 enum）。一处拼写错误就是静默 bug。应定义 `const DISCUSSION_STATUS = [...] as const` 并在 Zod schema 中复用。

### P2-5 `session-process.ts` 的 `nodeBin()` 硬编码 Windows 路径

`C:\Program Files\nodejs\node.exe` 作为候选写死在跨平台代码里（`session-process.ts:57-59`），macOS/Linux 下完全依赖 `process.execPath` 兜底。逻辑应下沉到 `dsh-child-env` 或用环境变量覆盖。

### P2-6 `src/legacy/` 是被 tsconfig 排除的腐烂代码

`oneonone.ts` 里 `import { publish } from "./broadcast"` —— 该相对路径文件并不存在（broadcast 在 `src/lib/discussion`）。因为 `tsconfig.exclude` 了 `src/legacy`，tsc 永远不会报错，这段代码在静默腐烂。要么迁移进 `lib` 修复 import，要么删除并靠 git 历史保存。「排除在编译之外但保留在 src 里」是最差的选择。

### P2-7 API 层缺少统一的输入校验

路由普遍手写 `typeof body.message === "string"`（steer 路由），而项目里明明有 Zod 且 schema 定义规范。建议所有 POST 路由用 Zod parse，错误码也统一由 helper 生成。另外 API 无任何鉴权（本地单用户可接受，但绑定 3001 端口监听时若意外暴露到局域网，任何人可读写数据库与触发 LLM 消费）。

---

## 四、低优先级 / 风格

- **P3-1** `commitStateProposal` 每轮把 `participantStatuses: []` 清空——DiscussionState 里的 participantStatuses 字段实际上从未被真正维护，考虑删字段或真正写入。
- **P3-2** persona 错误码兜底是 `DSH_PROTOCOL_FAILED`（`orchestrator.ts:225-227`），非 DshError 的真实错误（如 Prisma 错误）被错误归类，影响失败分类统计。
- **P3-3** `runOneOnOneTurn` 中 `isOneOnOne` 判定 + 三段几乎相同的失败分支（pre-turn / result.failed / catch），可收敛为一个统一的状态回写函数。
- **P3-4** 前端 `discussions/page.tsx` 里内联的 `dayLabel`、类型定义等应放到 lib，便于测试。

---

## 五、做得好的地方（保持）

1. **run-lease** 用 `updateMany` 条件更新实现租约获取，无 read-then-write 竞态，且每阶段续约——这是很多同类项目做错的地方。
2. **Manifest fail-closed 校验链**：hash 验证 + realpath 防穿越 + allowlist 去重 + 「缺 packageRoot 即拒绝，绝不回退旧数据」的契约非常严谨。
3. **P0 反伪造纪律**：Moderator 失败不写假 summary、无真实发言禁止汇总、成功状态只在全链路成功后写入——错误处理哲学一致。
4. **事件溯源**：`runDiscussionDshTurn` 以持久 event stream 的 turn/end + assistant/message 为唯一完成依据，finalResponse 只当传输便利，容错设计正确。
5. **测试**：191 个用例覆盖了 lease、manifest、projection 等核心难点。

---

## 六、建议的修复顺序

> **状态更新（2026-09-08 10:00）：P1-1 ~ P1-4 已全部修复并验证（tsc / eslint / 191 测试通过）。**
> - P1-1：steer 路由现在以乐观锁 CAS 把插话写入 `discussionState.userSteers`（`steer/route.ts`），并新增归档守卫
> - P1-2：`runDiscussion` 外层 catch 记日志 + 错误摘要落库 `Discussion.lastError`（schema 已加字段，db push 已同步）；运行开始/成功时清空
> - P1-3：`commitStateProposal` 改为 `updateMany` 单条 CAS（`where: { id, stateVersion }`）
> - P1-4：`commitStateProposal` 接收 `roundResults`，把各参与者真实状态写入 `participantStatuses`，部分失败显式可见
> - ⚠️ 注意：`prisma generate` 时 dev server（端口 3001）锁住了引擎 DLL，需要重启 dev server 让运行时识别 `lastError` 列；另 migrations 历史存在既有漂移（`20260903000000_reconcile_discussion_artifact` 曾被修改），本次用 `db push` 同步、未重置数据库

1. ~~P1-1 steer 断链（功能 bug，用户可感知）~~ ✅
2. ~~P1-2 外层 catch 加日志与 lastError 落库（排障成本）~~ ✅
3. ~~P1-3 commitStateProposal 改真 CAS（一行改动）~~ ✅
4. P2-6 决定 legacy 目录去留（避免继续腐烂）
5. ~~P1-4 部分失败的显式策略（产品决策 + 小改动）~~ ✅
6. P2-1/P3 清理死参数与 stub
7. P2-3 前端大组件拆分（可结合下一次功能迭代做）
