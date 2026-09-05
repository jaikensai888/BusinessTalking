/**
 * Worker 级 Runtime 生命周期管理（见方案 §5.3）。
 * - 一个 manager 生命周期内只允许一个 profileHash；切换需 drain 旧 Runtime。
 * - per-session mutex：同一 Session 并发请求 → DshSessionBusyError，不隐式排队。
 * - SDK 无 per-session close：归档/删除只删逻辑关系与 snapshot，不 close 整个 Runtime。
 */
import { DeepSeekDshRuntime } from "./dsh-runtime";
import {
  DshRuntimeProfileConflictError,
  DshSessionBusyError,
  DshStartFailedError,
} from "@/lib/dsh/errors";
import type { DshRuntime, DshRuntimeOptions, RuntimeProfile, RuntimeRunResult } from "./types";

/** 运行时工厂：默认真实 DeepSeekDshRuntime，测试可注入 fake */
export type RuntimeFactory = (options: DshRuntimeOptions, profile: RuntimeProfile) => DshRuntime;

export class DshRuntimeManager {
  private runtime: DshRuntime | null = null;
  private activeProfileHash: string | null = null;
  private inFlight = new Set<string>();

  constructor(
    private readonly options: DshRuntimeOptions,
    private readonly createRuntime: RuntimeFactory = (o, p) => new DeepSeekDshRuntime(o, p)
  ) {}

  /** 传入的 child env（SDK 在 spawn 时读取）；调用方可先注入 API key 再 ensureStarted */
  get childEnv(): NodeJS.ProcessEnv | undefined {
    return this.options.env;
  }

  /**
   * 惰性启动 Runtime。首次调用用传入 profile 创建；已被同 profile 启动则 no-op；
   * 不同 profile：无活动 run 时 drain 旧 Runtime 并新建，有活动 run 时抛冲突。
   */
  async ensureStarted(profile: RuntimeProfile): Promise<void> {
    if (this.runtime) {
      if (this.activeProfileHash === profile.profileHash) return; // 同 profile，复用
      if (this.inFlight.size > 0) {
        throw new DshRuntimeProfileConflictError();
      }
      await this.runtime.close();
      this.runtime = null;
      this.activeProfileHash = null;
    }

    const runtime = this.createRuntime(this.options, profile);
    await runtime.ensureStarted(profile);
    this.runtime = runtime;
    this.activeProfileHash = profile.profileHash;
  }

  async run(
    sessionId: string,
    prompt: string,
    onNotification?: (n: unknown) => void
  ): Promise<RuntimeRunResult> {
    if (!this.runtime) throw new DshStartFailedError("Runtime 尚未启动，请先 ensureStarted");
    if (this.inFlight.has(sessionId)) throw new DshSessionBusyError();
    this.inFlight.add(sessionId);
    try {
      return await this.runtime.run(sessionId, prompt, onNotification);
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  assertHealthy(): void {
    if (!this.runtime) throw new DshStartFailedError("Runtime 未启动");
    this.runtime.assertHealthy();
  }

  async close(): Promise<void> {
    if (this.runtime) {
      await this.runtime.close();
      this.runtime = null;
      this.activeProfileHash = null;
    }
    this.inFlight.clear();
  }

  get isStarted(): boolean {
    return this.runtime !== null;
  }
}
