#!/usr/bin/env node
/**
 * Long-lived clean DSH Session runner.
 *
 * The parent speaks JSONL on stdin/stdout. Environment variables contain only
 * runtime configuration; session ids and prompts never cross the boundary as
 * environment values. One DeepSeekHarness instance serves multiple stable
 * sessions until shutdown or a fatal protocol/runtime error.
 */
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";

const env = (key) => process.env[key];
const required = (key) => {
  const value = env(key);
  if (!value) throw new RunnerFailure("DSH_START_FAILED", "env", `缺少 ${key}`);
  return value;
};

class RunnerFailure extends Error {
  constructor(code, stage, message) {
    super(message);
    this.code = code;
    this.stage = stage;
  }
}

const STABLE_CODES = new Set([
  "DSH_NOT_INSTALLED",
  "DSH_START_FAILED",
  "DSH_INITIALIZE_FAILED",
  "DSH_PROTOCOL_FAILED",
  "DSH_ROUTE_UNSUPPORTED",
  "DSH_CREDENTIAL_INVALID",
  "DSH_MANIFEST_INVALID",
  "DSH_SKILL_NOT_ALLOWED",
  "DSH_SESSION_BUSY",
  "DSH_TURN_FAILED",
  "RUNTIME_PROFILE_CONFLICT",
]);

function emit(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function asMessage(error) {
  return String(error?.message ?? error).slice(0, 500);
}

function emptyReplyDiagnostic(result) {
  const events = Array.isArray(result?.events) ? result.events : [];
  const counts = new Map();
  const assistantBlockTypes = new Set();
  const failureCodes = new Set();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const type = typeof event.type === "string" ? event.type : "unknown";
    counts.set(type, (counts.get(type) ?? 0) + 1);
    const data = event.data && typeof event.data === "object" ? event.data : null;
    if (data && type === "llm/retry" && data.failure && typeof data.failure === "object") {
      const failure = data.failure;
      const code = typeof failure.code === "string" ? failure.code : "unknown";
      const status = typeof failure.status === "number" ? `/${failure.status}` : "";
      failureCodes.add(`${code}${status}`);
    }
    if (data && type === "turn/end" && data.reason && typeof data.reason === "object") {
      const reason = data.reason;
      const error = reason.error && typeof reason.error === "object" ? reason.error : null;
      if (error) {
        const code = typeof error.code === "string" ? error.code : "unknown";
        const status = typeof error.status === "number" ? `/${error.status}` : "";
        failureCodes.add(`turn:${code}${status}`);
      }
    }
    if (type !== "assistant/message" || !event.data || typeof event.data !== "object") continue;
    const message = event.data.message && typeof event.data.message === "object"
      ? event.data.message
      : event.data;
    const content = message && typeof message === "object" && Array.isArray(message.content)
      ? message.content
      : [];
    for (const block of content) {
      if (block && typeof block === "object" && typeof block.type === "string") {
        assistantBlockTypes.add(block.type);
      }
    }
  }
  const eventSummary = [...counts.entries()]
    .map(([type, count]) => `${type}:${count}`)
    .join(",") || "none";
  const blockSummary = [...assistantBlockTypes].sort().join(",") || "none";
  const failureSummary = [...failureCodes].sort().join(",") || "none";
  return `DSH runner 返回空回复（events=${eventSummary}; assistantBlocks=${blockSummary}; failures=${failureSummary}）`;
}

function classify(error, stage) {
  if (error instanceof RunnerFailure) return error;
  if (typeof error?.code === "string" && STABLE_CODES.has(error.code)) {
    return new RunnerFailure(error.code, stage, asMessage(error));
  }
  switch (error?.name ?? error?.constructor?.name) {
    case "RequestTimeoutError":
      return new RunnerFailure(stage === "run" ? "DSH_TURN_FAILED" : "DSH_INITIALIZE_FAILED", stage, asMessage(error));
    case "TransportClosedError":
    case "SdkProtocolError":
    case "JsonRpcResponseError":
      return new RunnerFailure("DSH_PROTOCOL_FAILED", stage, asMessage(error));
    default:
      return new RunnerFailure(stage === "run" ? "DSH_TURN_FAILED" : "DSH_START_FAILED", stage, asMessage(error));
  }
}

function isNotification(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && typeof value.method === "string"
    && value.params && typeof value.params === "object" && !Array.isArray(value.params);
}

function parseCommand(line) {
  if (!line.trim()) throw new RunnerFailure("DSH_PROTOCOL_FAILED", "input", "空 command");
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    throw new RunnerFailure("DSH_PROTOCOL_FAILED", "input", "command JSON 非法");
  }
  if (!command || typeof command !== "object" || Array.isArray(command) || typeof command.type !== "string") {
    throw new RunnerFailure("DSH_PROTOCOL_FAILED", "input", "command 结构非法");
  }
  if (command.type === "shutdown") return { type: "shutdown" };
  if (command.type !== "run") throw new RunnerFailure("DSH_PROTOCOL_FAILED", "input", "未知 command type");
  if (typeof command.requestId !== "string" || !command.requestId) {
    throw new RunnerFailure("DSH_PROTOCOL_FAILED", "input", "requestId 必须是非空字符串");
  }
  if (typeof command.sessionId !== "string" || !command.sessionId) {
    throw new RunnerFailure("DSH_PROTOCOL_FAILED", "input", "sessionId 必须是非空字符串");
  }
  if (typeof command.prompt !== "string" || !command.prompt.trim()) {
    throw new RunnerFailure("DSH_PROTOCOL_FAILED", "input", "prompt 必须是非空字符串");
  }
  return command;
}

export function buildChildRuntimeEnv(source = process.env) {
  const allowed = [
    "PATH", "Path", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR",
    "SystemRoot", "SYSTEMROOT", "COMSPEC", "PATHEXT", "WINDIR", "LANG",
    "LC_ALL", "NODE_PATH", "PWD", "INIT_CWD", "APPDATA", "LOCALAPPDATA",
  ];
  const out = {};
  for (const key of allowed) if (source[key]) out[key] = source[key];
  for (const key of [
    "BT_DSH_CWD", "BT_DSH_HOME", "BT_DSH_BIN", "BT_DSH_PROVIDER", "BT_DSH_MODEL",
    "BT_DSH_PATCHES", "DSH_PERMISSION_MODE", "BT_DSH_API_KEY", "BT_DSH_LLM_API_KEY",
    "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
    "BT_DSH_APPROVAL_URL", "BT_DSH_APPROVAL_TOKEN",
    "BT_INTERNAL_SEARCH_URL", "BT_INTERNAL_TOKEN",
  ]) if (source[key]) out[key] = source[key];
  return out;
}

async function main() {
  const provider = required("BT_DSH_PROVIDER");
  const model = required("BT_DSH_MODEL");
  const cwd = required("BT_DSH_CWD");
  const dshHome = required("BT_DSH_HOME");
  const patches = (env("BT_DSH_PATCHES") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!patches.length) throw new RunnerFailure("DSH_START_FAILED", "env", "缺少 BT_DSH_PATCHES");
  if (env("DSH_PERMISSION_MODE") !== "read-only") {
    throw new RunnerFailure("DSH_MANIFEST_INVALID", "env", "DSH_PERMISSION_MODE 必须是 read-only");
  }

  const harness = new DeepSeekHarness({
    profile: "sdk",
    provider,
    model,
    cwd,
    processCwd: cwd,
    dshBin: env("BT_DSH_BIN") || undefined,
    dshHome,
    patches,
    env: buildChildRuntimeEnv(),
    initializeTimeoutMs: 20_000,
  });
  let shuttingDown = false;
  const running = new Set();

  const fatal = async (failure) => {
    if (shuttingDown) return;
    shuttingDown = true;
    emit({ type: "fatal", code: failure.code, stage: failure.stage, error: asMessage(failure) });
  };

  const runCommand = async (command) => {
    if (shuttingDown) return;
    try {
      const result = await harness.run(command.prompt, {
        sessionId: command.sessionId,
        onNotification: (notification) => {
          if (!isNotification(notification)) {
            throw new RunnerFailure("DSH_PROTOCOL_FAILED", "event", "DSH notification 结构非法");
          }
          emit({
            type: "event",
            requestId: command.requestId,
            sessionId: command.sessionId,
            notification,
          });
        },
      });
      if (shuttingDown) return;
      if (result?.sessionId !== command.sessionId) {
        throw new RunnerFailure("DSH_PROTOCOL_FAILED", "run", `DSH runner session 不匹配：${result?.sessionId}`);
      }
      if (typeof result?.finalResponse !== "string" || !result.finalResponse.trim()) {
        throw new RunnerFailure("DSH_TURN_FAILED", "run", emptyReplyDiagnostic(result));
      }
      emit({
        type: "done",
        requestId: command.requestId,
        sessionId: command.sessionId,
        finalResponse: result.finalResponse,
      });
    } catch (error) {
      const failure = classify(error, "run");
      if (failure.code === "DSH_TURN_FAILED") {
        emit({
          type: "error",
          requestId: command.requestId,
          code: failure.code,
          stage: failure.stage,
          error: asMessage(failure),
        });
      } else {
        await fatal(failure);
      }
    }
  };

  try {
    await harness.start();
    emit({ type: "ready" });
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      let command;
      try {
        command = parseCommand(line);
      } catch (error) {
        await fatal(classify(error, "input"));
        break;
      }
      if (command.type === "shutdown") {
        shuttingDown = true;
        break;
      }
      const task = runCommand(command);
      running.add(task);
      void task.finally(() => running.delete(task));
    }
    await Promise.allSettled([...running]);
  } catch (error) {
    const failure = classify(error, "start");
    emit({ type: "fatal", code: failure.code, stage: failure.stage, error: asMessage(failure) });
    process.exitCode = 1;
  } finally {
    try {
      await harness.close();
    } catch (error) {
      if (!process.exitCode) {
        emit({ type: "fatal", code: "DSH_PROTOCOL_FAILED", stage: "close", error: asMessage(error) });
        process.exitCode = 1;
      }
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await main();
  } catch (error) {
    const failure = classify(error, "start");
    emit({ type: "fatal", code: failure.code, stage: failure.stage, error: asMessage(failure) });
    process.exitCode = 1;
  }
}
