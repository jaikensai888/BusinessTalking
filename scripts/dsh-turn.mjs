#!/usr/bin/env node
/**
 * 独立 DSH 回合执行器（A 方案）。
 * 在「干净的 node 进程」里运行 DSH runtime（避免 Next 进程内 spawn `dsh` 握手失败 exit 0）。
 * Next 服务器 spawn 本脚本，解析 stdout 的紧凑 JSON。
 *
 * 输入（环境变量）：
 *   BT_DSH_SESSION_ID / BT_DSH_PROMPT / BT_DSH_PROVIDER / BT_DSH_MODEL
 *   BT_DSH_CWD / BT_DSH_BIN / BT_DSH_API_KEY / BT_DSH_PATCHES(逗号分隔)
 * 输出：stdout 一个 JSON { ok, sessionId, finalResponse, error }
 * 失败以 exit 1 + JSON（error）。
 */
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";

const e = (k, d) => process.env[k] ?? d;
const sessionId = e("BT_DSH_SESSION_ID");
const prompt = e("BT_DSH_PROMPT");
const provider = e("BT_DSH_PROVIDER", "deepseek-official");
const model = e("BT_DSH_MODEL", "deepseek-v4-flash");
const cwd = e("BT_DSH_CWD", process.cwd());
const dshBin = e("BT_DSH_BIN") || undefined;
const apiKey = e("BT_DSH_API_KEY") || undefined;
const patches = (e("BT_DSH_PATCHES", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

const env = {};
for (const k of ["PATH","Path","HOME","USERPROFILE","TEMP","TMP","TMPDIR","SystemRoot","SYSTEMROOT","COMSPEC","PATHEXT","WINDIR","LANG","LC_ALL","NODE_PATH","PWD","INIT_CWD","APPDATA","LOCALAPPDATA"]) {
  if (process.env[k]) env[k] = process.env[k];
}
if (apiKey) { env.DEEPSEEK_API_KEY = apiKey; env.BT_DSH_LLM_API_KEY = apiKey; env.OPENAI_API_KEY = apiKey; env.ANTHROPIC_API_KEY = apiKey; }

function emit(obj) { process.stdout.write(JSON.stringify(obj)); }

try {
  const h = new DeepSeekHarness({
    profile: "sdk", provider, model, cwd, processCwd: cwd, dshBin, env,
    ...(patches.length ? { patches } : {}), initializeTimeoutMs: 20_000,
  });
  await h.start();
  const result = await h.run(prompt, { sessionId });
  await h.close();
  emit({ ok: true, sessionId: result.sessionId, finalResponse: result.finalResponse });
} catch (err) {
  emit({ ok: false, error: String((err && err.message) ?? err) });
  process.exit(1);
}
