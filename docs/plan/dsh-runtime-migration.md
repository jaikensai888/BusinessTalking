# DSH Runtime 迁移备案

## 结论

不整体迁移 BusinessTalking 到 DSH。保留 Next.js + Prisma，将 DSH 接入为 Agent Runtime。

```text
BusinessTalking UI/API/Prisma
          ↓
    AgentRuntime Adapter
       ↙          ↘
现有 Recipe    DSH Runtime
```

## 迁移范围

- DSH 负责 Agent Loop、工具调用、Skill 加载、Session 和运行轨迹。
- BusinessTalking 负责商业数据、业务规则、Recipe、最终报告和评分。
- 固定顺序、需要 Schema 校验的 Recipe 暂时继续使用现有 `runner.ts`。

## 迁移顺序

1. 抽象统一的 `AgentRuntime` 接口。
2. 先迁移“人格对话 + 联网搜索”。
3. 将搜索、Persona、Skill 封装为 DSH 插件。
4. 将 DSH Session 事件投影到现有 `Discussion/Run`。
5. 最后再评估是否迁移多人讨论和 Recipe。

## 第一阶段目标

验证 DSH 是否能改善“人格对话 + 联网研究 + 可恢复 Session”这条链路；在验证完成前保留现有 AI SDK 实现作为 fallback。

