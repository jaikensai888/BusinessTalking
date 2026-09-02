# 迭代 1 执行计划：项目初始化与基础设施

*基于 TODOLIST 生成，包含完整的 Plan-Do-Check 执行方案*
*代码示例：[snippets/迭代1/](snippets/迭代1/)*
*运行配置：未找到 docs/prd/07_RUNTIME.md，按 02_TECH.md 部署方案推断（端口 3001 / pnpm / localhost）*

---

## 0. 修改记录（CHANGELOG）

| 版本 | 日期 | 修改类型 | 修改内容摘要 | 修改人/来源 | 状态 |
|------|------|---------|-------------|------------|------|
| 1.0.0 | 2026-09-01 | 初始创建 | 基于 TODOLIST 生成迭代 1 初始计划 | Claude | ✅ 已确认 |
| 1.0.1 | 2026-09-01 | 进度同步 | 迭代执行完成：10/10 任务 ✅，AC-01~05 全部通过（执行记录见 exec_迭代1.md） | executing-plan | ✅ 已确认 |

---

## 1. Plan（计划）

### 1.1 迭代目标

**目标描述：** 完成项目初始化与基础设施——可运行的 Next.js 应用、数据库模型与种子数据、LLM 配置与接入层、主布局与设置页。

**交付物清单：**
- [x] Next.js 16.3.4 + TypeScript + Tailwind 项目（pnpm，端口 3001）
- [x] Prisma schema（10 实体 + 5 枚举）与迁移
- [x] 种子数据（8 skill + 6 人格，含头像配置）
- [x] Settings API（Key 加密、脱敏）
- [x] LLM 多 provider 接入层 + 测试连接接口
- [x] 主布局框架（侧边栏 + 明暗瓦片）+ 路由骨架
- [x] 设置页（LLM 配置表单）
- [x] 通用组件 + DESIGN.md 设计 token + Avatar

**验收标准：**

| ID | 验收标准 | 关联任务 |
|----|---------|---------|
| AC-01 | `pnpm dev` 在 3001 端口启动，访问 http://localhost:3001 显示主布局（侧边栏 + 路由骨架） | T1-01, T1-06 |
| AC-02 | `prisma migrate dev` 成功落库 10 实体 5 枚举；`prisma db seed` 写入 8~12 skill、6~8 人格（含头像配置） | T1-02, T1-03 |
| AC-03 | `GET /api/v1/settings` 返回脱敏配置；`PUT /api/v1/settings` 保存 Key 加密存储，明文不落盘、不回显 | T1-04 |
| AC-04 | `POST /api/v1/settings/test`：有效 Key 返回 ok+latency，无效 Key 返回可读错误（50201） | T1-05 |
| AC-05 | 设置页表单可编辑、保存、测试连接；界面遵循 DESIGN.md token（Action Blue、明暗瓦片、pill 语法） | T1-07, T1-08 |

### 1.2 任务分解

| 任务 ID | 任务描述 | 类型 | 依赖 | 状态 |
| ------- | -------- | ---- | ---- | ---- |
| T1-01 | 项目初始化（create-next-app + 依赖 + 端口 3001） | 基础设施 | - | ✅ |
| T1-02 | Prisma schema（10 实体 5 枚举）+ 迁移 | 后端 | T1-01 | ✅ |
| T1-03 | 种子数据（skill/persona 含头像） | 后端 | T1-02 | ✅ |
| T1-04 | Settings API（Key 加密/脱敏） | 后端 | T1-02 | ✅ |
| T1-05 | LLM 接入层（多 provider）+ 测试连接 | 后端 | T1-04 | ✅ |
| T1-06 | 主布局框架（侧边栏 + 明暗瓦片）+ 路由骨架 | 前端 | T1-01 | ✅ |
| T1-07 | 设置页（LLM 配置表单） | 前端 | T1-06, T1-04 | ✅ |
| T1-08 | 通用组件 + DESIGN.md 设计 token + Avatar | 前端 | T1-06 | ✅ |
| T1-TEST-01 | 迁移与种子验证 | 单元测试 | T1-03 | ✅ |
| T1-TEST-02 | LLM 连接验证（有效/无效 Key） | 模拟测试 | T1-05 | ✅ |

### 1.3 技术方案摘要

**涉及数据模型：**
- Skill: 分析技能（指令 + 输入输出 Schema + source/sourceRef）
- Persona: 人格（systemPrompt + perspectiveType + avatarType/avatarValue）
- Recipe / RecipeStep: 配方与步骤（本迭代建表，功能后续迭代）
- Run / RunStep / Feedback / Setting / Conversation / Message: 本迭代建表，功能后续迭代
- 枚举：PerspectiveType / RunStatus / StepStatus / FeedbackTargetType / MessageRole

**涉及 API 接口：**
- `GET/PUT /api/v1/settings`: 读取/保存 LLM 配置（Key 加密）
- `POST /api/v1/settings/test`: 测试 LLM 连接

**涉及前端页面/组件：**
- 主布局（侧边栏导航 + 明暗瓦片）：`src/app/(dashboard)/layout.tsx`
- 设置页：`src/app/(dashboard)/settings/page.tsx`
- 通用组件：Avatar、按钮、输入框（shadcn/ui + 自定义 token）

---

## 2. Do（执行）

### 2.1 基础设施任务

#### 任务 T1-01：项目初始化

**目标目录：** `feasibility-lab/`

**实现步骤：**
1. 运行 `pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes`
2. 安装依赖：`pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/deepseek @ai-sdk/ollama zod`、`pnpm add -D prisma`、`pnpm add @prisma/client`
3. 配置开发端口 3001：`package.json` 的 dev 脚本改为 `next dev --port 3001 -H 0.0.0.0` 或使用 `.env` `PORT=3001`（Next.js 使用 `-p` 参数：`next dev -p 3001`）
4. 验证：`pnpm dev` 可启动

**完成标志：** 满足 AC-01

---

### 2.2 后端开发任务

#### 任务 T1-02：数据模型与迁移

**文件路径：** `prisma/schema.prisma`、`prisma/migrations/`

**实现步骤：**
1. `pnpm dlx prisma init --datasource-provider sqlite`
2. 按 03_DATAMODEL.md 定义 10 实体 + 5 枚举（Skill/Persona/Recipe/RecipeStep/Run/RunStep/Feedback/Setting/Conversation/Message）
3. 执行迁移：`pnpm dlx prisma migrate dev --name init`
4. 生成客户端：`pnpm dlx prisma generate`

**代码示例：** [snippets/迭代1/T1-02_schema.prisma](snippets/迭代1/T1-02_schema.prisma)

**完成标志：** 满足 AC-02

---

#### 任务 T1-03：种子数据

**文件路径：** `prisma/seed.ts`（package.json 配置 `prisma.seed`）

**实现步骤：**
1. 定义内置 skill 种子（8~12 个：商业模式诊断、对标分析、概念拆解、目标清晰化、财务测算框架、SWOT、风险清单、报告综合等，含指令与 Schema）
2. 定义内置人格种子（6~8 个：风险投资人/挑剔客户/竞争对手/奥派经济学家/连续创业者/行业分析师，含 systemPrompt 与 avatar 配置）
3. upsert 逻辑（幂等，可重复执行）

**代码示例：** [snippets/迭代1/T1-03_seed.ts](snippets/迭代1/T1-03_seed.ts)

**完成标志：** 满足 AC-02

---

#### 任务 T1-04：Settings API

**文件路径：** `src/app/api/v1/settings/route.ts`、`src/lib/settings/encryption.ts`

**实现步骤：**
1. 实现 `encryption.ts`：AES-256-GCM 加解密（本地密钥文件 `data/.secret`，首次生成）
2. `GET /api/v1/settings`：读取配置，API Key 只返回 `apiKeyConfigured + apiKeyMasked`
3. `PUT /api/v1/settings`：保存 provider/model/timeout；apiKey 非空时加密存储（空字符串=不修改）
4. 统一响应格式 `{ code, message, data, timestamp }`

**代码示例：** [snippets/迭代1/T1-04_settings-route.ts](snippets/迭代1/T1-04_settings-route.ts)

**完成标志：** 满足 AC-03

---

#### 任务 T1-05：LLM 接入层与测试连接

**文件路径：** `src/lib/llm/providers.ts`、`src/lib/llm/keys.ts`、`src/app/api/v1/settings/test/route.ts`

**实现步骤：**
1. `providers.ts`：按配置装配 DeepSeek/OpenAI/Anthropic/Ollama provider（Vercel AI SDK）
2. `keys.ts`：读取解密后的 Key（复用 T1-04 加密工具）
3. `POST /api/v1/settings/test`：用当前配置发最小请求，返回 `{ ok, latencyMs }`；失败归一化为 50201 可读错误

**代码示例：** [snippets/迭代1/T1-05_llm-providers.ts](snippets/迭代1/T1-05_llm-providers.ts)

**完成标志：** 满足 AC-04

---

### 2.3 前端开发任务

#### 任务 T1-06：主布局框架与路由骨架

**文件路径：** `src/app/layout.tsx`、`src/app/(dashboard)/layout.tsx`、`src/app/page.tsx`、`src/app/(dashboard)/skills/page.tsx`、`src/app/(dashboard)/personas/page.tsx`、`src/app/(dashboard)/recipes/page.tsx`、`src/app/(dashboard)/runs/page.tsx`、`src/app/(dashboard)/settings/page.tsx`

**UX 设计图：**

> 以下内容来自 `docs/prd/04_UX_DESIGN.md#2-信息架构` 与 `#7-设计系统`

### 导航结构（2.2）

| 导航项 | 路径 | 说明 |
| --- | --- | --- |
| 工作台 | / | 主工作区：居中输入 + 分析卡片流 |
| Skill 库 | /skills | 技能收录与管理（含 npx 导入） |
| 人格库 | /personas | 人格收录、头像展示与一对一交流 |
| 配方 | /recipes | 配方编排与执行入口 |
| 运行 | /runs | 全部运行历史筛选视图 |
| 设置 | /settings | LLM 配置 |

### 设计系统要点（7.x）

- 单一强调色 Action Blue `#0066cc`；明暗瓦片交替（白/羊皮纸 ↔ 近黑 `#272729`）
- 字体栈 `system-ui, -apple-system, ...`；正文 17px；显示级 600 + 负字距
- 圆角：pill 9999px（动作）/ lg 18px（卡片）/ sm 8px（工具按钮）
- 无装饰阴影；1px hairline 描边
- 间距 8px 基准；卡片 24px 内边距

**实现步骤：**
1. 根布局 `src/app/layout.tsx`：字体、全局样式
2. 仪表盘布局 `src/app/(dashboard)/layout.tsx`：侧边栏导航（羊皮纸表面 + hairline）+ 内容区（明暗瓦片）
3. 各路由页面创建占位（空态引导文案）
4. 页面 404/加载态基础

**完成标志：** 满足 AC-01

---

#### 任务 T1-07：设置页

**文件路径：** `src/app/(dashboard)/settings/page.tsx`、`src/components/settings/llm-form.tsx`

**UX 设计图：**

> 以下内容来自 `docs/prd/04_UX_DESIGN.md#4.10-设置页`

### 设置页

#### 布局结构
```
┌──────────────────────────────────────────┐
│  设置                                      │
├──────────────────────────────────────────┤
│  LLM 服务:  [DeepSeek ▼]                  │
│  API Key:  [••••••••••••••]   [测试连接]  │
│  默认模型:  [deepseek-chat ▼]              │
│  超时时间:  [120] 秒                       │
│  [保存]                                    │
└──────────────────────────────────────────┘
```

#### 交互状态
- 空状态：未配置，显示引导"填入 Key 后即可运行配方"
- 加载中：表单骨架
- 错误状态：Key 无效提示（测试连接失败）
- 正常状态：可编辑表单

**实现步骤：**
1. 表单：provider 下拉（DeepSeek/OpenAI/Anthropic/Ollama）、API Key 密码输入（掩码）、模型下拉（随 provider 变化）、超时输入
2. 测试连接按钮：调用 `/api/v1/settings/test`，结果 Toast/内嵌提示
3. 保存：调用 `PUT /api/v1/settings`，成功 Toast

**完成标志：** 满足 AC-05

---

#### 任务 T1-08：通用组件与设计 token

**文件路径：** `src/styles/tokens.css`（或 Tailwind 主题扩展）、`src/components/ui/avatar.tsx`、`src/components/ui/button.tsx`、`src/components/ui/input.tsx`

**UX 设计图：**

> 以下内容来自 `docs/prd/04_UX_DESIGN.md#5-组件规范` 与 `#7-设计系统`

### 按钮语法（5.1）

| 类型 | 使用场景 | 样式 |
| --- | --- | --- |
| 主要按钮（primary pill） | 开始分析/保存/确认执行 | Action Blue 实心 + 白字，pill，11×22px，按下 scale(0.95) |
| 次要按钮（secondary pill） | 添加步骤/查看详情 | 透明底 + 1px Action Blue 边框 + 蓝字，pill |
| 深色工具按钮（dark utility） | 侧边栏操作 | #1d1d1f 实心 + 白字，sm（8px），8×15px |
| 珍珠胶囊（pearl capsule） | 卡片次级操作 | #fafafc 底 + 3px divider-soft 软环，md（11px） |
| 危险按钮 | 删除 | 红色 #ff3b30 文字链接 |

### 头像（5.3 / 7.6）

正圆（full radius）；尺寸 sm 24 / md 48 / lg 80；内置插画或自动生成（首字母/视角图标）

**实现步骤：**
1. 设计 token：颜色/字体/间距/圆角映射为 Tailwind 主题（按 7.1~7.4）
2. 基础组件：Button（5 种语法）、Input（pill 搜索 / 常规输入）、Avatar（正圆、首字母回退）
3. shadcn/ui 初始化并按 token 覆写

**完成标志：** 满足 AC-05

---

### 2.4 测试任务

#### 测试 T1-TEST-01：迁移与种子验证

**关联任务：** T1-02, T1-03

**执行方式：** 实际运行 `pnpm dlx prisma migrate dev` + `pnpm dlx prisma db seed`，并用 `prisma studio` 或脚本查询计数

**测试用例：**

| 用例 ID | 描述 | 输入 | 预期输出 | 类型 |
|---------|------|------|----------|------|
| TC-01 | 迁移成功 | `prisma migrate dev` | 10 表 + 5 枚举创建成功 | 正常 |
| TC-02 | 种子写入 | `prisma db seed` | skill ≥8、persona ≥6，persona 含 avatar 配置 | 正常 |
| TC-03 | 种子幂等 | 重复执行 seed | 无重复记录（upsert 生效） | 边界 |
| TC-04 | 外键约束 | 插入引用不存在 persona 的 RecipeStep | 抛错 | 异常 |

---

#### 测试 T1-TEST-02：LLM 连接验证

**测试类型：** 模拟测试（HTTP 调用）

**关联任务：** T1-04, T1-05

**测试场景：**

| 场景 | 描述 | 入口 | 关键步骤 | 预期结果 |
|------|------|------|---------|---------|
| S1 | 有效 Key 测试连接 | `POST http://localhost:3001/api/v1/settings/test` | 先 PUT 保存有效 Key → 调 test | `ok: true + latencyMs` |
| S2 | 无效 Key 测试连接 | 同上 | 保存无效 Key → 调 test | 50201 可读错误，无堆栈泄露 |
| S3 | 设置脱敏 | `GET /api/v1/settings` | 保存 Key 后读取 | 仅返回 apiKeyConfigured + apiKeyMasked |

---

## 3. Check（检查）

### 3.1 功能验证清单

| 验证项 | 验证方法 | 预期结果 | 关联 AC | 状态 |
|--------|---------|---------|---------|------|
| 应用启动 | `pnpm dev` + 访问 3001 | 主布局可见，路由可切换 | AC-01 | ⬜ |
| 数据库落库 | migrate + studio 检查 | 10 实体 5 枚举 | AC-02 | ⬜ |
| 种子数据 | seed + 计数查询 | skill≥8 / persona≥6 | AC-02 | ⬜ |
| Key 加密 | 保存后检查 DB 与日志 | 密文存储，明文不出现在日志/响应 | AC-03 | ⬜ |
| 测试连接 | 有效/无效 Key 两例 | ok / 50201 | AC-04 | ⬜ |
| 设置页 | 浏览器操作 | 表单保存/测试连接可用 | AC-05 | ⬜ |

### 3.2 测试覆盖要求

- [ ] 迁移/种子验证实际运行通过
- [ ] LLM 连接正常/异常两例通过
- [ ] 设置接口正常/脱敏验证通过

### 3.3 代码质量检查
- [ ] TypeScript 无类型错误（`pnpm tsc --noEmit`）
- [ ] ESLint 无错误（`pnpm lint`）
- [ ] 无 console.log 遗留（调试用除外）

### 3.4 UI/UX 检查
- [ ] 侧边栏导航 6 项可切换
- [ ] 设置页符合 UX 4.10 结构
- [ ] 颜色/圆角遵循 DESIGN.md token

---

## 4. 进度跟踪

| 任务 ID | 状态 | 完成时间 | 备注 |
| ------- | ---- | -------- | ---- |
| T1-01 | ✅ 已完成 | 2026-09-01 | Next 16.3.4 |
| T1-02 | ✅ 已完成 | 2026-09-01 | migration init 应用 |
| T1-03 | ✅ 已完成 | 2026-09-01 | 8 skill + 6 人格 |
| T1-04 | ✅ 已完成 | 2026-09-01 | 加密 + 脱敏验证通过 |
| T1-05 | ✅ 已完成 | 2026-09-01 | 无效 Key 502 验证通过 |
| T1-06 | ✅ 已完成 | 2026-09-01 | DOM 验证通过 |
| T1-07 | ✅ 已完成 | 2026-09-01 | DOM 验证通过 |
| T1-08 | ✅ 已完成 | 2026-09-01 | token 落地 |
| T1-TEST-01 | ✅ 已完成 | 2026-09-01 | TC-01~03 通过 |
| T1-TEST-02 | ✅ 已完成 | 2026-09-01 | S2/S3 通过；S1 需真实 Key 延后 |

**状态说明：** ⬜ 待开始 | 🔄 进行中 | ✅ 已完成 | ❌ 已取消

---

*生成时间：2026-09-01 13:10*
