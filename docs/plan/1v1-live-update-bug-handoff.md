# BusinessTalking · 1v1 讨论回复不显示 —— 问题交接报告

> 目的：把「1v1 提问后回复不显示（需手动刷新才出现）」这个问题完整描述清楚，交给你/其它 AI 继续修改。
> 项目路径：`G:\claude_project\code-agent\business-talking`（Next.js 16 + Prisma/SQLite + DSH Runtime）。

---

## 1. 一句话症状

**后端每次都成功生成并持久化了 1v1 回复（数据库里一直有），但前端实时更新不显示；只有手动 `Ctrl+R` 刷新后，回复才出现。** 此前还叠加了“前端没显示『正在思考』”，后来出现了「正在思考→闪一下→消失→无回复」。

---

## 2. 架构背景（重要，别被误导）

- 项目用 **DSH Runtime**（`@deepseek-ai/dsh`）跑讨论，**不是 AI SDK**。
- 讨论执行路径：
  - 1v1：`POST /api/v1/discussions/:id/steer` → `src/lib/discussion/oneonone-dsh.ts` 的 `streamOneOnOneDsh` → `src/lib/discussion/dsh-service.ts` 的 `runOneOnOneTurn` → `runTurnViaDsh`。
  - `runTurnViaDsh`（`src/lib/discussion/dsh-service.ts`）调用**常驻进程内 DSH runtime**：
    ```ts
    await ensureStartedForSettings();          // 惰性启动单例 DshRuntimeManager
    const mgr = getRuntimeManager();
    const res = await mgr.run(sessionId, prompt);  // 跨回合复用同一 DSH 进程
    return res.finalResponse;
    ```
  - `getRuntimeManager`/`ensureStartedForSettings` 在 `src/lib/runtime/singleton.ts`；`DshRuntimeManager` 在 `src/lib/runtime/manager.ts`；`DeepSeekDshRuntime` 在 `src/lib/runtime/dsh-runtime.ts`（持有一个 `DeepSeekHarness`）。
- 关键点：**服务器必须是真实 node 进程**（`process.execPath=node`）。若被 `DSH Desktop.exe`（Electron）托管，`process.execPath=Electron`，DSH 在进程内起不来。用 `npm run dev`/`npm run start` 直接跑即可。
- 多人讨论走 `src/lib/discussion/orchestrator.ts`（人格回合 + Moderator，同样用 `runTurnViaDsh`）。

---

## 3. 已核实的事实（后端 100% 正常）

用 `prisma/dev.db`（node:sqlite 直接查）确认，以下是多个短号的真实状态：
- `7SJRAK`：user → 乔布斯 1016 字；`Q4EDQ3`：乔布斯 1077 字；`696JFT`(张雪峰)：458 字，user 10:14:59 → reply 10:15:05（约 5.7s）。
- 每个讨论：`Discussion.status='ready'`、`DiscussionMessage` 有 `role='persona'` 消息、`DiscussionTurn.status='completed'`、`errorCode=null`。
- 即：**回复生成、落库、服务端返回全部正常**。

`/steer` 的 SSE 用 node 客户端实测：
- `Content-Type: text/event-stream`、status 200；
- 返回 `data:{"type":"delta","text":"…完整回复…"}` + `data:{"type":"done"}`；
- `GET /api/v1/discussions/:id` 返回 2 条消息（user + persona）。

---

## 4. 已做过的前端排查

`src/app/(dashboard)/discussions/page.tsx`（单页应用，客户端组件）：

- **1v1 发送链路**：`sendSteer` 里 `if (isOne)` 分支：
  1. `setSending(true)`（驱动“正在思考”）。
  2. push 乐观消息 `[user, aiMsg(streaming)]`。
  3. `steerStreamingRef.current = true`（避免 `/stream` 的 `change` 触发 `load()` 覆盖乐观气泡）。
  4. `fetch('/api/v1/discussions/:id/steer')`，读 SSE 帧：`delta`→`patchLast(content=full)`，`done`→`patchLast(content=full,streaming=false)`，`error`→`setError+removeLast`。
  5. `finally`：`steerStreamingRef=false`，并（已加）`startReplyPoll(discussionId)`。
- **`connectLive`(viewId 模式)**：连 `/stream` SSE，收到 `change` 且 `!steerStreamingRef.current` 时 `load(id)`。
- **`startReplyPoll(id)`（我最新加的，未端到端验证）**：每 2s `GET /discussions/:id`，`setCurrent(d.data)`；当出现 `role==='persona'` 且内容非空时停止轮询并 `setSending(false)`（保底 90s 超时）。本轮目的是：**回复以数据库为准，无论 SSE 怎样都能显示**。
- **“正在思考”渲染**：`{isOne && (thinking || sending) && …}`。注意 1v1 的 `status` 始终是 `ready`（从未置为 `running`），所以不能靠 `thinking`，必须靠 `sending`。
- `stopLive()` 已清理 `replyPollRef`/`pollRef`/`streamAbortRef`。

> ⚠️ `startReplyPoll` 是通过 `pnpm build` 的源码改动，但**.next 可能未同步**（构建曾被中断）。请先确认 `GET /discussions` 的 HTML 引用的 chunk 里含“正在思考”/新逻辑，或直接重新 `pnpm build`。

---

## 5. 一个关键且矛盾的证据（请重点复核）

我用 **Playwright（真实 chromium，全新无缓存）** 跑通了完整链路：
```
创建 1v1 → 打开 → 提问 → [+0.1s]「正在思考」true → [+4.2s] 回复出现
```
**无头浏览器上表现正确（thinking + 回复都来）。** 但用户在**自己浏览器**上仍看不到实时回复（只有刷新才有）。

**这个矛盾提示两个可能根因之一，必须确认：**
1. **用户浏览器加载的是旧 JS**：单页应用重启服务器后**不会自动换 JS**，用户之前的硬刷新可能没真正替换 JS 包（只刷新了数据）。→ 让用户用**无痕窗口**访问 `:3001` 验证。
2. **前端 live 更新真有 bug**：`/steer` SSE 在浏览器里提前结束/被缓冲，导致 `finally` 提前把 `sending` 置 false（“正在思考”消失），且此刻回复还没落库，因而 `load()` 拿不到回复、也没再同步。我加的 `startReplyPoll` 就是为此兜底，但**尚未在你的真实浏览器里验证**。

**请务必先排除第 1 点（无痕窗口）**；若无痕窗口仍复现“正在思考→消失→无回复”，则按第 2 点继续修。

---

## 6. 复现步骤（供验证）

1. 确保 `:3001` 跑的是**最新构建**：`npm run dev`（热加载更省事）或 `pnpm build && npm run start`。
2. 用**无痕/隐私窗口**访问 `http://localhost:3001`。
3. 新建 1v1（任选一人生格）→ 打开 → 底部输入框提问 → 回车。
4. 期望：出现「某某正在思考…」→ 数秒后回复实时出现。
5. 实际（用户侧）：多数情况**无实时回复**，需刷新才有；有时「正在思考」出现又消失。

---

## 7. 待修改/验证的任务清单（给接手 AI）

- [ ] `pnpm build` 并把 `:3001` 起在最新构建上；确认页面 chunk 含“正在思考”。
- [ ] 用**无痕窗口**复现；若正常 → 是缓存问题（已修，只需用户无痕访问）。
- [ ] 若仍复现：在 `src/app/(dashboard)/discussions/page.tsx` 的 1v1 发送链路里确认：
  - `startReplyPoll` 是否真的让回复**始终出现**（它每 2s 从库读，理应保证）；
  - `/steer` SSE 是否提前结束（读一段 console/network 时间线）；
  - 若需彻底稳：把 1v1 回复显示**完全改为轮询数据库**（`startReplyPoll`），去掉对乐观气泡 + SSE delta 的依赖。
- [ ] 复核“正在思考”：1v1 依赖 `sending`（因为 status 一直是 ready），确认它从发送起保持 true，直到 `startReplyPoll` 检测到回复才置 false。

---

## 8. 前端相关代码位置（`src/app/(dashboard)/discussions/page.tsx`）
- `steerStreamingRef`（约 line 64）、`replyPollRef`（约 line 63）。
- `stopLive`（约 line 168）、`startPolling`（约 line 193）、`startReplyPoll`（约 line 199）。
- `load`（约 line 177）、`connectLive`（约 line 201）。
- `sendSteer`：1v1 分支约 line 373–495；`finally` 约 line 489（此前的 `setSending(false)+void load()` 已改为 `startReplyPoll`）。
- “正在思考”渲染约 line 763。

后端无需改动（已确认正常）。若确需，后端文件参考：
- `src/app/api/v1/discussions/[id]/steer/route.ts`
- `src/lib/discussion/oneonone-dsh.ts`
- `src/lib/discussion/dsh-service.ts`
- `src/lib/discussion/orchestrator.ts`
