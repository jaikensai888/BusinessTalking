# 迭代 2 执行计划：Skill 库与 npx 导入

*基于 TODOLIST 生成，包含完整的 Plan-Do-Check 执行方案*
*代码示例：[snippets/迭代2/](snippets/迭代2/)*
*运行配置：未找到 docs/prd/07_RUNTIME.md，沿用 02_TECH.md 推断值（端口 3001 / pnpm / localhost）*

---

## 0. 修改记录（CHANGELOG）

| 版本 | 日期 | 修改类型 | 修改内容摘要 | 修改人/来源 | 状态 |
|------|------|---------|-------------|------------|------|
| 1.0.0 | 2026-09-01 | 初始创建 | 基于 TODOLIST 生成迭代 2 初始计划 | Claude | ✅ 已确认 |
| 1.0.1 | 2026-09-01 | 进度同步 | 迭代执行完成：10/10 任务 ✅，AC-01~05 全部通过（执行记录见 exec_迭代2.md） | executing-plan | ✅ 已确认 |

---

## 1. Plan（计划）

### 1.1 迭代目标

**目标描述：** 完成 Skill 库的完整收录能力——CRUD API、npx 命令导入（沙箱执行 + SKILL.md 解析）、列表与编辑页面、导入弹窗与日志。

**交付物清单：**
- [ ] Skill CRUD API（搜索/分类/分页；内置不可删改；被配方引用返回 409）
- [ ] npx 导入执行器（临时目录沙箱、超时、日志落文件）
- [ ] SKILL.md 解析器（frontmatter + 指令正文 → 导入候选）
- [ ] 导入 API（启动 / 进度查询 / 确认入库）
- [ ] Skill 列表页（卡片网格 + 搜索/筛选 + 来源标记 + 评分）
- [ ] Skill 编辑页（新增/编辑表单）
- [ ] npx 导入弹窗（命令输入 + 确认 + 日志 + 勾选入库）
- [ ] 导入日志面板（流式日志、失败高亮、重试）

**验收标准：**

| ID | 验收标准 | 关联任务 |
|----|---------|---------|
| AC-01 | `GET /api/v1/skills` 支持 search/category/page/page_size，返回种子 8 条内置 skill；`DELETE` 内置 skill 返回 409；`PUT` 内置返回 409 | T2-01 |
| AC-02 | `POST /api/v1/skills` 创建成功可被列表查询到；校验失败返回 40001 | T2-01 |
| AC-03 | `POST /api/v1/skills/import/npx`：非法命令（非 npx 开头/危险符号）返回 40001；合法命令启动任务，日志文件产生内容 | T2-02, T2-03, T2-04 |
| AC-04 | `GET /api/v1/skills/import/:jobId` 返回日志与解析候选；`confirm` 后入库且 source=npx | T2-04 |
| AC-05 | Skill 列表页显示内置数据、搜索筛选生效；编辑页可新建/修改；导入弹窗可执行真实 npx 命令并展示日志与解析结果 | T2-05~T2-08 |

### 1.2 任务分解

| 任务 ID | 任务描述 | 类型 | 依赖 | 状态 |
| ------- | -------- | ---- | ---- | ---- |
| T2-01 | Skill CRUD API（列表/详情/创建/更新/删除 + 内置保护） | 后端 | - | ✅ |
| T2-02 | npx 导入执行器 lib/import/runner.ts | 后端 | - | ✅ |
| T2-03 | SKILL.md 解析器 lib/import/parser.ts | 后端 | - | ✅ |
| T2-04 | 导入 API（启动/进度/确认） | 后端 | T2-02, T2-03 | ✅ |
| T2-05 | Skill 列表页（搜索/筛选/分页/来源标记） | 前端 | T2-01 | ✅ |
| T2-06 | Skill 编辑页（新增/编辑表单） | 前端 | T2-01 | ✅ |
| T2-07 | npx 导入弹窗 | 前端 | T2-04 | ✅ |
| T2-08 | 导入日志面板组件 | 前端 | T2-04 | ✅ |
| T2-TEST-01 | Skill CRUD 流程验证 | 单元/HTTP | T2-01 | ✅ |
| T2-TEST-02 | npx 导入验证（真实命令 + 非法命令） | 模拟 | T2-04 | ✅ |

### 1.3 技术方案摘要

**涉及数据模型：** Skill（既有表，含 source/sourceRef/isBuiltin 字段）

**涉及 API 接口（05_API.md 4.1 + 4.6）：**
- `GET/POST /api/v1/skills`、`GET/PUT/DELETE /api/v1/skills/:id`
- `POST /api/v1/skills/import/npx`、`GET /api/v1/skills/import/:jobId`、`POST /api/v1/skills/import/:jobId/confirm`

**涉及前端页面/组件：**
- `src/app/(dashboard)/skills/page.tsx`（重写为客户端列表）
- `src/components/skills/skill-form.tsx`、`skill-card.tsx`、`import-dialog.tsx`、`log-panel.tsx`

**关键技术点：**
- npx 执行：**避免 stdio 管道捕获**（受限环境 EPERM）——用 shell 重定向输出到日志文件，API 轮询读取文件尾部
- 命令校验：必须以 `npx` 开头、拒绝 `|;&<>``$()` 等危险符号
- 解析：SKILL.md 的 YAML frontmatter（name/description）+ 正文 → instructions

---

## 2. Do（执行）

### 2.1 后端开发任务

#### 任务 T2-01：Skill CRUD API

**文件路径：** `src/app/api/v1/skills/route.ts`、`src/app/api/v1/skills/[id]/route.ts`

**实现步骤：**
1. `GET /api/v1/skills`：search（name/tags LIKE）、category 精确、page/page_size 分页、`_count` 计算 avgRating（后续迭代接入 Feedback 时启用，先返回 null）
2. `POST /api/v1/skills`：校验 name/instructions 必填；source 默认 manual；isBuiltin=false
3. `GET/PUT/DELETE /api/v1/skills/:id`：404 处理；内置（isBuiltin）不可改/删 → 40901；删除被 RecipeStep 引用 → 40901（Prisma Restrict 错误捕获）

**完成标志：** 满足 AC-01, AC-02

---

#### 任务 T2-02：npx 导入执行器

**文件路径：** `src/lib/import/runner.ts`

**实现步骤：**
1. 命令校验 `validateCommand()`：必须以 `npx` 开头；不含 `|;&<>` 与反引号/`$()` 
2. 任务目录：`data/imports/<jobId>/`，日志文件 `log.txt`（先清空创建）
3. 执行：`spawn(process.platform==='win32'?'cmd':'sh', [shellFlag, `${command} > log.txt 2>&1`], { cwd, stdio: 'ignore' })`——输出经 shell 重定向到文件，**不使用管道**
4. 超时：默认 120s，超时 kill 并标记 failed
5. 状态机：running → done/failed；记录 exitCode
6. 导入任务仅存内存 Map（MVP 单用户；服务重启丢失可接受，API 文档已注明）

**完成标志：** 满足 AC-03

---

#### 任务 T2-03：SKILL.md 解析器

**文件路径：** `src/lib/import/parser.ts`

**实现步骤：**
1. 递归扫描任务目录下所有 `SKILL.md`（限制深度 3，跳过 node_modules/.git）
2. 解析 YAML frontmatter（`---` 分隔）：name/description（无 frontmatter 时用文件名兜底）
3. 正文作为 `instructions`（截断 2000 字符预览）
4. 产出候选：`{ file, name, description, instructionsPreview, sourceRef }`

**完成标志：** 满足 AC-03

---

#### 任务 T2-04：导入 API

**文件路径：** `src/app/api/v1/skills/import/npx/route.ts`、`src/app/api/v1/skills/import/[jobId]/route.ts`、`src/app/api/v1/skills/import/[jobId]/confirm/route.ts`

**实现步骤：**
1. `POST .../import/npx`：校验命令 → 建任务 → 启动执行 → 返回 jobId
2. `GET .../import/:jobId`：返回状态、日志全文、解析候选
3. `POST .../import/:jobId/confirm`：selectedFiles 校验 → 入库（source=npx、sourceRef=命令）→ 返回 imported

**完成标志：** 满足 AC-04

---

### 2.2 前端开发任务

#### 任务 T2-05：Skill 列表页

**文件路径：** `src/app/(dashboard)/skills/page.tsx`（改为客户端）+ `src/components/skills/skill-card.tsx`

**UX 设计图：**

> 以下内容来自 `docs/prd/04_UX_DESIGN.md#4.2-Skill-库列表页`

### Skill 库列表页

#### 布局结构
```
┌──────────────────────────────────────────┐
│  Skill 库    [搜索] [分类▼] [+新增] [npx导入] │
├──────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌───────┐ │
│  │ 商业模式诊断 │ │ 对标分析    │ │ 概念拆解│ │
│  │ 商业模式    │ │ 战略/竞品   │ │ 思维/通用│ │
│  │ ★4.2 · 内置 │ │ ★3.8 · npx │ │ ★4.0   │ │
│  └────────────┘ └────────────┘ └───────┘ │
```

#### 交互状态
- 空状态：插画 + "Skill 库还是空的，点击右上角新增或通过 npx 导入"
- 加载中：骨架屏
- 错误状态：错误提示 + 重试
- 正常状态：卡片网格

**实现步骤：**
1. 客户端组件：搜索框（防抖）、分类下拉、卡片网格、分页
2. 卡片：名称/描述/分类/来源徽章（内置·npx·自建）/编辑/删除按钮
3. 删除需二次确认（Modal），409 时 Toast 提示原因

**完成标志：** 满足 AC-05

---

#### 任务 T2-06：Skill 编辑页

**文件路径：** `src/app/(dashboard)/skills/new/page.tsx`、`src/app/(dashboard)/skills/[id]/edit/page.tsx` + `src/components/skills/skill-form.tsx`

**UX 设计图：**

> 以下内容来自 `docs/prd/04_UX_DESIGN.md#4.3-Skill-编辑页`

### Skill 编辑页

#### 布局结构
```
┌──────────────────────────────────────────┐
│  新增 Skill                         [保存] │
├──────────────────────────────────────────┤
│  名称 [________________]  分类 [下拉▼]    │
│  描述 [____________________________]      │
│  ── 指令内容 ─────────────────────────    │
│  [ 技能指令文本框（支持 Markdown） ]       │
│  ── 输入 Schema ──  ── 输出 Schema ──     │
│  [ JSON 编辑器 ]      [ JSON 编辑器 ]      │
│  标签 [tag1, tag2]  来源 [手动新增▼]      │
└──────────────────────────────────────────┘
```

**实现步骤：**
1. 表单：名称/分类/描述/指令文本域/输入输出 Schema（JSON 文本域 + 校验）/标签（逗号分隔）
2. 新建 → POST；编辑（仅非内置）→ PUT；内置 skill 隐藏编辑入口
3. 保存成功 Toast + 返回列表

**完成标志：** 满足 AC-05

---

#### 任务 T2-07：npx 导入弹窗

**文件路径：** `src/components/skills/import-dialog.tsx`

**UX 设计图：**

> 以下内容来自 `docs/prd/04_UX_DESIGN.md#4.2.1-npx-导入弹窗`

### npx 导入弹窗

#### 布局结构
```
┌────────────────────────────────────────────┐
│  通过 npx 导入 Skill                 [关闭]  │
├────────────────────────────────────────────┤
│  命令: [ npx skills add pricing-model    ] │
│  ⚠ 将执行上方命令，请确认来源可信           │
│  [取消] [确认执行 ▶]                       │
│  ── 执行日志 ────────────────────────────  │
│  $ npx skills add pricing-model            │
│  ✓ 已安装到临时目录…                        │
│  ── 解析结果（勾选入库）──                  │
│  ☑ 定价模型分析  · 财务/定价 · 指令 320 字   │
│  [导入选中项]                              │
└────────────────────────────────────────────┘
```

**实现步骤：**
1. 命令输入 + 校验提示；"确认执行" → POST 启动任务 → 轮询 GET 进度（2s）
2. 完成后展示日志（复用 LogPanel）+ 解析候选勾选列表
3. "导入选中项" → confirm API → Toast 成功 → 刷新列表

**完成标志：** 满足 AC-05

---

#### 任务 T2-08：导入日志面板

**文件路径：** `src/components/skills/log-panel.tsx`

**实现步骤：**
1. 等宽字体渲染日志行；error/exitCode≠0 时红色高亮
2. 轮询期间自动滚动到底部；完成显示成功/失败徽章与"重试"（重新打开弹窗保留命令）

**完成标志：** 满足 AC-05

---

### 2.3 测试任务

#### 测试 T2-TEST-01：Skill CRUD 流程验证

**执行方式：** HTTP 实测（curl/Invoke-WebRequest）+ Prisma 查询

**测试用例：**

| 用例 ID | 描述 | 输入 | 预期输出 | 类型 |
|---------|------|------|----------|------|
| TC-01 | 列表返回种子 | GET /api/v1/skills | 8 条内置，含分页结构 | 正常 |
| TC-02 | 搜索过滤 | GET /skills?search=财务 | 仅财务相关 | 正常 |
| TC-03 | 分类过滤 | GET /skills?category=战略 | 分类为战略 | 正常 |
| TC-04 | 创建成功 | POST 合法数据 | code=0，可查询 | 正常 |
| TC-05 | 创建缺 name | POST 缺字段 | 40001 | 异常 |
| TC-06 | 删除内置 | DELETE 种子 skill | 40901 | 异常 |
| TC-07 | 删除自建 | DELETE 自建 skill | code=0 | 正常 |
| TC-08 | 更新内置 | PUT 种子 skill | 40901 | 异常 |

#### 测试 T2-TEST-02：npx 导入验证

**测试场景：**

| 场景 | 描述 | 入口 | 关键步骤 | 预期结果 |
|------|------|------|---------|---------|
| S1 | 非法命令 | POST /api/v1/skills/import/npx | `echo hi` | 40001 |
| S2 | 危险符号 | 同上 | `npx x; rm -rf` | 40001 |
| S3 | 真实命令 | 同上 | `npx --yes cowsay hello` | 任务 done，日志含内容 |
| S4 | 解析候选 | GET import/:jobId | 上述任务 | candidates 数组（无 SKILL.md 时为空数组） |
| S5 | 确认入库 | POST confirm | 候选勾选 | 入库 source=npx |

---

## 3. Check（检查）

### 3.1 功能验证清单

| 验证项 | 验证方法 | 预期结果 | 关联 AC | 状态 |
|--------|---------|---------|---------|------|
| CRUD 全链路 | HTTP 实测 | 列表/搜索/创建/删除符合预期 | AC-01/02 | ⬜ |
| 内置保护 | HTTP 实测 | 内置不可改/删 | AC-01 | ⬜ |
| 命令校验 | HTTP 实测 | 非法/危险命令 40001 | AC-03 | ⬜ |
| 导入执行 | 真实 npx 命令 | 任务完成、日志有内容 | AC-03 | ⬜ |
| 解析与入库 | HTTP 实测 | 候选解析、confirm 入库 | AC-04 | ⬜ |
| 页面交互 | 浏览器 DOM | 列表/编辑/导入弹窗可用 | AC-05 | ⬜ |

### 3.2 代码质量检查
- [ ] `pnpm exec tsc --noEmit` 无错误
- [ ] `pnpm lint` 无错误
- [ ] 无 console.log 遗留（调试除外）

### 3.3 UI/UX 检查
- [ ] 列表页卡片/徽章/搜索符合 UX 4.2
- [ ] 编辑页符合 UX 4.3
- [ ] 导入弹窗符合 UX 4.2.1（DESIGN.md 样式）

---

## 4. 进度跟踪

| 任务 ID | 状态 | 完成时间 | 备注 |
| ------- | ---- | -------- | ---- |
| T2-01 | ✅ 已完成 | 2026-09-01 | TC-01~08 通过 |
| T2-02 | ✅ 已完成 | 2026-09-01 | 管道捕获（P-01 修正） |
| T2-03 | ✅ 已完成 | 2026-09-01 | frontmatter 解析 |
| T2-04 | ✅ 已完成 | 2026-09-01 | S1~S5 通过 |
| T2-05 | ✅ 已完成 | 2026-09-01 | 浏览器验证 |
| T2-06 | ✅ 已完成 | 2026-09-01 | 新建/编辑 |
| T2-07 | ✅ 已完成 | 2026-09-01 | 浏览器验证 |
| T2-08 | ✅ 已完成 | 2026-09-01 | 日志面板 |
| T2-TEST-01 | ✅ 已完成 | 2026-09-01 | 8/8 |
| T2-TEST-02 | ✅ 已完成 | 2026-09-01 | 8/8 |

**状态说明：** ⬜ 待开始 | 🔄 进行中 | ✅ 已完成 | ❌ 已取消

---

*生成时间：2026-09-01 13:50*
