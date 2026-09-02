# BusinessTalking

商业可行性分析工作台：收录 skill 与人格，编排成「可行性分析配方」，内置大模型执行，一键产出带多视角质询的可行性报告。个人/小团队自用工具。

## 技术栈

- **Next.js 16.3.4**（App Router + Turbopack）+ React 19 + TypeScript
- **Tailwind CSS 4**（DESIGN.md Apple 设计语言 token）
- **Prisma 6.19.3 + SQLite**（本地单文件，数据私密）
- **Vercel AI SDK 7**（DeepSeek / OpenAI / Anthropic / Ollama）

## 快速开始

```bash
pnpm install
pnpm exec prisma migrate dev      # 初始化数据库（10 实体 + 5 枚举）
pnpm exec prisma db seed          # 写入内置 skill/人格（Node 原生 TS 运行）
pnpm dev                          # 启动，访问 http://localhost:3001
```

首次启动后在「设置」页填入 LLM API Key 并测试连接。

## 目录结构

```
src/
├── app/
│   ├── (dashboard)/              # 主界面（侧边栏 + 明暗瓦片）
│   │   ├── page.tsx              # 工作台（居中输入 + 卡片流，迭代 5）
│   │   ├── skills/ personas/ recipes/ runs/ settings/
│   └── api/v1/                   # Route Handlers
├── components/
│   ├── layout/                   # 侧边栏
│   ├── settings/                 # 设置表单
│   └── ui/                       # Button / Input / Avatar / Card（DESIGN.md token）
├── lib/
│   ├── api.ts                    # 统一响应 ok/err
│   ├── db.ts                     # Prisma 单例
│   ├── llm/                      # provider 装配（constants/providers）
│   └── settings/                 # 加密存储与配置读写
prisma/
├── schema.prisma                 # 数据模型
└── seed.ts                       # 内置种子
docs/prd/                         # 产品与技术文档（01_PRD ~ 06_TODOLIST + DESIGN.md）
docs/plan/ docs/exec/             # 迭代计划与执行记录
```

## 迭代进度

| 迭代 | 目标 | 状态 |
| --- | --- | --- |
| 迭代 1 | 项目初始化与基础设施 | ✅ 已完成 |
| 迭代 2 | Skill 库与 npx 导入 | ✅ 已完成 |
| 迭代 3 | 人格库与人格交流 | ✅ 已完成 |
| 迭代 4 | 配方编排 | ✅ 已完成 |
| 迭代 5 | 执行引擎与工作台 | ✅ 已完成 |
| 迭代 6 | 效果反馈与体验打磨 | ⬚ 未开始 |

详细规划见 `docs/prd/06_TODOLIST.md`。
