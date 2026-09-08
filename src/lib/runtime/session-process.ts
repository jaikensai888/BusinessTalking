import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DshCredentialInvalidError,
  DshError,
  DshManifestError,
  DshNotInstalledError,
  DshProtocolError,
  DshRouteUnsupportedError,
  DshRuntimeProfileConflictError,
  DshSessionBusyError,
  DshSkillNotAllowedError,
  DshStartFailedError,
  DshTurnError,
} from "@/lib/dsh/errors";
import type { DshNotification } from "@/lib/dsh/events";
import {
  MAX_RUNNER_FRAME_BYTES,
  parseRunnerFrame,
  type RunnerFrame,
  type RunnerRunCommand,
} from "@/lib/dsh/session-events";
import { buildDshChildEnv } from "./dsh-child-env";

export interface DshSessionProcessOptions {
  cwd: string;
  dshBin: string;
  dshHome: string;
  patches: string[];
  provider: string;
  model: string;
  apiKey?: string;
  approvalUrl?: string;
  approvalToken?: string;
  onNotification?: (requestId: string, notification: DshNotification) => Promise<void> | void;
  onFatal?: (error: DshError) => void;
  /** Test-only fixture override; production always uses scripts/dsh-session.mjs. */
  runnerScript?: string;
}

interface PendingRun {
  requestId: string;
  sessionId: string;
  resolve: (result: { sessionId: string; finalResponse: string }) => void;
  reject: (error: Error) => void;
  eventTail: Promise<void>;
  callbackError?: unknown;
  settled: boolean;
}

function nodeBin(): string {
  const envNode = process.env.npm_node_execPath;
  if (envNode && /node(\.exe)?$/i.test(envNode)) return envNode;
  if (process.execPath && /node(\.exe)?$/i.test(process.execPath)) return process.execPath;
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const candidate = path.join(pf, "nodejs", "node.exe");
  if (fs.existsSync(candidate)) return candidate;
  return process.execPath;
}

function errorForRunner(code: string | undefined, message: string, stage = "run"): DshError {
  const safe = (message || "DSH runner 返回未知错误").slice(0, 500);
  switch (code) {
    case "DSH_NOT_INSTALLED": return new DshNotInstalledError(safe);
    case "DSH_START_FAILED":
    case "DSH_INITIALIZE_FAILED": return new DshStartFailedError(safe);
    case "DSH_PROTOCOL_FAILED": return new DshProtocolError(safe);
    case "DSH_MANIFEST_INVALID": return new DshManifestError(safe);
    case "DSH_ROUTE_UNSUPPORTED": return new DshRouteUnsupportedError(safe);
    case "DSH_CREDENTIAL_INVALID": return new DshCredentialInvalidError(safe);
    case "DSH_SKILL_NOT_ALLOWED": return new DshSkillNotAllowedError(safe);
    case "DSH_SESSION_BUSY": return new DshSessionBusyError(safe);
    case "RUNTIME_PROFILE_CONFLICT": return new DshRuntimeProfileConflictError(safe);
    case "DSH_TURN_FAILED": return new DshTurnError(safe || "DSH 模型回合失败");
    default:
      return stage === "start" ? new DshStartFailedError(safe) : new DshProtocolError(safe);
  }
}

function errorFromUnknown(error: unknown, fallback: DshError): DshError {
  return error instanceof DshError ? error : fallback;
}

/** A single clean Node child that can run multiple stable DSH sessions. */
export class DshSessionProcess {
  private readonly options: DshSessionProcessOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readySettled = false;
  private readonly pending = new Map<string, PendingRun>();
  private readonly activeSessions = new Set<string>();
  private lineBuffer = "";
  private closed = false;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private fatalNotified = false;

  constructor(options: DshSessionProcessOptions) {
    this.options = options;
  }

  start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    if (this.closed || this.closing) return Promise.reject(new DshStartFailedError("DSH Session runner 已关闭"));

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const script = this.options.runnerScript ?? path.join(this.options.cwd, "scripts", "dsh-session.mjs");
    try {
      const child = spawn(nodeBin(), [script], {
        cwd: this.options.cwd,
        env: buildDshChildEnv(this.options),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string | Buffer) => this.onStdout(String(chunk)));
      child.stderr.on("data", () => undefined);
      child.on("error", (error) => {
        const mapped = new DshStartFailedError(`DSH Session runner 启动失败：${error.message}`);
        this.failAll(mapped, true);
        this.terminateChild();
      });
      child.on("close", (code, signal) => this.onClose(code, signal));
    } catch (error) {
      const mapped = new DshStartFailedError(`DSH Session runner 启动失败：${String(error)}`);
      this.failAll(mapped, true);
    }
    return this.readyPromise;
  }

  async run(input: { sessionId: string; prompt: string }): Promise<{ sessionId: string; finalResponse: string }> {
    if (typeof input.sessionId !== "string" || input.sessionId.trim().length === 0) {
      throw new DshProtocolError("DSH Session id 不能为空");
    }
    if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
      throw new DshProtocolError("DSH prompt 不能为空");
    }
    await this.start();
    if (this.closed || this.closing || !this.child?.stdin.writable) {
      throw new DshProtocolError("DSH Session runner 不可用");
    }
    if (this.activeSessions.has(input.sessionId)) {
      throw new DshSessionBusyError(`DSH Session 正在运行：${input.sessionId}`);
    }

    const requestId = randomUUID();
    const command: RunnerRunCommand = {
      type: "run",
      requestId,
      sessionId: input.sessionId,
      prompt: input.prompt,
    };
    return new Promise((resolve, reject) => {
      const pending: PendingRun = {
        requestId,
        sessionId: input.sessionId,
        resolve,
        reject,
        eventTail: Promise.resolve(),
        settled: false,
      };
      this.pending.set(requestId, pending);
      this.activeSessions.add(input.sessionId);
      try {
        this.child?.stdin.write(`${JSON.stringify(command)}\n`);
      } catch (error) {
        this.settle(pending, undefined, new DshProtocolError(`DSH runner 命令写入失败：${String(error)}`));
      }
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      const child = this.child;
      if (!child || this.closed) return;
      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          resolve();
        };
        child.once("close", finish);
        try {
          if (child.stdin.writable) child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
          else finish();
        } catch {
          finish();
        }
        const timer = setTimeout(() => {
          if (!this.closed) {
            try { child.kill(); } catch { /* child already gone */ }
          }
          finish();
        }, 2_000);
        timer.unref?.();
      });
    })().catch(() => undefined);
    return this.closePromise;
  }

  private onStdout(chunk: string): void {
    if (this.closed) return;
    this.lineBuffer += chunk;
    while (true) {
      const newline = this.lineBuffer.indexOf("\n");
      if (newline < 0) {
        if (Buffer.byteLength(this.lineBuffer, "utf8") > MAX_RUNNER_FRAME_BYTES) {
          this.protocolFailure("DSH runner 未终止的 frame 超过大小上限");
        }
        return;
      }
      const line = this.lineBuffer.slice(0, newline).replace(/\r$/, "");
      this.lineBuffer = this.lineBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > MAX_RUNNER_FRAME_BYTES) {
        this.protocolFailure("DSH runner frame 超过大小上限");
        return;
      }
      try {
        const frame = parseRunnerFrame(line);
        void this.handleFrame(frame);
      } catch (error) {
        this.protocolFailure(`DSH runner frame 解析失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }
  }

  private async handleFrame(frame: RunnerFrame): Promise<void> {
    if (this.closed) return;
    switch (frame.type) {
      case "ready":
        if (this.readySettled) {
          this.protocolFailure("DSH runner 重复发送 ready");
          return;
        }
        this.readySettled = true;
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
        return;
      case "event": {
        const pending = this.pending.get(frame.requestId);
        if (!pending) {
          this.protocolFailure(`DSH runner 返回未知 requestId：${frame.requestId}`);
          return;
        }
        if (frame.sessionId !== pending.sessionId || frame.notification.params.sessionId !== frame.sessionId) {
          this.settle(pending, undefined, new DshProtocolError(`DSH event session 不匹配：${frame.sessionId}`));
          this.terminateChild();
          return;
        }
        pending.eventTail = pending.eventTail.then(async () => {
          try {
            await this.options.onNotification?.(frame.requestId, frame.notification);
          } catch (error) {
            pending.callbackError = error;
          }
        });
        return;
      }
      case "done": {
        const pending = this.pending.get(frame.requestId);
        if (!pending) {
          this.protocolFailure(`DSH runner 返回未知 requestId：${frame.requestId}`);
          return;
        }
        if (frame.sessionId !== pending.sessionId) {
          this.settle(pending, undefined, new DshProtocolError(`DSH runner 返回 session 不匹配：${frame.sessionId}`));
          this.terminateChild();
          return;
        }
        await pending.eventTail;
        if (pending.settled) return;
        if (pending.callbackError) {
          this.settle(
            pending,
            undefined,
            errorFromUnknown(pending.callbackError, new DshProtocolError("DSH 事件回调失败")),
          );
          return;
        }
        if (!frame.finalResponse.trim()) {
          this.settle(pending, undefined, new DshTurnError("DSH runner 返回空回复"));
          return;
        }
        this.settle(pending, { sessionId: frame.sessionId, finalResponse: frame.finalResponse });
        return;
      }
      case "error": {
        if (!frame.requestId) {
          this.failAll(errorForRunner(frame.code, frame.error, frame.stage), true);
          this.terminateChild();
          return;
        }
        const pending = this.pending.get(frame.requestId);
        if (!pending) {
          this.protocolFailure(`DSH runner error 返回未知 requestId：${frame.requestId}`);
          return;
        }
        await pending.eventTail;
        this.settle(pending, undefined, errorForRunner(frame.code, frame.error, frame.stage));
        return;
      }
      case "fatal":
        this.failAll(errorForRunner(frame.code, frame.error, frame.stage), true);
        this.terminateChild();
        return;
    }
  }

  private onClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    this.closed = true;
    if (this.lineBuffer.trim()) {
      this.failAll(new DshProtocolError("DSH runner 在半个 frame 上退出"), true);
    } else if (!this.readySettled) {
      this.failAll(new DshStartFailedError(`DSH runner 未 ready 即退出(exit ${code ?? "null"}, ${signal ?? ""})`), true);
    } else if (this.pending.size > 0) {
      this.failAll(new DshProtocolError(`DSH runner 意外退出(exit ${code ?? "null"}, ${signal ?? ""})`), true);
    }
    this.child = null;
  }

  private settle(
    pending: PendingRun,
    result?: { sessionId: string; finalResponse: string },
    error?: Error,
  ): void {
    if (pending.settled) return;
    pending.settled = true;
    this.pending.delete(pending.requestId);
    this.activeSessions.delete(pending.sessionId);
    if (error) pending.reject(error);
    else if (result) pending.resolve(result);
    else pending.reject(new DshProtocolError("DSH runner 未返回结果"));
  }

  private failAll(error: DshError, notifyFatal: boolean): void {
    if (!this.readySettled) {
      this.readySettled = true;
      this.readyReject?.(error);
      this.readyResolve = null;
      this.readyReject = null;
    }
    for (const pending of [...this.pending.values()]) this.settle(pending, undefined, error);
    if (notifyFatal && !this.fatalNotified) {
      this.fatalNotified = true;
      try { this.options.onFatal?.(error); } catch { /* observer cannot break cleanup */ }
    }
  }

  private protocolFailure(message: string): void {
    const error = new DshProtocolError(message);
    this.failAll(error, true);
    this.terminateChild();
  }

  private terminateChild(): void {
    try { this.child?.kill(); } catch { /* child already closed */ }
  }
}
