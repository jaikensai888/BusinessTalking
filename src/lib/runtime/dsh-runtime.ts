/**
 * DeepSeekHarness 封装（见方案 §5.3）。负责 la子进程的 start/run/close，
 * 并把 SDK 错误映射为 DSH 稳定错误类。不捕获错误后调用 legacy AI SDK。
 */
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import { DshProtocolError, DshStartFailedError, DshTurnError } from "@/lib/dsh/errors";
import type { DshRuntime, DshRuntimeOptions, RuntimeProfile, RuntimeRunResult } from "./types";

export class DeepSeekDshRuntime implements DshRuntime {
  private harness: DeepSeekHarness;
  private started = false;
  constructor(options: DshRuntimeOptions, profile: RuntimeProfile) {
    this.harness = new DeepSeekHarness({
      profile: "sdk",
      cwd: options.cwd,
      processCwd: options.cwd,
      patches: options.patches,
      dshBin: options.dshBin,
      dshHome: options.dshHome,
      env: options.env,
      provider: profile.dshRoute ?? profile.provider,
      model: profile.model,
      initializeTimeoutMs: 20_000,
    });
  }

  async ensureStarted(_profile: RuntimeProfile): Promise<void> {
    // profile 已在构造时固化；此处仅保证启动
    void _profile;
    try {
      await this.harness.start();
      this.started = true;
    } catch (e) {
      throw mapStartError(e);
    }
  }

  async run(
    sessionId: string,
    prompt: string,
    onNotification?: (n: unknown) => void
  ): Promise<RuntimeRunResult> {
    try {
      const result = await this.harness.run(prompt, {
        sessionId,
        onNotification: onNotification as (n: import("@deepseek-ai/dsh-sdk-client").HarnessNotification) => void,
      });
      return {
        sessionId: result.sessionId,
        finalResponse: result.finalResponse,
        events: result.events,
        notifications: result.notifications,
      };
    } catch (e) {
      throw mapTurnError(e);
    }
  }

  assertHealthy(): void {
    // SDK 没有独立 health API：client 存在即视为可继续；进程消失由 run()/TransportClosedError 感知
    void this.harness.client;
  }

  async close(): Promise<void> {
    await this.harness.close();
    this.started = false;
  }
}

function mapStartError(e: unknown): Error {
  const err = e as {
    constructor?: { name?: string };
    message?: string;
    code?: string;
  };
  const name = err?.constructor?.name;
  if (name === "TransportClosedError") {
    return new DshStartFailedError(`DSH Runtime 进程启动后退出：${err.message ?? ""}`.trim());
  }
  if (name === "SdkProtocolError") {
    return new DshProtocolError(`DSH 初始化协议错误：${err.message ?? ""}`);
  }
  if (name === "RequestTimeoutError") {
    return new DshStartFailedError(`DSH 初始化/握手超时：${err.message ?? ""}`);
  }
  if (name === "JsonRpcResponseError") {
    return new DshProtocolError(`DSH initialize 返回错误：${err.message ?? ""}`);
  }
  return new DshStartFailedError(`DSH Runtime 启动失败：${err.message ?? String(e)}`);
}

function mapTurnError(e: unknown): Error {
  const err = e as { constructor?: { name?: string }; message?: string; code?: string };
  const name = err?.constructor?.name;
  if (name === "TransportClosedError") {
    // 进程级失败：不可降级
    return new DshProtocolError(`DSH Runtime 进程已退出：${err.message ?? ""}`);
  }
  if (name === "SdkProtocolError") {
    return new DshProtocolError(`DSH 协议错误：${err.message ?? ""}`);
  }
  if (name === "RequestTimeoutError") {
    return new DshTurnError(`DSH 模型回合超时：${err.message ?? ""}`);
  }
  if (name === "JsonRpcResponseError") {
    return new DshTurnError(`DSH 模型回合返回错误：${err.message ?? ""}`);
  }
  // 默认视为模型回合失败（满足“单 Persona 回合失败可继续”的判定）
  return new DshTurnError(`DSH 模型回合失败：${err.message ?? String(e)}`);
}
