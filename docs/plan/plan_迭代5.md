# 迭代 5 执行计划：执行引擎与工作台（核心闭环）

*基于 TODOLIST 生成 | 运行配置沿用 02_TECH.md 推断值（端口 3001 / pnpm / localhost）*

---

## 0. 修改记录

| 版本 | 日期 | 修改类型 | 修改内容摘要 | 修改人/来源 | 状态 |
|------|------|---------|-------------|------------|------|
| 1.0.0 | 2026-09-01 | 初始创建 | 基于 TODOLIST 生成迭代 5 初始计划 | Claude | ✅ 已确认 |
| 1.0.1 | 2026-09-01 | 进度同步 | 迭代执行完成：10/10 ✅（执行记录见 exec_迭代5.md） | executing-plan | ✅ 已确认 |

---

## 1. Plan（计划）

### 1.1 迭代目标
完成核心闭环：配方执行引擎（逐步调用 LLM）、Run API（启动/进度/历史/重试/跳过）、输入驱动工作台（居中输入 + @配方 + 竖版卡片流 ≥3 列）、运行详情页与报告导出。

**验收标准：**

| ID | 验收标准 | 关联任务 |
|----|---------|---------|
| AC-01 | 工作台输入想法（@配方 引用）→ POST /runs → 逐步执行 → 生成最终报告 | T5-01~T5-03, T5-05~T5-08 |
| AC-02 | Run/RunStep 状态机正确（pending/running/done/failed/skipped），轮询可见中间结果 | T5-01, T5-03 |
| AC-03 | 步骤输出按 skill outputSchema 校验（JSON 解析 + 必需键）；失败可重试/跳过 | T5-02, T5-04 |
| AC-04 | 工作区竖版卡片网格始终 ≥3 列（宽屏 4 列），卡片显示进度/状态/摘要 | T5-06 |
| AC-05 | 最终报告 Markdown 渲染 + .md 导出 | T5-08 |

### 1.2 任务分解

| 任务 ID | 任务描述 | 类型 | 依赖 | 状态 |
| ------- | -------- | ---- | ---- | ---- |
| T5-01 | 执行引擎主循环 lib/engine/runner.ts | 后端 | - | ✅ |
| T5-02 | Prompt 组装 + 输出校验 lib/engine/prompt.ts + schemas.ts | 后端 | T5-01 | ✅ |
| T5-03 | Run API（启动/进度/历史） | 后端 | T5-01 | ✅ |
| T5-04 | 重试/跳过接口 + 中断恢复 | 后端 | T5-03 | ✅ |
| T5-05 | 工作台（居中输入 + @配方） | 前端 | T5-03 | ✅ |
| T5-06 | 工作区卡片流（竖版 ≥3 列） | 前端 | T5-03 | ✅ |
| T5-07 | 运行详情页（时间线+步骤结果） | 前端 | T5-03 | ✅ |
| T5-08 | 运行历史页 + 报告导出 | 前端 | T5-07 | ✅ |
| T5-TEST-01 | 完整闭环验证 | 模拟 | T5-08 | ✅ |
| T5-TEST-02 | 异常链路验证（失败重试/跳过/无 Key） | 模拟 | T5-04 | ✅ |

### 1.3 技术方案摘要

- 执行引擎：读 Recipe+steps（含 skill.instructions、persona.systemPrompt、outputSchema 快照）→ 逐步骤 `generateText`（system=skill 指令+人格视角，prompt=上一步输出摘要+商业想法）→ 解析 JSON 输出（outputSchema 必需键校验）→ 写 Run/RunStep → 末步综合报告
- Run 状态机：pending/running/done/failed；RunStep：pending/running/done/failed/skipped
- 异步执行：POST /runs 返回后后台推进（同 import runner 模式）；轮询 GET /runs/:id
- 无 Key / 调失败：RunStep failed + Run failed（error 可读）
- 工作台 @配方：输入解析 `@配方名` → 按名称匹配 recipe；`/?recipe=<id>` 预填
- 卡片流：CSS grid `repeat(auto-fill, minmax(220px, 1fr))` 保证 ≥3 列（宽屏 4 列）

---

## 2. Do（执行）

### 后端
- T5-01 `src/lib/engine/runner.ts`：`runRecipe(runId)` 主循环（读快照→逐步骤→更新状态）
- T5-02 `src/lib/engine/prompt.ts`（组装）、`schemas.ts`（zod 构建 + JSON 校验）
- T5-03 `src/app/api/v1/runs/route.ts`（POST 启动 / GET 历史）、`runs/[id]/route.ts`（GET 进度+步骤+报告）
- T5-04 `runs/[id]/steps/[stepIndex]/retry|skip/route.ts`

### 前端
- T5-05 `(dashboard)/page.tsx` 重写：深色 hero + 居中输入框（@ 弹配方选择器、配方标签可删、未引用配方提交弹确认）+ 开始分析
- T5-06 `components/workspace/run-cards.tsx`：竖版卡片网格（状态徽章→进度→步骤摘要→操作），轮询刷新，点击进详情
- T5-07 `(dashboard)/runs/[id]/page.tsx`：进度条 + 步骤时间线（✓/●/✗/⏸）+ 输入输出 + 重试/跳过 + 最终报告
- T5-08 `(dashboard)/runs/page.tsx`：历史筛选视图；`lib/export.ts` 生成 .md 下载

### 测试
- T5-TEST-01：编排→工作台输入→逐步执行→报告→导出 全链路（无 Key 时验证失败路径与引导）
- T5-TEST-02：失败步骤重试/跳过不阻塞；无 Key 明确提示

---

## 3. Check（检查）
- [ ] `tsc --noEmit` 无错误、`lint` 无错误
- [ ] HTTP + 浏览器验证（无 Key 路径 + 模拟执行）
- [ ] 06_TODOLIST/plan/exec 同步

---

## 4. 进度跟踪

| 任务 ID | 状态 | 任务 ID | 状态 |
| ------- | ---- | ------- | ---- |
| T5-01 | ✅ | T5-06 | ✅ |
| T5-02 | ✅ | T5-07 | ✅ |
| T5-03 | ✅ | T5-08 | ✅ |
| T5-04 | ✅ | T5-TEST-01 | ✅ |
| T5-05 | ✅ | T5-TEST-02 | ✅ |

*生成时间：2026-09-01 14:30*
