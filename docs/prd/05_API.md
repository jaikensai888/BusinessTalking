# API 接口规范文档

*基于 PRD v1.1 和技术方案 v1.1*

---

## 1. API 概述

### 1.1 设计原则
- RESTful 风格，资源名使用名词复数
- HTTP 方法语义明确：GET 查询 / POST 创建或动作 / PUT 全量更新 / DELETE 删除
- 统一响应格式与错误码，前端可直接对接

### 1.2 Base URL
- 开发环境：`http://localhost:3001/api/v1`

### 1.3 版本管理
URL 路径版本：`/api/v1/...`

---

## 2. 认证与授权

### 2.1 认证方式
无账号体系（本地单用户自用工具），**所有接口均不需要认证**。

### 2.2 敏感信息
LLM API Key 仅存储在本机（加密），通过设置接口写入，不随业务请求透传。

### 2.3 权限模型
不适用（单用户本地访问）。

---

## 3. 通用规范

### 3.1 请求格式
- Content-Type: `application/json`
- 字符编码: `UTF-8`

### 3.2 响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": { },
  "timestamp": "2026-09-01T12:00:00+08:00"
}
```

### 3.3 错误码

| 错误码 | HTTP 状态码 | 说明 |
| --- | --- | --- |
| 0 | 200 | 成功 |
| 40001 | 400 | 请求参数错误/校验失败 |
| 40401 | 404 | 资源不存在 |
| 40901 | 409 | 资源冲突（如删除被配方引用的 skill） |
| 42201 | 422 | LLM 输出未通过步骤 Schema 校验 |
| 50001 | 500 | 服务器内部错误 |
| 50002 | 500 | npx 命令执行失败（详情见导入任务日志） |
| 50201 | 502 | LLM 调用失败（Key 无效/限流/网络错误） |
| 50401 | 504 | 执行超时 |

### 3.4 分页规范

**请求参数**（列表接口通用）

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| page | int | 1 | 页码 |
| page_size | int | 20 | 每页数量（最大 100） |

**响应格式**

```json
{
  "data": [ ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

---

## 4. API 端点

### 4.1 Skill 模块

#### [GET] /api/v1/skills

**描述**：获取 skill 列表，支持搜索与筛选
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| search | query | string | 否 | 名称/标签模糊搜索 |
| category | query | string | 否 | 按分类筛选 |
| page | query | int | 否 | 页码，默认 1 |
| page_size | query | int | 否 | 每页数量，默认 20 |

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": "clyxsk1",
      "name": "商业模式诊断",
      "description": "用本体论框架拆解商业模式",
      "category": "商业模式",
      "source": "builtin",
      "isBuiltin": true,
      "version": "1.0",
      "avgRating": 4.2,
      "tags": ["dbs", "诊断"]
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 10, "total_pages": 1 }
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | category 不在允许范围 |

---

#### [POST] /api/v1/skills

**描述**：新增 skill
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| name | body | string | 是 | 技能名称，1~100 字符 |
| description | body | string | 否 | 技能说明 |
| category | body | string | 否 | 分类，默认"通用" |
| instructions | body | string | 是 | 技能指令全文（注入 LLM） |
| inputSchema | body | object | 否 | 输入 Schema（JSON） |
| outputSchema | body | object | 否 | 输出 Schema（JSON） |
| tags | body | string[] | 否 | 标签数组 |

**请求示例**

```json
{
  "name": "财务测算框架",
  "description": "对商业模式做基础财务可行性测算",
  "category": "财务",
  "instructions": "你是财务分析师…（完整指令）",
  "inputSchema": { "type": "object", "properties": { "revenueModel": { "type": "string" } } },
  "outputSchema": { "type": "object", "properties": { "breakEven": { "type": "number" } } },
  "tags": ["财务", "测算"]
}
```

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "clyxsk2",
    "name": "财务测算框架",
    "category": "财务",
    "isBuiltin": false,
    "createdAt": "2026-09-01T12:00:00+08:00"
  }
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | name/instructions 缺失或长度不合法 |

---

#### [GET] /api/v1/skills/:id

**描述**：获取 skill 详情（含完整指令与 Schema）
**认证**：不需要

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "clyxsk1",
    "name": "商业模式诊断",
    "description": "…",
    "category": "商业模式",
    "instructions": "（完整指令全文）",
    "inputSchema": {},
    "outputSchema": {},
    "source": "builtin",
    "tags": [],
    "isBuiltin": true,
    "version": "1.0",
    "createdAt": "2026-09-01T10:00:00+08:00",
    "updatedAt": "2026-09-01T10:00:00+08:00"
  }
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | skill 不存在 |

---

#### [PUT] /api/v1/skills/:id

**描述**：更新 skill（全量更新）
**认证**：不需要

**请求参数**：同 POST /api/v1/skills（name、instructions 必填）

**响应示例**

```json
{ "code": 0, "message": "success", "data": { "id": "clyxsk1", "updatedAt": "2026-09-01T12:10:00+08:00" } }
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | 参数校验失败 |
| 40401 | skill 不存在 |
| 40901 | 内置 skill 不可修改 |

---

#### [DELETE] /api/v1/skills/:id

**描述**：删除 skill
**认证**：不需要

**响应示例**

```json
{ "code": 0, "message": "success", "data": null }
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | skill 不存在 |
| 40901 | 内置 skill 不可删除 |
| 40901 | 该 skill 正被配方步骤引用，请先解除引用 |

---

### 4.2 Persona 模块

#### [GET] /api/v1/personas

**描述**：获取人格列表，支持按视角类型筛选
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| search | query | string | 否 | 名称模糊搜索 |
| perspectiveType | query | string | 否 | 视角类型筛选 |
| page | query | int | 否 | 页码，默认 1 |
| page_size | query | int | 否 | 每页数量，默认 20 |

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": "clyxsp1",
      "name": "风险投资人",
      "description": "以早期投资人视角审视商业模式与增长潜力",
      "perspectiveType": "investor",
      "avatarType": "builtin",
      "avatarValue": "investor",
      "isBuiltin": true,
      "avgRating": 4.5
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 7, "total_pages": 1 }
}
```

---

#### [POST] /api/v1/personas

**描述**：新增人格
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| name | body | string | 是 | 人格名称，1~100 字符 |
| description | body | string | 否 | 人格简介 |
| systemPrompt | body | string | 是 | 人格系统提示词（蒸馏产物） |
| perspectiveType | body | string | 是 | 视角类型枚举：investor/customer/competitor/economist/entrepreneur/analyst/custom |
| avatarType | body | string | 否 | 头像类型：builtin（内置插画）/ auto（自动生成），默认 auto |
| avatarValue | body | string | 否 | 头像内容：内置插画 key 或自动生成参数 |
| tags | body | string[] | 否 | 标签数组 |

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | 参数缺失或 perspectiveType 不在枚举范围 |

---

#### [GET] /api/v1/personas/:id

**描述**：获取人格详情
**认证**：不需要

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | 人格不存在 |

---

#### [PUT] /api/v1/personas/:id

**描述**：更新人格
**认证**：不需要

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | 参数校验失败 |
| 40401 | 人格不存在 |
| 40901 | 内置人格不可修改 |

---

#### [DELETE] /api/v1/personas/:id

**描述**：删除人格（被配方步骤引用时自动解除引用）
**认证**：不需要

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | 人格不存在 |
| 40901 | 内置人格不可删除 |

---

### 4.3 Recipe 模块

#### [GET] /api/v1/recipes

**描述**：获取配方列表
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| search | query | string | 否 | 名称模糊搜索 |
| page | query | int | 否 | 页码，默认 1 |
| page_size | query | int | 否 | 每页数量，默认 20 |

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": "clyxr1",
      "name": "新项目可行性分析",
      "description": "标准五步可行性分析流程",
      "version": "1.0",
      "stepCount": 5,
      "runCount": 12,
      "avgRating": 4.2,
      "updatedAt": "2026-09-01T11:00:00+08:00"
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 3, "total_pages": 1 }
}
```

---

#### [POST] /api/v1/recipes

**描述**：创建配方（可同时提交初始步骤）
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| name | body | string | 是 | 配方名称，1~100 字符 |
| description | body | string | 否 | 配方说明 |
| steps | body | array | 否 | 初始步骤数组（见下） |

**steps 元素结构**

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| skillId | string | 是 | 引用的 skill ID |
| personaId | string | 否 | 附加人格 ID（null 表示无） |
| inputMapping | object | 否 | 输入映射（默认：上一步输出全文） |

**请求示例**

```json
{
  "name": "新项目可行性分析",
  "description": "标准五步可行性分析流程",
  "steps": [
    { "skillId": "clyxsk3" },
    { "skillId": "clyxsk1", "personaId": "clyxsp1" },
    { "skillId": "clyxsk4", "personaId": "clyxsp2" }
  ]
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | name 缺失或 steps 中存在不存在的 skillId/personaId |

---

#### [GET] /api/v1/recipes/:id

**描述**：获取配方详情（含完整步骤列表）
**认证**：不需要

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "clyxr1",
    "name": "新项目可行性分析",
    "description": "…",
    "version": "1.0",
    "steps": [
      {
        "id": "clyxrs1",
        "position": 1,
        "skill": { "id": "clyxsk3", "name": "目标清晰化", "category": "通用", "outputSchema": {} },
        "persona": null,
        "inputMapping": null
      },
      {
        "id": "clyxrs2",
        "position": 2,
        "skill": { "id": "clyxsk1", "name": "商业模式诊断", "category": "商业模式", "outputSchema": {} },
        "persona": { "id": "clyxsp1", "name": "风险投资人", "perspectiveType": "investor" },
        "inputMapping": null
      }
    ]
  }
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | 配方不存在 |

---

#### [PUT] /api/v1/recipes/:id

**描述**：更新配方（名称/描述/步骤全量替换，保存后版本号递增）
**认证**：不需要

**请求参数**：同 POST /api/v1/recipes

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | 参数校验失败（如 steps 为空数组时需确认） |
| 40401 | 配方不存在 |

---

#### [DELETE] /api/v1/recipes/:id

**描述**：删除配方（历史运行记录保留，靠快照）
**认证**：不需要

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | 配方不存在 |

---

#### [POST] /api/v1/recipes/:id/duplicate

**描述**：复制配方（生成新配方，名称加"（副本）"）
**认证**：不需要

**响应示例**

```json
{ "code": 0, "message": "success", "data": { "id": "clyxr9", "name": "新项目可行性分析（副本）" } }
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | 配方不存在 |

---

### 4.4 Run 模块

#### [POST] /api/v1/runs

**描述**：启动配方执行（异步执行，立即返回 runId 与初始状态；执行引擎按步骤推进，前端轮询进度）
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| recipeId | body | string | 是 | 要执行的配方 ID |
| ideaInput | body | string | 是 | 商业想法描述，1~10000 字符 |

**请求示例**

```json
{
  "recipeId": "clyxr1",
  "ideaInput": "做一个面向独立开发者的 AI 定价分析工具，订阅制，月费 49 元…"
}
```

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "clyxrun1",
    "recipeId": "clyxr1",
    "status": "pending",
    "currentStep": 0,
    "totalSteps": 5,
    "provider": "deepseek",
    "model": "deepseek-chat",
    "createdAt": "2026-09-01T12:00:00+08:00"
  }
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | recipeId/ideaInput 缺失 |
| 40401 | 配方不存在或配方无步骤 |
| 50201 | LLM 未配置（无有效 API Key） |

---

#### [GET] /api/v1/runs/:id

**描述**：查询运行进度、分步结果与最终报告（前端轮询此接口）
**认证**：不需要

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "clyxrun1",
    "recipeId": "clyxr1",
    "recipeName": "新项目可行性分析",
    "ideaInput": "做一个面向独立开发者的 AI 定价分析工具…",
    "status": "running",
    "currentStep": 2,
    "provider": "deepseek",
    "model": "deepseek-chat",
    "finalReport": null,
    "steps": [
      {
        "stepIndex": 1,
        "skillName": "目标清晰化",
        "personaName": null,
        "status": "done",
        "durationMs": 8200,
        "input": { "idea": "…" },
        "output": { "goalStatement": "…" },
        "error": null
      },
      {
        "stepIndex": 2,
        "skillName": "商业模式诊断",
        "personaName": "风险投资人",
        "status": "running",
        "durationMs": null,
        "input": { "previousOutput": "…" },
        "output": null,
        "error": null
      }
    ],
    "startedAt": "2026-09-01T12:00:01+08:00",
    "completedAt": null
  }
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | 运行不存在 |

---

#### [GET] /api/v1/runs

**描述**：运行历史列表
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| recipeId | query | string | 否 | 按配方筛选 |
| status | query | string | 否 | 按状态筛选（pending/running/done/failed/cancelled） |
| page | query | int | 否 | 页码，默认 1 |
| page_size | query | int | 否 | 每页数量，默认 20 |

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": "clyxrun1",
      "recipeName": "新项目可行性分析",
      "status": "done",
      "currentStep": 5,
      "totalSteps": 5,
      "rating": 4,
      "createdAt": "2026-09-01T12:00:00+08:00"
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 12, "total_pages": 1 }
}
```

---

#### [POST] /api/v1/runs/:id/steps/:stepIndex/retry

**描述**：重试失败的步骤（从该步骤重新执行，后续步骤重置）
**认证**：不需要

**响应示例**

```json
{ "code": 0, "message": "success", "data": { "id": "clyxrun1", "status": "running", "currentStep": 3 } }
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | 该步骤状态不是 failed，不可重试 |
| 40401 | 运行或步骤不存在 |

---

#### [POST] /api/v1/runs/:id/steps/:stepIndex/skip

**描述**：跳过失败的步骤（标记 skipped，继续后续步骤）
**认证**：不需要

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | 该步骤状态不是 failed，不可跳过 |
| 40401 | 运行或步骤不存在 |

---

#### [POST] /api/v1/runs/:id/feedback

**描述**：提交效果反馈（对步骤或最终报告评分；同一目标重复提交覆盖旧记录）
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| targetType | body | string | 是 | step / report |
| stepIndex | body | int | 否 | targetType=step 时必填 |
| rating | body | int | 是 | 1~5 星 |
| note | body | string | 否 | 备注，最长 500 字符 |

**请求示例**

```json
{
  "targetType": "step",
  "stepIndex": 2,
  "rating": 5,
  "note": "投资视角质询非常犀利，直接点出了单位经济模型的问题"
}
```

**响应示例**

```json
{ "code": 0, "message": "success", "data": { "id": "clyxfb1", "rating": 5 } }
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | rating 不在 1~5 范围 / targetType=step 时缺 stepIndex |
| 40401 | 运行不存在 |

---

### 4.5 Settings 模块

#### [GET] /api/v1/settings

**描述**：获取配置（API Key 脱敏返回：仅返回掩码与是否已配置）
**认证**：不需要

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "llm": {
      "provider": "deepseek",
      "apiKeyConfigured": true,
      "apiKeyMasked": "sk-***abc",
      "model": "deepseek-chat",
      "timeoutSeconds": 120
    }
  }
}
```

---

#### [PUT] /api/v1/settings

**描述**：保存配置（API Key 为空字符串表示不修改）
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| provider | body | string | 否 | deepseek/openai/anthropic/ollama |
| apiKey | body | string | 否 | 新 Key（空字符串=不修改） |
| model | body | string | 否 | 默认模型 |
| timeoutSeconds | body | int | 否 | 超时秒数，30~600 |

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | provider 不在枚举范围 / timeoutSeconds 越界 |

---

#### [POST] /api/v1/settings/test

**描述**：测试 LLM 连接（用当前配置发一次最小请求）
**认证**：不需要

**响应示例**

```json
{ "code": 0, "message": "success", "data": { "ok": true, "latencyMs": 850 } }
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 50201 | Key 无效或服务不可达（返回具体原因） |

---

### 4.6 Skill 导入模块（npx）

#### [POST] /api/v1/skills/import/npx

**描述**：启动 npx 导入任务（异步执行，返回 jobId；执行日志与解析候选通过进度接口获取）
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| command | body | string | 是 | 完整的 npx 命令，如 `npx skills add pricing-model`；1~500 字符 |

**请求示例**

```json
{ "command": "npx skills add pricing-model" }
```

**响应示例**

```json
{ "code": 0, "message": "success", "data": { "jobId": "clyximp1", "status": "running", "command": "npx skills add pricing-model" } }
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | command 缺失或非法（非 npx 开头、包含危险 shell 符号） |

---

#### [GET] /api/v1/skills/import/:jobId

**描述**：查询导入任务进度、执行日志与解析候选
**认证**：不需要

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "jobId": "clyximp1",
    "status": "done",
    "command": "npx skills add pricing-model",
    "logs": [
      { "at": "2026-09-01T12:30:01+08:00", "line": "$ npx skills add pricing-model" },
      { "at": "2026-09-01T12:30:20+08:00", "line": "✓ 已安装到临时目录" }
    ],
    "candidates": [
      { "file": "pricing-model/SKILL.md", "name": "定价模型分析", "description": "…", "instructions": "（前 320 字）", "sourceRef": "npx skills add pricing-model" }
    ]
  }
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | 导入任务不存在 |
| 50002 | 命令执行失败（logs 含错误详情） |

---

#### [POST] /api/v1/skills/import/:jobId/confirm

**描述**：确认解析候选入库（勾选的候选项写入 Skill 库，source=npx）
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| selectedFiles | body | string[] | 是 | 要入库的候选文件路径数组（来自解析结果） |

**请求示例**

```json
{ "selectedFiles": ["pricing-model/SKILL.md"] }
```

**响应示例**

```json
{ "code": 0, "message": "success", "data": { "imported": [{ "id": "clyxsk9", "name": "定价模型分析", "source": "npx" }] } }
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | selectedFiles 为空或含未知文件 |
| 40401 | 导入任务不存在或未完成 |

---

### 4.7 人格对话与会话模块

#### [POST] /api/v1/personas/:id/chat

**描述**：与人格多轮对话。携带 conversationId 延续会话；不携带则新建会话（会话内保持人格角色设定与历史记忆）
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| message | body | string | 是 | 用户消息，1~5000 字符 |
| conversationId | body | string | 否 | 延续的会话 ID（缺省新建会话） |

**请求示例**

```json
{ "message": "这个 AI 定价工具能做吗？", "conversationId": "clyxcv1" }
```

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "conversationId": "clyxcv1",
    "reply": "先别谈功能，你的单位经济模型是什么？…",
    "messages": [
      { "role": "user", "content": "这个 AI 定价工具能做吗？" },
      { "role": "assistant", "content": "先别谈功能…" }
    ]
  }
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40001 | message 缺失 |
| 40401 | 人格不存在 / conversationId 不属于该人格 |
| 50201 | LLM 调用失败 |

---

#### [GET] /api/v1/conversations

**描述**：会话列表，可按人格筛选
**认证**：不需要

**请求参数**

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| personaId | query | string | 否 | 按人格筛选 |
| page | query | int | 否 | 页码，默认 1 |
| page_size | query | int | 否 | 每页数量，默认 20 |

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    { "id": "clyxcv1", "personaId": "clyxsp1", "personaName": "风险投资人", "title": "AI 定价工具的可行性", "messageCount": 8, "updatedAt": "2026-09-01T12:40:00+08:00" }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 3, "total_pages": 1 }
}
```

---

#### [GET] /api/v1/conversations/:id

**描述**：获取会话全部消息（按时间正序）
**认证**：不需要

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "clyxcv1",
    "personaId": "clyxsp1",
    "personaName": "风险投资人",
    "messages": [
      { "role": "user", "content": "这个 AI 定价工具能做吗？", "createdAt": "2026-09-01T12:35:00+08:00" },
      { "role": "assistant", "content": "先别谈功能…", "createdAt": "2026-09-01T12:35:05+08:00" }
    ]
  }
}
```

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | 会话不存在 |

---

#### [DELETE] /api/v1/conversations/:id

**描述**：删除会话（连同消息）
**认证**：不需要

**错误码**

| 错误码 | 说明 |
| --- | --- |
| 40401 | 会话不存在 |

---

## 5. 补充说明

### 5.1 报告与笔记导出
报告导出与人格对话笔记导出均为**前端本地功能**（`lib/export.ts` 生成 .md 文件下载），不占用 API。

### 5.2 执行模型
- `POST /api/v1/runs` 启动执行后，服务端异步逐步骤调用 LLM，前端通过 `GET /api/v1/runs/:id` 轮询进度（MVP 轮询间隔建议 2~3 秒）
- 执行中断（如服务重启）：未完成 Run 标记为 failed，保留已完成步骤结果

---

*生成时间：2026-09-01 11:52*

## 更新记录

| 日期 | 版本 | 变更内容 | 修改人 |
| ---- | ---- | -------- | ------ |
| 2026-09-01 | 1.0 | 初版创建：Skill/Persona/Recipe/Run/Settings 五大模块接口规范 | 沟通确认 |
| 2026-09-01 | 1.1 | 新增：npx 导入模块（4.6）、人格对话与会话模块（4.7）、人格头像字段、错误码 50002 | 沟通确认 |
