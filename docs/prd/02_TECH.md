# 技术架构设计

*基于 PRD v1.1*

---

## 1. 技术概述

### 1.1 技术目标
- 本地可运行的个人/小团队自用工具，数据完全私密，不依赖云端服务（除用户自备的 LLM API）
- 完整支撑 PRD 闭环：Skill 收录 → 人格收录 → 配方编排 → 内置 LLM 执行 → 可行性报告 → 效果反馈
- 多 LLM 服务接入可切换（DeepSeek / OpenAI / Anthropic / 本地 Ollama），用户自备 API Key
- 支持 npx 命令导入 skill（临时目录沙箱执行、SKILL.md 解析入库）
- 支持人格一对一交流（会话持久化、可导出笔记）
- 架构为未来产品化（多用户、云端部署）预留扩展空间，但不引入当前不需要的复杂度

### 1.2 架构风格
**单体全栈（Next.js App Router 一体）** —— 理由：
- 个人自用场景，单进程即可跑通全部功能，部署与运维成本最低
- 前后端同仓库、同进程，配方执行引擎可直接调用数据库与 LLM 层，避免内部服务拆分
- 未来若产品化，可先拆出独立的执行服务，再演进为多用户架构

### 1.3 关键技术决策摘要

| 领域 | 选择 | 理由 |
| --- | --- | --- |
| 前端框架 | Next.js 16.3.4 + React 19.2 | 全栈一体，App Router 统一页面与 API；Turbopack 默认 |
| 后端 | Next.js Route Handlers | 与前端同进程，个人工具无需独立后端服务 |
| 数据库 | SQLite + Prisma | 本地单文件、零运维、数据私密 |
| LLM 接入 | Vercel AI SDK | 多 provider 统一抽象，一套代码切换各家模型 |
| 数据校验 | zod | 配方步骤输入/输出的结构化 Schema 校验 |
| 部署 | pnpm dev / Docker（可选） | 本地开发为主，Docker 兜底环境一致性 |

---

## 2. 技术栈选择

### 2.1 前端

| 技术 | 版本 | 用途 | 选择理由 |
| --- | --- | --- | --- |
| Next.js | 16.3.4 | 核心框架 | App Router 全栈一体，Server Actions/Route Handlers 支撑 API；Turbopack 默认启用 |
| React | 19.2.8 | UI 框架 | Next.js 内置，生态成熟 |
| TypeScript | 5.9.x | 类型安全 | Skill/Persona/Recipe/Run 均为强结构数据，类型可减少执行层错误 |
| Tailwind CSS | 4.3.x | 样式方案 | 快速构建设计系统 token（遵循 DESIGN.md 视觉基准：单一强调色、明暗瓦片、pill 圆角体系） |
| shadcn/ui | 未引入 | UI 组件库 | 迭代 1 手写 Button/Input/Avatar/Card 遵循 DESIGN.md token（决策 D-02），后续可按需引入 |
| TanStack Query | 5.x | 服务端状态 | 运行历史、配方列表的缓存与轮询刷新（后续迭代引入） |

### 2.2 后端

| 技术 | 版本 | 用途 | 选择理由 |
| --- | --- | --- | --- |
| Next.js Route Handlers | 16.3.4 | API 层 | 与前端同进程，无需独立后端 |
| Prisma ORM | 6.19.3 | 数据库访问 | Schema 驱动、迁移管理完善，SQLite 支持好（Prisma 8 RC 为平台化 CLI，暂不用） |
| Vercel AI SDK | 7.x | LLM 调用 | 统一 provider 接口（V2+ 模型规范）；Ollama 走 OpenAI 兼容端点 |
| zod | 4.x | 数据校验 | 步骤输入/输出 Schema 校验，保证执行链路数据可传递 |

### 2.3 数据库

| 类型 | 技术 | 用途 | 选择理由 |
| --- | --- | --- | --- |
| 主数据库 | SQLite（Prisma 驱动） | 业务数据：skill、persona、recipe、run、feedback、settings、conversation、message | 本地单文件、零运维、数据私密 |
| 缓存 | 无 | — | 个人单用户场景，无需缓存层 |

### 2.4 基础设施

| 服务 | 技术 | 用途 |
| --- | --- | --- |
| 包管理 | pnpm | 依赖管理与 monorepo 预留 |
| 容器化 | Docker（可选） | 环境一致性兜底 |
| CI/CD | 无 | 个人本地工具，暂不需要 |

---

## 3. 系统架构

### 3.1 架构图

```
┌─────────────────────────────────────────────────────┐
│                    Browser                          │
│           (Skill库 / 人格库 / 配方编排 / 运行 / 设置) │
└─────────────────────────┬───────────────────────────┘
                          │ HTTP/JSON
                          ▼
┌─────────────────────────────────────────────────────┐
│               Next.js 15 (App Router)                │
│  ┌───────────┐ ┌───────────┐ ┌───────────────────┐  │
│  │ 页面层     │ │ API Routes│ │  配方执行引擎      │  │
│  │ (RSC/客户端)│ │ /api/v1/* │ │ (engine/)         │  │
│  └───────────┘ └─────┬─────┘ └─────────┬─────────┘  │
│                      │                 │            │
│                      ▼                 ▼            │
│              ┌──────────────┐  ┌─────────────────┐  │
│              │ Prisma / DB  │  │ LLM 接入层      │  │
│              │ (SQLite)     │  │ (AI SDK)        │  │
│              └──────────────┘  └────────┬────────┘  │
└─────────────────────────────────────────┼───────────┘
                                          ▼
                    ┌──────────────────────────────────┐
                    │  LLM Providers (用户自备 Key)     │
                    │  DeepSeek / OpenAI / Anthropic / │
                    │  Ollama(本地)                     │
                    └──────────────────────────────────┘
```

### 3.2 核心组件

| 组件 | 职责 | 技术实现 |
| --- | --- | --- |
| Skill 服务 | skill 的增删改查、分类/标签筛选 | Prisma |
| Persona 服务 | 人格的增删改查、视角类型筛选 | Prisma |
| Recipe 服务 | 配方增删改查、步骤结构调整、复制 | Prisma |
| 配方执行引擎 | 按步骤执行配方：组装 Prompt（注入 skill 指令 + 人格提示词）→ 调 LLM → 校验输出 → 传下一步 → 生成最终报告 | Vercel AI SDK + zod |
| Run 服务 | 运行记录、分步结果持久化、进度查询 | Prisma |
| 反馈服务 | 步骤/报告评分（1~5 星）+ 备注 | Prisma |
| 设置服务 | LLM provider 配置与 API Key 的安全存储 | 本机加密存储 |
| npx 导入执行器 | 临时目录沙箱执行 npx 命令、流式收集日志、超时控制 | child_process + 临时目录 |
| SKILL.md 解析器 | 解析 frontmatter + 指令正文，产出导入候选 | yaml + markdown 解析 |
| 人格对话服务 | 以人格 systemPrompt 为角色的多轮对话（会话内记忆） | Vercel AI SDK + Prisma |
| 会话服务 | 对话会话与消息的持久化、历史查询 | Prisma |

### 3.3 通信方式

| 场景 | 协议 | 说明 |
| --- | --- | --- |
| 前后端通信 | HTTP/REST | `/api/v1/*` Route Handlers |
| 配方执行进度 | HTTP 轮询 | 执行中步骤状态存 Run 记录，前端轮询刷新（MVP 不做长连接） |
| LLM 调用 | HTTPS | 通过 AI SDK provider 直连各家 API |

---

## 4. 目录结构

```
feasibility-lab/
├── docs/
│   └── prd/                    # PRD 及设计文档（01_PRD / 02_TECH / ...）
├── prisma/
│   ├── schema.prisma           # 数据模型定义
│   └── migrations/             # 数据库迁移
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (dashboard)/        # 主界面布局（含侧边导航）
│   │   │   ├── skills/         # Skill 库页面（列表/编辑/npx 导入）
│   │   │   ├── personas/       # 人格库页面（头像卡片/详情+交流/编辑）
│   │   │   ├── recipes/        # 配方编排页面（列表 + 编辑器）
│   │   │   ├── runs/           # 运行页面（详情/历史）
│   │   │   └── settings/       # 设置页（LLM provider / API Key）
│   │   └── api/
│   │       ├── v1/
│   │       │   ├── skills/     # skill CRUD + npx 导入任务
│   │       │   ├── personas/   # 人格 CRUD + 一对一对话
│   │       │   ├── recipes/    # 配方 CRUD
│   │       │   ├── runs/       # 启动执行 / 查询进度与结果 / 反馈评分
│   │       │   ├── conversations/ # 对话会话与消息
│   │       │   └── settings/   # 读/写设置
│   ├── components/             # 通用组件（表单、卡片、步骤编辑器、头像、聊天气泡等）
│   ├── lib/
│   │   ├── db.ts               # Prisma 客户端单例
│   │   ├── llm/
│   │   │   ├── providers.ts    # AI SDK provider 装配（多 provider 切换）
│   │   │   └── keys.ts         # API Key 安全存取
│   │   ├── engine/
│   │   │   ├── runner.ts       # 配方执行主循环
│   │   │   ├── prompt.ts       # Prompt 组装（skill 指令 + 人格提示词 + 上下文）
│   │   │   └── schemas.ts      # 各步骤输入/输出 zod Schema
│   │   ├── import/
│   │   │   ├── runner.ts       # npx 命令沙箱执行（日志流、超时）
│   │   │   └── parser.ts       # SKILL.md 解析（frontmatter + 指令）
│   │   ├── chat/
│   │   │   └── service.ts      # 人格对话与会话持久化
│   │   ├── seed/               # 内置精选 skill / 人格种子数据（含头像配置）
│   │   └── export.ts           # 报告/对话笔记导出 Markdown
│   ├── types/                  # 共享类型定义
│   └── styles/                 # 全局样式
├── .env.example                # 环境变量模板（LLM Key 等）
├── package.json
└── README.md                   # 启动与使用说明
```

---

## 5. API 设计概要

### 5.1 API 风格
RESTful，版本通过 URL 路径（`/api/v1/...`），JSON 传输。

### 5.2 认证方式
无账号体系（本地单用户工具）。LLM API Key 仅存储在本机，不随请求透传。

### 5.3 核心端点预览

| 模块 | 端点 | 说明 |
| --- | --- | --- |
| Skill | GET/POST `/api/v1/skills` | 列表（支持分类/标签筛选）/ 新增 |
| Skill | GET/PUT/DELETE `/api/v1/skills/:id` | 详情 / 编辑 / 删除 |
| Persona | GET/POST `/api/v1/personas` | 列表 / 新增 |
| Persona | GET/PUT/DELETE `/api/v1/personas/:id` | 详情 / 编辑 / 删除 |
| Recipe | GET/POST `/api/v1/recipes` | 列表 / 新增 |
| Recipe | GET/PUT/DELETE `/api/v1/recipes/:id` | 详情 / 编辑 / 删除 / 复制 |
| Run | POST `/api/v1/runs` | 启动配方执行（body：配方 + 商业想法） |
| Run | GET `/api/v1/runs/:id` | 查询进度、分步结果、最终报告 |
| Run | POST `/api/v1/runs/:id/feedback` | 步骤/报告评分 + 备注 |
| Run | GET `/api/v1/runs` | 运行历史列表 |
| Settings | GET/PUT `/api/v1/settings` | 读取 / 保存 LLM provider 与 API Key |
| Skill 导入 | POST `/api/v1/skills/import/npx` | 启动 npx 导入任务 |
| Skill 导入 | GET `/api/v1/skills/import/:jobId` | 查询导入进度与解析候选 |
| Skill 导入 | POST `/api/v1/skills/import/:jobId/confirm` | 确认解析结果入库 |
| 人格对话 | POST `/api/v1/personas/:id/chat` | 与人格多轮对话 |
| 会话 | GET `/api/v1/conversations` | 会话列表（按人格筛选） |
| 会话 | GET/DELETE `/api/v1/conversations/:id` | 会话详情（消息）/ 删除 |

> 详细请求/响应结构见 05_API.md。

---

## 6. 核心模块设计

### 6.1 配方执行引擎（engine/runner.ts）

**职责**：读取配方 → 按步骤顺序执行 → 每步注入对应 skill 指令与人格提示词调用 LLM → zod 校验结构化输出 → 上一步输出自动作为下一步输入 → 末步综合生成可行性报告 → 持久化 Run 记录。

**边界**：
- 输入：配方定义 + 用户输入的商业想法 + LLM 配置
- 输出：Run 记录（每步的输入/输出/耗时/状态 + 最终报告 + 可评分）

**核心流程**：
```
[配方 + 商业想法]
  → 步骤1: 组装Prompt(注入 skill1 指令 + persona1 提示词 + 想法)
  → LLM 调用 → zod 校验 → 步骤结果1
  → 步骤2: 组装Prompt(注入 skill2 指令 + persona2 提示词 + 步骤结果1)
  → LLM 调用 → zod 校验 → 步骤结果2
  → …（人格质询轮：同一方案被多个人格轮番质询）
  → 末步: 综合所有步骤结果 → 结构化可行性报告
  → Run 持久化（步骤快照 + 报告 + 状态机：pending/running/done/failed）
```

**依赖**：LLM 接入层、Recipe/Skill/Persona 服务、Run 服务。

**关键设计**：
- 每步支持**重试**与**跳过**（LLM 失败不阻塞整条链路）
- 步骤输出必须符合该 skill 声明的输出 Schema（zod），保证下游可消费
- 执行过程可中断恢复：Run 状态持久化到数据库，轮询接口返回当前步骤

### 6.2 LLM 接入层（lib/llm/）

**职责**：统一多 provider 装配；管理用户配置的 provider 与模型；API Key 本机安全存取；错误归一化（超时/限流/无效 Key 给出可读提示）。

**边界**：对外暴露统一的 `runLLM({ provider, model, system, user }) → { text, structured? }` 接口；执行引擎不感知具体厂商差异。

**依赖**：设置服务（Key 与模型配置）。

### 6.3 反馈与评测（Run 服务 + 反馈接口）

**职责**：用户对每个步骤与最终报告打星（1~5）并备注；评分关联到具体 skill 与配方，沉淀"哪些 skill/配方有效"的数据。

**边界**：输入为 runId + 目标（stepIndex | report）+ 星级 + 备注；输出为已保存的反馈记录。

**关键设计**：反馈数据同时落 skill 与配方两个维度（skill 效果、配方整体效果），为后续统计报表预留数据结构。

### 6.4 npx 导入模块（lib/import/）

**职责**：执行用户输入的 npx 命令 → 在受控临时目录中沙箱运行（HOME 重定向、超时限制）→ 流式收集日志 → 扫描产物 SKILL.md → 解析 frontmatter 与指令正文 → 产出导入候选，用户确认后写入 Skill 库（source=npx，记录来源命令）。

**边界**：输入为 npx 命令字符串；输出为导入任务（日志 + 候选列表）+ 入库的 Skill。

**关键设计**：命令执行前必须由用户确认；仅用户主动触发；超时默认 120 秒；解析失败给出可读错误与重试入口。

### 6.5 人格对话模块（lib/chat/）

**职责**：以人格 systemPrompt 为系统角色，提供多轮对话；会话与消息持久化（Conversation/Message），支持历史回看与导出笔记。

**边界**：输入为人格 + 用户消息（可选会话 ID）；输出为助手回复（追加消息）。

**关键设计**：会话内传递消息历史维持角色一致性；新建会话即清空上下文；导出为 Markdown 笔记（前端生成）。

---

## 7. 第三方集成

| 服务 | 用途 | 集成方式 |
| --- | --- | --- |
| DeepSeek API | 默认 LLM（国内直连，性价比高） | Vercel AI SDK - DeepSeek provider |
| OpenAI API | 备选 LLM | Vercel AI SDK - OpenAI provider |
| Anthropic API | 备选 LLM | Vercel AI SDK - Anthropic provider |
| Ollama（可选） | 本地模型，数据完全不出本机 | Vercel AI SDK - Ollama provider |

---

## 8. 安全设计

### 8.1 认证
- 无账号体系：本地单用户自用工具，不引入登录
- 未来产品化时再引入账号与认证

### 8.2 授权
- 不适用（单用户本地访问）

### 8.3 数据安全
- **API Key**：本机加密存储（系统级密钥保护或加密文件），明文不写入日志、不随前端下发
- **业务数据**：SQLite 单文件位于项目数据目录；商业想法与分析内容仅存本机
- **日志脱敏**：执行日志不记录 API Key 与完整 Prompt 内容
- **HTTPS**：本地 localhost 开发不强制；若 Docker/远程部署必须启用 HTTPS
- **环境变量**：`.env` 不入版本库，提供 `.env.example` 模板
- **npx 命令执行**：任意命令存在供应链风险——执行前展示完整命令需用户确认、临时目录沙箱隔离（HOME 重定向）、默认 120 秒超时、仅用户主动触发、日志不落盘敏感信息

---

## 9. 部署方案

### 9.1 环境配置

| 环境 | 用途 | 配置 |
| --- | --- | --- |
| development | 本地开发 | 本地 SQLite 文件 + 用户在设置页填写的 API Key |

### 9.2 端口分配

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| Next.js 开发服务器 | 3001 | 避开兄弟项目（financial / openclaw-dashboard / new-api）占用的 3000 |
| SQLite | 文件 | 无端口 |

### 9.3 部署流程

```
pnpm install
  → npx prisma migrate dev        # 初始化数据库
  → npx prisma db seed            # 写入内置精选 skill/人格
  → pnpm dev --port 3001          # 启动，浏览器访问 http://localhost:3001
```

Docker 部署（可选）：`docker compose up` 提供一致运行环境，端口映射 3001。

---

*生成时间：2026-09-01 11:45*

## 更新记录

| 日期 | 版本 | 变更内容 | 修改人 |
| ---- | ---- | -------- | ------ |
| 2026-09-01 | 1.0 | 初版创建：技术栈选型、系统架构、目录结构、端口 3001 | 沟通确认 |
| 2026-09-01 | 1.1 | 新增：npx 导入执行器与解析器、人格对话与会话服务、工作台输入驱动相关模块 | 沟通确认 |
| 2026-09-01 | 1.2 | 版本同步：Next.js 16.3.4、Prisma 6.19.3、AI SDK 7、zod 4；shadcn/ui 延后、Ollama 走 OpenAI 兼容端点（见 exec_迭代1.md 决策记录） | 迭代 1 同步 |
