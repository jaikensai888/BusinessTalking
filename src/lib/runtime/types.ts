/**
 * Worker 级 Runtime 抽象（见 dsh-runtime-execution-plan.md §5.3 / §5.1）。
 * 上层（Discussion service / orchestrator）只依赖这些类型与 DshRuntimeManager。
 */

/** DSH 路由配置：由 BusinessTalking LLM 设置映射而来 */
export interface RuntimeProfile {
  provider: string; // BusinessTalking provider 名（openai|anthropic），仅诊断/展示
  model: string;
  baseUrl?: string;
  profileHash: string;
  /** 可选：SDK 实际使用的 DSH 路由名（provider 选项）。默认 deepseek-official（原生路由）。
   *  自定义 openai/anthropic 需另注册 pi-ai 路由，否则 SDK 报 "no adapter registered"。 */
  dshRoute?: string;
}

/** 一次 run 的结果（投影层需要 finalResponse + events + status） */
export interface RuntimeRunResult {
  sessionId: string;
  finalResponse: string;
  events: unknown[];
  notifications: unknown[];
}

/** Runtime 抽象接口：便于测试用 fake client 替换 */
export interface DshRuntime {
  ensureStarted(profile: RuntimeProfile): Promise<void>;
  run(
    sessionId: string,
    prompt: string,
    onNotification?: (n: unknown) => void
  ): Promise<RuntimeRunResult>;
  assertHealthy(): void;
  close(): Promise<void>;
}

/** 提供给 DSH 的运行时选项（真实/测试共用） */
export interface DshRuntimeOptions {
  cwd: string;
  /** 项目自己的 `@deepseek-ai/dsh` CLI bin（绝对路径），避免 SDK 回退到桌面版 */
  dshBin?: string;
  /** base cordis patch（关闭默认 skill/web 等） */
  patches: string[];
  /** 显式 Harness home（项目目录内），隔离运行时状态，不写桌面 DSH home */
  dshHome?: string;
  /** 完整 child env（整体替换父 env）；用于剔除 NODE_OPTIONS/桌面变量并把 API key 注入 child */
  env?: NodeJS.ProcessEnv;
}
