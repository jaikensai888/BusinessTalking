/**
 * A 方案：通过独立 `node` 子进程运行 DSH 回合，避免 Next 服务器进程内 spawn `dsh`
 * 握手失败（exit 0）的问题（已验证独立进程可正常 boot + 模型回复）。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

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

/** spawn 独立进程运行一回合，解析 stdout JSON；失败抛错（带运行时错误信息） */
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
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (e) => reject(new Error(`DSH runner 启动失败：${e.message}`)));
    child.on("close", (code) => {
      let parsed: { ok?: boolean; finalResponse?: string; error?: string; sessionId?: string };
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(new Error(`DSH runner 输出异常(exit ${code})：${(stderr || stdout).slice(0, 300)}`));
        return;
      }
      if (!parsed.ok) {
        reject(new Error(`DSH 回合失败：${parsed.error ?? "未知错误"}`));
        return;
      }
      resolve({ sessionId: parsed.sessionId ?? req.sessionId, finalResponse: parsed.finalResponse ?? "" });
    });
  });
}
