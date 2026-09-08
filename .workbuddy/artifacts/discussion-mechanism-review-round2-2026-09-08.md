# 讨论机制第二轮审查：1v1 与多人（2026-09-08）

审查范围：上轮 P0 修复后的现状复核 + 本轮新覆盖的 `approval-bridge.ts`（审批桥）、`capability-grant.ts`、`dsh-turn-projection.ts`（事件投影）、`stream-queue.ts`、`use-discussion-events.ts`（前端 SSE hook）、`archive.ts`（清理链路）、`stream` 路由全文、内部审批路由。
前置结论：上轮 P0-A/B/C 修复均已在位且生效（Moderator 注入真实发言、persona 注入讨论记录、启动恢复+断点续跑）。

---

## 一、上轮已报告、本轮确认仍未修的 P1（3 个）

### P1-D：followup 把 done 的多人讨论打成 running 且永不复位
`dsh-service.ts:418` 无条件 `status: "running"`；成功路径仅 `isOneOnOne` 复位（`:464`）。对已完成的多人讨论追问后，status 永久卡 running。**修复：进入前记原状态，结束时恢复。**

### P1-E：1v1 busy 拒绝后，user 消息孤儿化 → 前端永久「等待回复」
steer 路由先落 user 消息，`runOneOnOneTurn` 才检查 busy；被拒后消息无回复、participant 也不标 failed，`isOneOnOneReplyPending` 永真。**修复：busy 检查前置到落库之前。**

### P1-F：1v1 SSE 无心跳、断连后 enqueue 无防护
`oneonone-dsh.ts` 全文无 heartbeat/AbortSignal；DSH 长回合（含 web_search）期间连接空闲，中间层可能掐断；断连后 `controller.enqueue` 异常在 catch 里二次 throw。**修复：15s 心跳帧 + enqueue 统一 try/catch。**

---

## 二、本轮新发现

### N1（中）：done 之后的用户插话永远无人消费
多人讨论跑完（done）后，steer 路由仍照常落库并写入 `state.userSteers`；但轮次已尽、`resume` 端点又拒绝 done 状态 → 插话永远滞留在 state 里，还会随 state JSON 被注入后续 followup 的 prompt（语义混乱：既不是「本轮插话」也没人明确消费）。
**建议**：done 状态下 steer 返回引导（「讨论已结束，请使用追问」）；或允许但前端明示「将在追问上下文中生效」。

### N2（中）：审批等待 × 租约续约粒度，多 persona 卡审批可能拖爆 10 分钟租约
persona 回合内等待用户审批最长 2 分钟（`approval-bridge` timeoutMs 上限），期间 `runDiscussion` 不续约（续约只在轮次边界）。多人讨论中若多个 persona 同回合各自卡一次审批 + 正常生成耗时，单轮总时长可能超过 10 分钟租约 → 回合完成时 owner 检查失败 → `DiscussionRunLeaseLostError` → 该轮白跑（有 P0-C recovery 兜底重启，但用户会看到讨论莫名失败重来）。
**建议**：把 `renewDiscussionRun` 下沉到 `runDiscussionDshTurn` 的 onNotification 回调里周期性续约（事件到达即续，成本一次 updateMany）。

### N3（中）：审批超时的结果对用户不可见
用户不响应审批 → 2 分钟后 outcome=`unavailable` → 工具调用失败 → persona 回合可能 failed。但 UI 侧 pending 审批面板直接消失，用户不知道「是我不点审批导致讨论失败」。前端 hook 把 approval-decision 一律当作移除 pending 处理，不区分 outcome。
**建议**：`approval-decision` 带 outcome 透传到 UI，超时时显示「审批超时导致本轮失败」。

### N4（低中）：稳定 session 历史无界增长
- 1v1：同一 persona session 累积全部问答历史，无压缩/截断，长对话 token 成本与上下文溢出风险；
- 多人 moderator session 同理（现在额外注入 transcript 是必要成本，但 summary+transcript+state JSON 三份内容有语义重叠）。
**建议**：1v1 超过 N 轮后开新 session 并注入「此前对话摘要」；短期内至少监控 token 用量。

### N5（低）：永久性 stream-gap 会导致前端无限重连
`/stream` backlog 检测到 seq 缺口 → 前端 `needsResync` → 断开重连 → 同样缺口 → 指数退避（上限 30s）但永不恢复。当前设计下缺口不应出现（cursor 单调、事件随讨论级联删除），但物理清理/手工改库后会出现。**建议**：连续 gap 超过 N 次后停止重连并提示刷新页面。

### N6（低）：1v1 双开并发提问产生两条孤儿 user 消息
两个标签页同时 steer 同一 1v1：两条 user 消息都落库，只有第一个拿到 lease 生成回复——出现「两条用户消息一条回复」的错位对话。与 P1-E 同根，busy 前置检查一并解决。

---

## 三、本轮新覆盖模块的质量评价（优秀，保持）

- **approval-bridge**：同能力请求分组汇流（避免 N 个 persona 弹 N 个同款审批）、primary 提升机制、常量时间 token 比较、`allowed-discussion` 持久化 + P2002 竞态回读、决策记忆带上限——设计完整度超出预期。
- **capability-grant**：先查后建的竞态用唯一键 + P2002 回读收口，fail-closed。
- **/stream 路由**：先订阅后查 backlog（无丢事件窗口）、seq 连续性校验 + gap 帧、15s 心跳、审批帧去重、`change` 帧不进持久 cursor。
- **dsh-turn-projection reducer**：不可变更新、resync 语义清晰、审批事件从持久流与 ephemeral 双通道归一。
- **use-discussion-events hook**：generation 防串扰（旧连接帧绝不进新状态）、指数退避重连、审批帧不推进重放 cursor。
- **内部审批路由**：字段白名单 + 常量时间 token 校验，安全到位。

---

## 四、建议修复顺序

1. **P1-E + N6**：busy 检查前置（小改动，用户可感知收益最大）
2. **P1-D**：followup 状态恢复（几行改动）
3. **P1-F**：1v1 SSE 心跳 + enqueue 防护（十几行）
4. **N2**：续约下沉到回合内（中等，消除长回合租约风险）
5. **N1**：done 后 steer 语义（产品决策 + 小改动）
6. **N3 / N5**：审批超时透传、gap 重连上限（前端小改动）
