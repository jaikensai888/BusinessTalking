/**
 * A 方案：通过独立 `node` 子进程运行 DSH 回合，避免 Next 服务器进程内 spawn `dsh`
 * 握手失败（exit 0）的问题（已验证独立进程可正常 boot + 模型回复）。
 *
 * P0：runner 输出必须带请求 session id；父进程验证 parsed.sessionId === req.sessionId。
 * 返回其他 session、非字符串 response、损坏 JSON、非零退出码或无法确认 child 已结束，
 * 均按 DSH 失败处理（映射为对应 DshError 子类）。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import {
  DshProtocolError,
  DshNotInstalledError,
  DshStartFailedError,
  DshManifestError,
  DshRouteUnsupportedError,
  DshCredentialInvalidError,
  DshSkillNotAllowedError,
  DshSessionBusyError,
  DshRuntimeProfileConflictError,
  DshTurnError,
  DshError,
} from "@/lib/dsh/errors";

export interface TurnRequest {
  sessionId: string;
  prompt: string;
  provider: string; // dsh 路由（deepseek-official）
  model: string;
  cwd: string;
  dshBin?: string;
  dshHome?: string;
  apiKey?: string;
  patches?: string[];
}

export interface TurnResult {
  sessionId: string;
  finalResponse: string;
}

function buildEnv(req: TurnRequest): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const k of ["PATH","Path","HOME","USERPROFILE","TEMP","TMP","TMPDIR","SystemRoot","SYSTEMROOT","COMSPEC","PATHEXT","WINDIR","LANG","LC_ALL","NODE_PATH","PWD","INIT_CWD","APPDATA","LOCALAPPDATA"]) {
    if (process.env[k]) env[k] = process.env[k];
  }
  env.BT_DSH_SESSION_ID = req.sessionId;
  env.BT_DSH_PROMPT = req.prompt;
  env.BT_DSH_PROVIDER = req.provider;
  env.BT_DSH_MODEL = req.model;
  env.BT_DSH_CWD = req.cwd;
  // P0：DSH 权限显式只读（不用下游默认 workspace-write）
  env.DSH_PERMISSION_MODE = "read-only";
  if (req.dshHome) env.BT_DSH_HOME = req.dshHome;
  if (req.dshBin) env.BT_DSH_BIN = req.dshBin;
  if (req.apiKey) { env.BT_DSH_API_KEY = req.apiKey; env.DEEPSEEK_API_KEY = req.apiKey; env.OPENAI_API_KEY = req.apiKey; env.ANTHROPIC_API_KEY = req.apiKey; }
  if (req.patches?.length) env.BT_DSH_PATCHES = req.patches.join(",");
  return env;
}

/** 解析真正的 node 可执行文件（在被 Electron 托管的 Next 里 process.execPath 指向 Electron 而非 node） */
function nodeBin(): string {
  const envNode = process.env.npm_node_execPath;
  if (envNode && /node(\.exe)?$/i.test(envNode)) return envNode;
  if (process.execPath && /node(\.exe)?$/i.test(process.execPath)) return process.execPath;
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const cand = path.join(pf, "nodejs", "node.exe");
  if (fs.existsSync(cand)) return cand;
  return process.execPath;
}

/** 将 runner 结构化 code 映射到 DshError 子类（解析异常 → DSH_PROTOCOL_FAILED） */
export function mapRunnerError(code: string | undefined, message: string): DshError {
  const safe = (m: string) => m.slice(0, 500);
  switch (code) {
    case "DSH_START_FAILED":
    case "DSH_INITIALIZE_FAILED":
      return new DshStartFailedError(safe(message));
    case "DSH_NOT_INSTALLED":
      return new DshNotInstalledError(safe(message));
    case "DSH_PROTOCOL_FAILED":
      return new DshProtocolError(safe(message));
    case "DSH_MANIFEST_INVALID":
      return new DshManifestError(safe(message));
    case "DSH_ROUTE_UNSUPPORTED":
      return new DshRouteUnsupportedError(safe(message));
    case "DSH_CREDENTIAL_INVALID":
      return new DshCredentialInvalidError(safe(message));
    case "DSH_SKILL_NOT_ALLOWED":
      return new DshSkillNotAllowedError(safe(message));
    case "DSH_SESSION_BUSY":
      return new DshSessionBusyError(safe(message));
    case "RUNTIME_PROFILE_CONFLICT":
      return new DshRuntimeProfileConflictError(safe(message));
    case "DSH_TURN_FAILED":
      return new DshTurnError(safe(message || "DSH 模型回合失败"));
    case undefined:
    default:
      return new DshProtocolError(safe(message || "DSH runner 返回未知错误码"));
  }
}

/** spawn 独立进程运行一回合，解析 stdout JSON；失败抛错（带结构化 DshError） */
export function runTurnViaProcess(req: TurnRequest): Promise<TurnResult> {
  const script = path.join(req.cwd, "scripts", "dsh-turn.mjs");
  const child = spawn(/* turbopackIgnore: true */ nodeBin(), [script], {
    cwd: req.cwd,
    env: buildEnv(req),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      reject(new DshStartFailedError(`DSH runner 启动失败：${e.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      let parsed: { ok?: boolean; finalResponse?: string; error?: string; sessionId?: string; code?: string; stage?: string };
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(new DshProtocolError(`DSH runner 输出异常(exit ${code})：${(stderr || stdout).slice(0, 300)}`));
        return;
      }
      if (parsed.ok !== true) {
        reject(mapRunnerError(parsed.code, parsed.error ?? "未知错误"));
        return;
      }
      // A success payload is only valid when the child exited normally. A
      // process can emit JSON and still fail during teardown or be signaled.
      if (code !== 0) {
        reject(new DshProtocolError(`DSH runner 非零退出(exit ${code})：${(stderr || stdout).slice(0, 300)}`));
        return;
      }
      // 返回其他 session 或非字符串 response 均按失败处理
      if (parsed.sessionId !== req.sessionId) {
        reject(new DshProtocolError(`DSH runner 返回 session 不匹配：${parsed.sessionId}（期望 ${req.sessionId}）`));
        return;
      }
      if (typeof parsed.finalResponse !== "string") {
        reject(new DshTurnError("DSH runner 未返回字符串回复"));
        return;
      }
      if (!parsed.finalResponse.trim()) {
        reject(new DshTurnError("DSH runner 返回空回复"));
        return;
      }
      resolve({ sessionId: parsed.sessionId, finalResponse: parsed.finalResponse });
    });
  });
}
