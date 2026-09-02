# 迭代 4 执行计划：配方编排（核心）

*基于 TODOLIST 生成 | 运行配置沿用 02_TECH.md 推断值（端口 3001 / pnpm / localhost）*

---

## 0. 修改记录

| 版本 | 日期 | 修改类型 | 修改内容摘要 | 修改人/来源 | 状态 |
|------|------|---------|-------------|------------|------|
| 1.0.0 | 2026-09-01 | 初始创建 | 基于 TODOLIST 生成迭代 4 初始计划 | Claude | ✅ 已确认 |
| 1.0.1 | 2026-09-01 | 进度同步 | 迭代执行完成：7/7 ✅（执行记录见 exec_迭代4.md） | executing-plan | ✅ 已确认 |

---

## 1. Plan（计划）

### 1.1 迭代目标
完成配方编排：Recipe CRUD（含有序步骤）、复制、引用保护，可视化步骤编辑器与运行入口。

**验收标准：**

| ID | 验收标准 | 关联任务 |
|----|---------|---------|
| AC-01 | 配方创建/详情/更新/删除/复制可用，步骤顺序保持 | T4-01, T4-02 |
| AC-02 | 删除被引用 skill 返回 409；配方步骤引用不存在的 skill/persona 校验 40001 | T4-02 |
| AC-03 | 配方编辑器可增删步骤、调整顺序、选择 skill/人格（带头像）、预览输入输出 | T4-04 |
| AC-04 | 编辑器"运行"保存并跳转工作台（`/?recipe=<id>` 预填 @配方） | T4-05 |

### 1.2 任务分解

| 任务 ID | 任务描述 | 类型 | 依赖 | 状态 |
| ------- | -------- | ---- | ---- | ---- |
| T4-01 | Recipe CRUD API（含步骤事务） | 后端 | - | ✅ |
| T4-02 | 复制 API + 引用保护 | 后端 | T4-01 | ✅ |
| T4-03 | 配方列表页 | 前端 | T4-01 | ✅ |
| T4-04 | 配方编辑器（核心） | 前端 | T4-01 | ✅ |
| T4-05 | 运行入口（跳转工作台预填） | 前端 | T4-04 | ✅ |
| T4-TEST-01 | 配方流程验证 | 单元/HTTP | T4-02 | ✅ |
| T4-TEST-02 | 引用保护验证 | 单元/HTTP | T4-02 | ✅ |

### 1.3 技术方案摘要

- 数据模型：Recipe/RecipeStep（既有表；RecipeStep 唯一 (recipeId, position)）
- API（05_API 4.3）：recipes CRUD、`POST /recipes/:id/duplicate`
- 步骤保存：事务内先删后建（position 重排），校验 skillId 存在、personaId 可选
- 列表字段：stepCount、runCount（Run 按 recipeId 计数）、avgRating（暂 null）
- 运行入口：保存成功后 `router.push("/?recipe=" + id)`（迭代 5 工作台读取）

---

## 2. Do（执行）

### 后端
- T4-01 `src/app/api/v1/recipes/route.ts` + `[id]/route.ts`：POST 创建（含 steps）、GET 列表、GET 详情（steps 带 skill/persona 名称）、PUT 全量替换（`$transaction`）、DELETE
- T4-02 `src/app/api/v1/recipes/[id]/duplicate/route.ts`：复制配方+步骤（名称加"（副本）"）

### 前端
- T4-03 `(dashboard)/recipes/page.tsx` 客户端：列表（步骤数/运行次数/更新时间）+ 新建/复制/删除
- T4-04 `(dashboard)/recipes/[id]/edit/page.tsx` + `components/recipes/recipe-editor.tsx`：名称/描述 + 步骤卡片（skill 选择器含输出摘要、persona 选择器带头像可空、↑↓ 排序、删除确认、添加步骤）+ 保存
- T4-05 编辑器"运行"按钮：保存后 `router.push("/?recipe=" + id)`

### 测试
- T4-TEST-01：创建（含步骤）→ 详情 → 更新 → 复制 → 删除全流程（9 用例）
- T4-TEST-02：删除被引用 skill → 409；步骤引用不存在 skill → 40001（3 用例）

---

## 3. Check（检查）
- [ ] `tsc --noEmit` 无错误、`lint` 无错误
- [ ] HTTP 测试通过、浏览器验证编辑器交互
- [ ] 06_TODOLIST/plan/exec 同步

---

## 4. 进度跟踪

| 任务 ID | 状态 | 任务 ID | 状态 |
| ------- | ---- | ------- | ---- |
| T4-01 | ✅ | T4-05 | ✅ |
| T4-02 | ✅ | T4-TEST-01 | ✅ |
| T4-03 | ✅ | T4-TEST-02 | ✅ |
| T4-04 | ✅ | | |

*生成时间：2026-09-01 14:30*
