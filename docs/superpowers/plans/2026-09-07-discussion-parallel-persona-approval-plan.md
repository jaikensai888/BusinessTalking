
# Discussion 并行 Persona 与 Discussion 级 web_search 审批实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`-`) syntax for tracking.

**Goal:** 将多人 Discussion 改为同轮 Persona 有界并行执行，并把 `web_search` 审批提升为当前 Discussion 内所有 Persona Session 共用的一次性决定，同时保证 Moderator 隔离、运行互斥、失败收敛和生命周期安全。

**Architecture:** 保留“一条 Discussion 一个 DSH runner、多个稳定逻辑 Session”的结构。Orchestrator 在每轮读取一次状态快照，用有界并发启动 Persona Session，等待所有任务 settled 后才调用 Moderator；审批由数据库中的 `DiscussionCapabilityGrant` 保存长期决定，内存 Bridge 只合并 pending 请求并唤醒等待者。Discussion 使用带过期时间的 `activeRunId` lease 防止重复 Orchestrator，回合和迟到回调通过 `runId` 过滤。

**Tech Stack:** Next.js 16.3.4 App Router、TypeScript、Prisma 6.19.3、SQLite、Vitest 4.1.8、DSH SDK runner、SSE。

**Spec:** `docs/superpowers/specs/2026-09-07-discussion-parallel-persona-approval-design.md`

## Global Constraints

- 同一轮 Persona 不读取其他 Persona 本轮即时回复，全部使用同一个轮次开始状态快照。
- Discussion 级授权只覆盖 `web_search` 和 Persona Session；Moderator 永远拒绝。
- 用户拒绝后，当前 Discussion 的 `web_search` 状态为 `denied`，后续请求不再弹审批。
- 同一 Discussion 同时只能有一个有效 `activeRunId`；重复启动必须在数据库条件更新阶段失败。
- Persona 并发默认上限为 `4`，环境变量 `BT_DSH_MAX_PARALLEL_PERSONAS` 只接受 `1..8`。
- 单个人格 `DSH_TURN_FAILED` 允许同轮其他人格继续；协议、manifest、权限、runner fatal 和未知错误终止整轮。
- Moderator 仍使用独立 Session，manifest 不注册 `web_search`；本计划不扩大 Moderator 输入为完整 Persona 正文。
- 不引入新的运行时 provider/baseURL 路由，不接通多人 steer，不实现真正的 DiscussionState CAS，不重写前端 SSE 架构。
- 每个生产代码改动必须先有一个能正确失败的测试；每个任务完成后运行该任务指定的最小测试。

---

## 文件与职责地图

### 数据与运行互斥

- Modify: `prisma/schema.prisma` — 为 Discussion 增加运行 lease 字段、为 DiscussionTurn 增加 `runId`、增加 `DiscussionCapabilityGrant` 模型及关系。
- Create: `prisma/migrations/20260907000200_discussion_parallel_approval/migration.sql` — 为现有 SQLite 数据库添加字段、表、索引和外键。
- Create: `src/lib/discussion/run-lease.ts` — 提供 `acquireDiscussionRun`、`renewDiscussionRun`、`releaseDiscussionRun`、`isDiscussionRunOwner`。
- Create: `src/lib/discussion/capability-grant.ts` — 提供 `getDiscussionCapabilityGrant`、`saveDiscussionCapabilityGrant`、`deleteDiscussionCapabilityGrants`，所有查询均绑定 `discussionId + capability`。

### 审批桥与接口

- Modify: `src/lib/discussion/approval-bridge.ts` — 从 Session 级 grant 改为 `web_search` Discussion 级 grant；合并同一 Discussion 的 pending 请求；校验 Persona Session；读取/保存数据库决定。
- Modify: `runtime/dsh-plugin/index.mjs` — 在内部请求中发送 manifest 的 `kind` 作为 Session 类型声明；仍只接受 DSH runtime 能理解的放行/拒绝结果。
- Modify: `src/app/api/internal/dsh/approval/route.ts` — 校验审批请求字段并把数据库/Session 校验交给 Bridge。
- Modify: `src/app/api/v1/discussions/[id]/approvals/[approvalId]/route.ts` — 接受 `allowed-discussion`，拒绝非法 scope/outcome。
- Modify: `src/components/discussions/dsh-approval-panel.tsx` — web_search 显示“允许本次讨论”，拒绝显示“拒绝本次讨论”。
- Modify: `src/lib/discussion/dsh-turn-projection.ts` — 给 pending approval 添加 `scope` 字段，并保留同一审批事件去重。
- Modify: `src/hooks/use-discussion-events.ts` — 校验/透传可选 `scope`，不改变 durable cursor 语义。

### 并行 Orchestrator 与 DSH 回合

- Modify: `src/lib/discussion/orchestrator.ts` — 引入 run lease、有界 Persona 并行、固定结果顺序、fatal 收敛和 runId 传递。
- Modify: `src/lib/discussion/run-dsh-turn.ts` — 接受 `runId`，创建带 runId 的 DiscussionTurn，并在关键写库前确认当前 Discussion/run 仍有效。
- Modify: `src/lib/runtime/discussion-session-manager.ts` — 保证不同 Session 可并发、同一 Session 仍 busy，并在 Discussion 关闭时取消相关任务。
- Modify: `src/lib/runtime/session-process.ts` — 只在测试需要时调整单进程多 request 的取消/关闭行为，保持 requestId/sessionId 分流。

### 测试

- Modify: `tests/unit/dsh-approval-bridge.test.ts`
- Modify: `tests/unit/dsh-approval-route.test.ts`
- Modify: `tests/unit/dsh-plugin.test.ts`
- Modify: `tests/unit/dsh-turn-projection.test.ts`
- Modify: `tests/unit/discussion-session-manager.test.ts`
- Modify: `tests/unit/orchestrator.test.ts`
- Modify: `tests/unit/orchestrator-failure-state.test.ts`
- Modify: `tests/unit/run-dsh-turn.test.ts`
- Create: `tests/unit/discussion-run-lease.test.ts`
- Create: `tests/unit/discussion-capability-grant.test.ts`

---

## Task 1: 建立数据库模型、迁移和运行 lease

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260907000200_discussion_parallel_approval/migration.sql`
- Create: `src/lib/discussion/run-lease.ts`
- Create: `tests/unit/discussion-run-lease.test.ts`

**Interfaces:**
- Produces `acquireDiscussionRun(discussionId: string): Promise<{ runId: string; leaseUntil: Date } | null>`。
- Produces `renewDiscussionRun(discussionId: string, runId: string): Promise<boolean>`。
- Produces `releaseDiscussionRun(discussionId: string, runId: string): Promise<boolean>`。
- Produces `isDiscussionRunOwner(discussionId: string, runId: string): Promise<boolean>`。
- `DiscussionTurn.runId` 允许空值以兼容旧数据，但新 DSH Discussion turn 必须写入非空 runId。

- [ ] **Step 1: Write the failing lease tests**

在 `tests/unit/discussion-run-lease.test.ts` 中 mock `@/lib/db` 的 `prisma.discussion.updateMany` 与 `findUnique`，覆盖以下行为：

~~~
it("acquires only when the Discussion has no active non-expired run", async () => {
  mocks.updateMany.mockResolvedValueOnce({ count: 1 });
  await expect(acquireDiscussionRun("d1")).resolves.toEqual(expect.objectContaining({ runId: expect.any(String) }));
  expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: "d1" }),
    data: expect.objectContaining({ activeRunId: expect.any(String), runLeaseUntil: expect.any(Date) }),
  }));
});

it("returns null when another non-expired run owns the Discussion", async () => {
  mocks.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(acquireDiscussionRun("d1")).resolves.toBeNull();
});

it("renews and releases only for the owning runId", async () => {
  mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
  await expect(renewDiscussionRun("d1", "run-1")).resolves.toBe(true);
  await expect(releaseDiscussionRun("d1", "run-1")).resolves.toBe(true);
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run:

~~~
npx vitest run tests/unit/discussion-run-lease.test.ts
~~~

Expected: FAIL because `src/lib/discussion/run-lease.ts` and the new Prisma fields do not yet exist.

- [ ] **Step 3: Add the schema fields and model**

在 `Discussion` 中增加：

~~~
activeRunId       String?
runLeaseUntil     DateTime?
capabilityGrants  DiscussionCapabilityGrant[]
~~~

在 `DiscussionTurn` 中增加：

~~~
runId String?

@@index([discussionId, runId])
~~~

新增：

~~~
model DiscussionCapabilityGrant {
  id           String   @id @default(cuid())
  discussionId String
  capability   String
  status       String
  decidedAt    DateTime?
  decidedBy    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  discussion Discussion @relation(fields: [discussionId], references: [id], onDelete: Cascade)

  @@unique([discussionId, capability])
  @@index([discussionId, status])
}
~~~

- [ ] **Step 4: Add the SQLite migration**

迁移必须完成以下操作：

~~~
ALTER TABLE "Discussion" ADD COLUMN "activeRunId" TEXT;
ALTER TABLE "Discussion" ADD COLUMN "runLeaseUntil" DATETIME;
ALTER TABLE "DiscussionTurn" ADD COLUMN "runId" TEXT;
CREATE INDEX "DiscussionTurn_discussionId_runId_idx" ON "DiscussionTurn"("discussionId", "runId");
CREATE TABLE "DiscussionCapabilityGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscussionCapabilityGrant_discussionId_fkey"
      FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DiscussionCapabilityGrant_discussionId_capability_key"
  ON "DiscussionCapabilityGrant"("discussionId", "capability");
CREATE INDEX "DiscussionCapabilityGrant_discussionId_status_idx"
  ON "DiscussionCapabilityGrant"("discussionId", "status");
~~~

外键必须使用 `ON DELETE CASCADE`，保证硬删除 Discussion 时不会残留 grant。

- [ ] **Step 5: Implement the lease functions**

`run-lease.ts` 使用 `crypto.randomUUID()` 生成 runId；lease 时长固定为 10 分钟。`acquireDiscussionRun` 使用一次 `updateMany` 条件更新，条件为 Discussion 存在且 `activeRunId` 为空或 `runLeaseUntil` 已过期，状态不能为 `archived`。返回 count 为 0 时返回 null。`renew` 和 `release` 的 where 必须同时包含 `id` 与 `activeRunId`。

- [ ] **Step 6: Run focused tests and Prisma type generation**

Run:

~~~
npx prisma generate
npx vitest run tests/unit/discussion-run-lease.test.ts
~~~

Expected: Prisma client generation succeeds and all lease tests pass.

## Task 2: 实现 DiscussionCapabilityGrant 持久化与审批 Bridge

**Files:**
- Create: `src/lib/discussion/capability-grant.ts`
- Modify: `src/lib/discussion/approval-bridge.ts`
- Create: `tests/unit/discussion-capability-grant.test.ts`
- Modify: `tests/unit/dsh-approval-bridge.test.ts`

**Interfaces:**
- `getDiscussionCapabilityGrant(discussionId: string, capability: string): Promise<"allowed" | "denied" | null>`。
- `saveDiscussionCapabilityGrant(input: { discussionId: string; capability: string; status: "allowed" | "denied"; decidedBy?: string | null }): Promise<"created" | "already-decided" | "conflict">`。
- `deleteDiscussionCapabilityGrants(discussionId: string): Promise<void>`。
- `ApprovalBridgeRequest` 保持 `approvalId/discussionId/sessionId/toolName/callId/reason`，新增 `sessionKind: "persona" | "moderator"`，由服务端校验。
- `UserApprovalOutcome` 为 `"allowed-once" | "allowed-discussion" | "rejected-discussion"`。

- [ ] **Step 1: Write failing grant persistence tests**

覆盖：缺失记录返回 null；首次 allowed/denied 创建成功；同一 Discussion/capability 的相同决定返回 already-decided；相反决定返回 conflict；删除只影响指定 Discussion。

~~~
it("uses discussionId and capability as the only grant identity", async () => {
  mocks.upsert.mockResolvedValueOnce({ status: "allowed" });
  await expect(saveDiscussionCapabilityGrant({ discussionId: "d1", capability: "web_search", status: "allowed" }))
    .resolves.toBe("created");
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { discussionId_capability: { discussionId: "d1", capability: "web_search" } },
  }));
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run:

~~~
npx vitest run tests/unit/discussion-capability-grant.test.ts
~~~

Expected: FAIL because the repository module and Prisma model are not implemented.

- [ ] **Step 3: Implement the Prisma grant repository**

`capability-grant.ts` 只允许 capability 为 `web_search`；其他 capability 抛出 `DshProtocolError`。`save` 先读取现有记录：不存在则 create；状态相同返回 `already-decided`；状态相反返回 `conflict`。数据库异常向上抛出，不静默放行。

- [ ] **Step 4: Write failing Bridge tests for discussion-wide single-flight**

替换旧的 session-scope 断言，新增以下场景：

~~~
it("merges different Persona Sessions into one Discussion approval", async () => {
  const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000, persistence: persistenceMock() });
  const first = bridge.wait({ ...request, sessionId: "persona-a", sessionKind: "persona" });
  const second = bridge.wait({ ...request, approvalId: "approval-2", sessionId: "persona-b", sessionKind: "persona" });

  expect(bridge.listPending("d1")).toHaveLength(1);
  expect(bridge.decide("d1", "approval-1", "allowed-discussion")).resolves.toBe("accepted");
  await expect(first).resolves.toBe("allowed-once");
  await expect(second).resolves.toBe("allowed-once");
  await expect(bridge.wait({ ...request, approvalId: "approval-3", sessionId: "persona-c", sessionKind: "persona" }))
    .resolves.toBe("allowed-once");
});

it("denies current and future Persona requests for the whole Discussion", async () => {
  const bridge = new DiscussionApprovalBridge({ timeoutMs: 1000, persistence: persistenceMock() });
  const first = bridge.wait({ ...request, sessionId: "persona-a", sessionKind: "persona" });
  const second = bridge.wait({ ...request, approvalId: "approval-2", sessionId: "persona-b", sessionKind: "persona" });
  await expect(bridge.decide("d1", "approval-1", "rejected-discussion")).resolves.toBe("accepted");
  await expect(first).resolves.toBe("rejected");
  await expect(second).resolves.toBe("rejected");
  await expect(bridge.wait({ ...request, approvalId: "approval-3", sessionId: "persona-c", sessionKind: "persona" }))
    .resolves.toBe("rejected");
});

it("rejects Moderator web_search even when Discussion grant is allowed", async () => {
  const bridge = new DiscussionApprovalBridge({ persistence: persistenceMock({ web_search: "allowed" }) });
  await expect(bridge.wait({ ...request, sessionKind: "moderator" })).resolves.toBe("rejected");
});
~~~

- [ ] **Step 5: Run test to verify it fails**

Run:

~~~
npx vitest run tests/unit/dsh-approval-bridge.test.ts
~~~

Expected: FAIL on missing `allowed-discussion`, `sessionKind`, persistence and discussion-wide behavior.

- [ ] **Step 6: Implement Bridge persistence and single-flight**

Bridge 增加可注入 `persistence`，生产全局实例使用 Prisma repository，测试使用内存 fake。对 `web_search` 使用 `discussionId + toolName` 作为 pending group key；group 只发布第一个请求作为 UI approval，其他请求各自持有 Promise 并在决定时一起 resolve。`allowed-discussion` 和 `rejected-discussion` 先持久化决定，成功后再释放 pending；持久化失败时所有等待者收到 `unavailable`，绝不放行。

`wait` 在创建 pending 前按以下顺序检查：

1. `sessionKind !== persona` 且 `toolName === web_search` → `rejected`；
2. 读取数据库 grant：allowed → `allowed-once`，denied → `rejected`；
3. 检查当前内存 pending group；
4. 新建 group 并发布一次 `approval-request`。

- [ ] **Step 7: Run focused tests**

Run:

~~~
npx vitest run tests/unit/discussion-capability-grant.test.ts tests/unit/dsh-approval-bridge.test.ts
~~~

Expected: all focused tests pass.

## Task 3: 更新 DSH 内部审批接口、SSE 投影和审批 UI

**Files:**
- Modify: `runtime/dsh-plugin/index.mjs`
- Modify: `src/app/api/internal/dsh/approval/route.ts`
- Modify: `src/app/api/v1/discussions/[id]/approvals/[approvalId]/route.ts`
- Modify: `src/components/discussions/dsh-approval-panel.tsx`
- Modify: `src/lib/discussion/dsh-turn-projection.ts`
- Modify: `src/hooks/use-discussion-events.ts`
- Modify: `tests/unit/dsh-approval-route.test.ts`
- Modify: `tests/unit/dsh-plugin.test.ts`
- Modify: `tests/unit/dsh-turn-projection.test.ts`

**Interfaces:**
- 内部审批 HTTP response 的 outcome 仍为 DSH 可理解的 `allowed-once | rejected | cancelled | unavailable`。
- 浏览器 POST body 只接受 `allowed-once | allowed-discussion | rejected-discussion`。
- `PendingDiscussionApproval.scope` 为可选字面量 `"discussion" | "session"`，`web_search` request 必须为 `discussion`。

- [ ] **Step 1: Write failing route/UI projection tests**

增加：

~~~
it("accepts only discussion-scoped approval outcomes from the browser", async () => {
  const response = await approvalPost(jsonRequest("http://localhost/api/v1/discussions/d1/approvals/a1", {
    outcome: "allowed-discussion",
  }), { params: Promise.resolve({ id: "d1", approvalId: "a1" }) });
  expect(response.status).toBe(200);
  expect(mocks.decide).toHaveBeenCalledWith("d1", "a1", "allowed-discussion");
});

it("rejects the old session-wide outcome", async () => {
  const response = await approvalPost(jsonRequest("http://localhost/api/v1/discussions/d1/approvals/a1", {
    outcome: "allowed-session",
  }), { params: Promise.resolve({ id: "d1", approvalId: "a1" }) });
  expect(response.status).toBe(400);
});
~~~

在 UI 测试或静态断言中确认按钮文案为“允许本次讨论”，不再出现“本次会话允许”。

- [ ] **Step 2: Run test to verify it fails**

Run:

~~~
npx vitest run tests/unit/dsh-approval-route.test.ts tests/unit/dsh-turn-projection.test.ts tests/unit/dsh-plugin.test.ts
~~~

Expected: FAIL because routes/UI/plugin response whitelist still use `allowed-session` and projection has no scope.

- [ ] **Step 3: Update the internal route and plugin response whitelist**

内部 route 继续校验 opaque `approvalId/discussionId/sessionId/toolName/callId/reason`，调用异步 `bridge.wait`。插件 response whitelist 增加/保留 `allowed-once`、`rejected`、`cancelled`、`unavailable`，不把用户层的 `allowed-discussion` 直接传给 DSH；Bridge 将 Discussion 级决定转换为当前调用的 `allowed-once`。

- [ ] **Step 4: Update browser route and UI copy**

浏览器 route 使用 `await bridge.decide`，只接受 `allowed-once`、`allowed-discussion`、`rejected-discussion`。Panel 对 `web_search` 使用“拒绝本次讨论”和“允许本次讨论”；非 web_search 不提供 Discussion 级按钮。

- [ ] **Step 5: Update projection and SSE parsing**

approval event 增加可选 `scope`，SSE 仍作为 ephemeral event 处理，不推进 durable cursor。相同 approvalId 的重复 request 继续去重；同一 Discussion 只有 Bridge 发布的 primary request 显示为一张卡片。

- [ ] **Step 6: Run focused tests**

Run:

~~~
npx vitest run tests/unit/dsh-approval-route.test.ts tests/unit/dsh-turn-projection.test.ts tests/unit/dsh-plugin.test.ts
~~~

Expected: all focused tests pass.

## Task 4: 将 DSH turn 与 Discussion runId 绑定

**Files:**
- Modify: `src/lib/discussion/run-dsh-turn.ts`
- Modify: `src/lib/discussion/orchestrator.ts`
- Modify: `tests/unit/run-dsh-turn.test.ts`
- Modify: `tests/unit/orchestrator-failure-state.test.ts`

**Interfaces:**
- `RunDiscussionDshTurnInput` 新增 `runId: string`。
- `DiscussionTurn` create data 必须写 `runId`。
- `inputSnapshot` 必须包含 `{ runId, prompt, stateVersion }`。
- `runDiscussion` 使用 `acquireDiscussionRun` 返回的 `runId`，在每轮开始和 Moderator 前调用 `renewDiscussionRun`。

- [ ] **Step 1: Write failing runId tests**

在 `run-dsh-turn.test.ts` 增加断言：create turn 的 data 包含传入 runId；run lease 检查失败时不会提交 completed turn。对于 `orchestrator-failure-state.test.ts`，mock lease acquire/renew/release 并断言 finally 一定 release 当前 runId。

~~~
it("persists the orchestrator runId on the durable turn", async () => {
  mocks.discussionTurnCreate.mockResolvedValueOnce({ id: "turn-1" });
  // existing manager fixture returns a completed event stream
  await runDiscussionDshTurn(input({ runId: "run-1" }));
  expect(mocks.discussionTurnCreate).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ runId: "run-1" }),
  }));
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run:

~~~
npx vitest run tests/unit/run-dsh-turn.test.ts tests/unit/orchestrator-failure-state.test.ts
~~~

Expected: FAIL because the input type and persisted turn data do not contain runId.

- [ ] **Step 3: Add runId validation and persistence**

`validateInput` 要求 `runId.trim()` 非空；create turn 写 `runId`；所有 `inputSnapshot` 构造点加入 runId。完成/失败更新仍按 turnId 操作，避免同一个 Session 的并发回合互相更新。

- [ ] **Step 4: Add lease ownership checks to orchestrator writes**

`runDiscussion` 开始时先 acquire；获取失败直接返回，不把已有运行标为 failed。每轮开始、每个 Persona batch 完成后和 Moderator 前 renew；renew 失败抛出稳定的内部 run lease error，外层只在仍由当前 run 持有时更新 failed。finally 只释放当前 runId。

- [ ] **Step 5: Run focused tests**

Run:

~~~
npx vitest run tests/unit/run-dsh-turn.test.ts tests/unit/orchestrator-failure-state.test.ts tests/unit/discussion-run-lease.test.ts
~~~

Expected: all focused tests pass.

## Task 5: 将 Persona 同轮执行改为有界并行

**Files:**
- Modify: `src/lib/discussion/orchestrator.ts`
- Modify: `tests/unit/orchestrator.test.ts`
- Modify: `tests/unit/orchestrator-failure-state.test.ts`

**Interfaces:**
- Create internal helper `runPersonaRound(input: { discussionId: string; runId: string; round: number; state: DiscussionState; brief: string; personaIds: string[]; stateVersion: number }): Promise<PersonaRoundResult[]>`。
- `PersonaRoundResult` 包含 `{ personaId, participantId, sessionId, status: "completed" | "failed", outputMessageId?: string, finalText?: string, errorCode?: string }`。
- Helper 内部使用 `BT_DSH_MAX_PARALLEL_PERSONAS` 有界 worker，不改变 `runDiscussion` 的公共签名。

- [ ] **Step 1: Write failing orchestrator concurrency tests**

增加测试：

~~~
it("starts all Persona turns from one state snapshot before awaiting results", async () => {
  const starts: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  mocks.runDiscussionDshTurn.mockImplementation(async ({ personaId, inputSnapshot }) => {
    starts.push(personaId!);
    if (starts.length === 3) release();
    await barrier;
    return completedResult(personaId!);
  });
  const running = runDiscussion("d1");
  await waitFor(() => expect(starts).toHaveLength(3));
  expect(new Set(mocks.runDiscussionDshTurn.mock.calls.map(([arg]) => arg.inputSnapshot.stateVersion))).toEqual(new Set([0]));
  release();
  await running;
});

it("keeps the configured Persona order while one Persona finishes later", async () => {
  // Persona C resolves first, A second, B third.
  // Moderator receives acceptedMessageIds in A, B, C order.
});

it("continues after DSH_TURN_FAILED but stops on a fatal runtime error", async () => {
  // one recoverable failure still allows Moderator; protocol error prevents it.
});
~~~

测试辅助函数 `waitFor` 和 `completedResult` 只放在测试文件，不进入生产代码；对延迟使用可控 Promise，不使用真实 sleep。

- [ ] **Step 2: Run test to verify it fails**

Run:

~~~
npx vitest run tests/unit/orchestrator.test.ts tests/unit/orchestrator-failure-state.test.ts
~~~

Expected: FAIL because current `for...of + await` remains serial and prompt still depends on mutable `roundOutputs`。

- [ ] **Step 3: Implement the bounded round executor**

将当前 Persona loop 拆为：

1. 在 round 开始固定 `stateSnapshot = state` 和 `stateVersion`；
2. 预先按 `personaIds` 建立任务描述，prompt 的 `roundOutputs` 参数传空数组；
3. 使用最多 `maxParallel` 个 worker 运行 `ensurePersonaSession` 与 `runDiscussionDshTurn`；
4. 对每个任务捕获异常并转换为 `PersonaRoundResult`；
5. `DSH_TURN_FAILED` 写入该 Persona failed 后继续；其他错误设置 batch fatal 标记，但等待已启动任务 settled；
6. 返回按 `personaIds` 排序的结果数组；
7. 从成功结果生成 `roundOutputs`、`acceptedMessageIds`，再进入 Moderator。

不在并行任务之间共享可变 `roundOutputs`。每个 `inputSnapshot` 记录相同 `stateVersion` 和 `runId`。

- [ ] **Step 4: Preserve failure semantics and cleanup**

如果没有成功结果，抛出 `DshTurnError` 且不调用 Moderator。若 batch 有 fatal，等待所有任务 settled 后抛出第一个 fatal。Discussion 被删除/归档时把结果映射为 `DISCUSSION_ARCHIVED`，不覆盖 archived 状态。

- [ ] **Step 5: Run focused tests**

Run:

~~~
npx vitest run tests/unit/orchestrator.test.ts tests/unit/orchestrator-failure-state.test.ts
~~~

Expected: all orchestrator tests pass, including deterministic message order and fatal convergence.

## Task 6: 验证 runtime 并发、删除清理和完整回归

**Files:**
- Modify: `tests/unit/discussion-session-manager.test.ts`
- Modify: `tests/unit/discussion-delete-lifecycle.test.ts`
- Modify: `tests/unit/discussion-archive-lifecycle.test.ts`
- Modify: `docs/superpowers/specs/2026-09-07-discussion-parallel-persona-approval-design.md`

- [ ] **Step 1: Add runtime multiplexing tests**

在 Session Manager 测试中让 fake process 为两个不同 Session 返回两个 Promise，确认两次 `run` 可以同时进入；同一 Session 第二次调用仍抛 `DshSessionBusyError`；notification callback 按 Session ID 分流。

- [ ] **Step 2: Add deletion/archival interaction tests**

确认删除/归档 Discussion 时：

- `closeDiscussion` 被调用；
- pending approval 全部收到 `unavailable`；
- grant 级联删除或由清理函数删除；
- active turn 不会把 Discussion 重新写成 `done`；
- runtime session 文件和 projection cache 仍按已有 hard-delete 逻辑清理。

- [ ] **Step 3: Update spec with implementation notes**

只补充实际实现中与设计不同的细节，例如 SQLite migration 名称、环境变量默认值和已知的 DSH SDK 限制；不删除“Moderator 无 web_search”的边界。

- [ ] **Step 4: Run the complete verification suite**

Run:

~~~
npm test
npx tsc --noEmit
npm run lint -- src tests
npm run build
git diff --check
~~~

Expected:

- Vitest 0 failures；
- TypeScript exit code 0；
- ESLint 0 errors；
- Next production build exit code 0；
- `git diff --check` 无输出。

- [ ] **Step 5: Review the final diff and report deployment instructions**

检查：

~~~
git status --short
git diff --stat
npx prisma migrate status
~~~

向用户说明需要执行的数据库迁移命令和环境变量：`BT_DSH_MAX_PARALLEL_PERSONAS` 可选，默认 4；`web_search` 使用 DSH 的 `deepseek-official` Provider，默认走 DSH 的搜索 endpoint；如需覆盖搜索 endpoint，使用 `DEEPSEEK_SEARCH_BASE_URL`，该变量会随 DSH Session 传入子进程。Discussion 授权只控制 Persona 是否可以调用搜索，不改变 Provider 配置。

## 本轮执行状态

- [x] Task 1–5 已编码：schema/migration、run lease、Discussion capability grant、单次讨论审批、runId 绑定和 Persona 有界并行。
- [x] Task 6 的 runtime 多 Session 分流测试、删除/清理测试和实现说明已补齐。
- [x] `npm test`、`npx tsc --noEmit`、`npm run lint -- src tests`、`npm run build`、`git diff --check` 已执行并通过；lint 保留 8 条既有 warning。
- [x] 本地 `dev.db` 已执行 `npx prisma migrate deploy`，`npx prisma migrate status` 显示 schema up to date。
- [!] `npx prisma generate` 被运行中的 Node 进程占用 Prisma Windows query-engine DLL，返回 EPERM；停止占用项目运行时后需要重新执行一次生成命令。

## 实施完成判定

只有以下条件全部满足，才可声称本功能完成：

1. 计划中的 focused tests 都经历过 RED → GREEN；
2. 同轮 Persona 真实并发，且结果顺序确定；
3. 同一 Discussion 的 web_search 只显示一张审批卡片；
4. 允许后所有 Persona Session 直接放行，拒绝后全部 Persona Session 直接拒绝；
5. Moderator 无论 grant 状态如何都无法使用 web_search；
6. 重复 Discussion run、fatal error、删除/归档和 runner close 均没有迟到写库污染；
7. 完整测试、类型检查、Lint、生产构建和 diff check 全部有本轮新输出证明。
