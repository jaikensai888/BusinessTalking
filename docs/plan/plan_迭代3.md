# 迭代 3 执行计划：人格库与人格交流

*基于 TODOLIST 生成 | 运行配置沿用 02_TECH.md 推断值（端口 3001 / pnpm / localhost）*

---

## 0. 修改记录

| 版本 | 日期 | 修改类型 | 修改内容摘要 | 修改人/来源 | 状态 |
|------|------|---------|-------------|------------|------|
| 1.0.0 | 2026-09-01 | 初始创建 | 基于 TODOLIST 生成迭代 3 初始计划 | Claude | ✅ 已确认 |
| 1.0.1 | 2026-09-01 | 进度同步 | 迭代执行完成：10/10 ✅（执行记录见 exec_迭代3.md） | executing-plan | ✅ 已确认 |

---

## 1. Plan（计划）

### 1.1 迭代目标
完成人格库：Persona CRUD、头像卡片展示、与人格一对一多轮对话（会话持久化、可导出笔记）。

**验收标准：**

| ID | 验收标准 | 关联任务 |
|----|---------|---------|
| AC-01 | personas CRUD 可用；内置人格不可改/删（409）；列表支持视角筛选 | T3-01 |
| AC-02 | `POST /personas/:id/chat` 多轮保持角色（systemPrompt），无 Key 返回 50201 可读错误 | T3-02 |
| AC-03 | 会话可保存/回看/删除（conversations API） | T3-03 |
| AC-04 | 人格列表页头像卡片、视角筛选、详情/交流双 Tab 可用 | T3-04~T3-08 |
| AC-05 | 对话可导出 Markdown 笔记 | T3-06 |

### 1.2 任务分解

| 任务 ID | 任务描述 | 类型 | 依赖 | 状态 |
| ------- | -------- | ---- | ---- | ---- |
| T3-01 | Persona CRUD API | 后端 | - | ✅ |
| T3-02 | 人格对话 API（chat，多轮） | 后端 | T3-01 | ✅ |
| T3-03 | 会话 API（list/detail/delete） | 后端 | T3-02 | ✅ |
| T3-04 | Persona 列表页（头像卡片） | 前端 | T3-01 | ✅ |
| T3-05 | 人格详情/交流页（双 Tab） | 前端 | T3-02 | ✅ |
| T3-06 | 对话组件（气泡/会话列表/导出笔记） | 前端 | T3-03 | ✅ |
| T3-07 | Persona 编辑页 | 前端 | T3-01 | ✅ |
| T3-08 | 头像生成组件 | 前端 | - | ✅ |
| T3-TEST-01 | Persona 流程验证 | 单元/HTTP | T3-01 | ✅ |
| T3-TEST-02 | 对话验证 | 模拟 | T3-02 | ✅ |

### 1.3 技术方案摘要

- 数据模型：Persona/Conversation/Message（既有表）
- API（05_API 4.2/4.7）：personas CRUD、`POST /personas/:id/chat`、`GET/DELETE /conversations`、`GET/DELETE /conversations/:id`
- 对话实现：systemPrompt 作系统角色 + 会话历史 → `generateText`（复用 lib/llm/buildModel）；无 Key → 50201
- 头像：复用 Avatar 组件（首字母+色板自动生成）；内置插画素材延后（决策 D-01）
- 导出：前端生成 .md 下载

---

## 2. Do（执行）

### 后端
- T3-01 `src/app/api/v1/personas/route.ts` + `[id]/route.ts`：GET 列表（search/perspectiveType/page）、POST、GET/PUT/DELETE（isBuiltin → 40901）
- T3-02 `src/app/api/v1/personas/[id]/chat/route.ts`：body {message, conversationId?}；读 persona.systemPrompt；加载历史消息；generateText；追加 user/assistant Message；标题自动生成
- T3-03 `src/app/api/v1/conversations/route.ts` + `[id]/route.ts`：列表（personaId 筛选、messageCount）、详情（消息正序）、删除

### 前端
- T3-04 `(dashboard)/personas/page.tsx` 重写为客户端：头像卡片网格 + 视角筛选 + 新增按钮
- T3-05 `(dashboard)/personas/[id]/page.tsx`：头部（大头像/名称/视角/编辑）+ 详情/交流 Tab
- T3-06 `components/personas/chat-panel.tsx`：气泡（用户右、人格左带头像）、输入发送、会话列表切换、新建会话、导出笔记（.md）
- T3-07 `components/personas/persona-form.tsx` + `personas/new` + `personas/[id]/edit`
- T3-08 复用 `components/ui/avatar.tsx`（首字母+色板；含 builtin 视角图标占位）

### 测试
- T3-TEST-01：CRUD 8 用例（列表/筛选/创建/内置保护）
- T3-TEST-02：chat 无 Key → 50201；有 Key 时保存会话与消息、历史回看（Key 缺失场景用模拟验证）

---

## 3. Check（检查）
- [ ] `tsc --noEmit` 无错误、`lint` 无错误
- [ ] HTTP 测试通过、浏览器 DOM 验证列表/详情/交流页
- [ ] 06_TODOLIST/plan/exec 同步

---

## 4. 进度跟踪

| 任务 ID | 状态 | 任务 ID | 状态 |
| ------- | ---- | ------- | ---- |
| T3-01 | ✅ | T3-06 | ✅ |
| T3-02 | ✅ | T3-07 | ✅ |
| T3-03 | ✅ | T3-08 | ✅ |
| T3-04 | ✅ | T3-TEST-01 | ✅ |
| T3-05 | ✅ | T3-TEST-02 | ✅ |

*生成时间：2026-09-01 14:30*
