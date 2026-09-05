#!/usr/bin/env node
/**
 * 独立 DSH 回合执行器（A 方案）。
 * 在「干净的 node 进程」里运行 DSH runtime（避免 Next 进程内 spawn `dsh` 握手失败 exit 0）。
 * Next 服务器 spawn 本脚本，解析 stdout 的紧凑 JSON。
 *
 * 输入（环境变量，全部必填，无隐式默认值）：
 *   BT_DSH_SESSION_ID / BT_DSH_PROMPT / BT_DSH_PROVIDER / BT_DSH_MODEL
 *   BT_DSH_CWD / BT_DSH_HOME / BT_DSH_BIN / BT_DSH_API_KEY / BT_DSH_PATCHES(逗号分隔)
 * 输出：stdout 一个 JSON { ok, sessionId, finalResponse, error, code, stage }
 * 失败以 exit 1 + JSON（error）；缺少必填环境变量时输出结构化 DSH_* 错误。
 */
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";

const e = (k) => process.env[k];
function fail(code, stage, message) {
  process.stdout.write(JSON.stringify({ ok: false, code, stage, error: message }));
  process.exit(1);
}

const sessionId = e("BT_DSH_SESSION_ID");
const prompt = e("BT_DSH_PROMPT");
const provider = e("BT_DSH_PROVIDER");
const model = e("BT_DSH_MODEL");
const cwd = e("BT_DSH_CWD");
const dshHome = e("BT_DSH_HOME");
const dshBin = e("BT_DSH_BIN") || undefined;
const apiKey = e("BT_DSH_API_KEY") || undefined;
const patches = (e("BT_DSH_PATCHES", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

// fail-closed：缺任一必填配置立即结构化失败，不得使用隐式默认值
if (!sessionId) fail("DSH_MANIFEST_INVALID", "env", "缺少 BT_DSH_SESSION_ID");
if (!provider) fail("DSH_ROUTE_UNSUPPORTED", "env", "缺少 BT_DSH_PROVIDER");
if (!model) fail("DSH_ROUTE_UNSUPPORTED", "env", "缺少 BT_DSH_MODEL");
if (!cwd) fail("DSH_START_FAILED", "env", "缺少 BT_DSH_CWD");
if (!dshHome) fail("DSH_START_FAILED", "env", "缺少 BT_DSH_HOME");

const env = {};
for (const k of ["PATH","Path","HOME","USERPROFILE","TEMP","TMP","TMPDIR","SystemRoot","SYSTEMROOT","COMSPEC","PATHEXT","WINDIR","LANG","LC_ALL","NODE_PATH","PWD","INIT_CWD","APPDATA","LOCALAPPDATA"]) {
  if (process.env[k]) env[k] = process.env[k];
}
if (sessionId) env.BT_DSH_SESSION_ID = sessionId;
if (dshHome) env.BT_DSH_HOME = dshHome;
// P0：DSH 权限显式收敛到只读（当前安装版本读取 DSH_PERMISSION_MODE；不能再保留 workspace-write）
env.DSH_PERMISSION_MODE = "read-only";
if (apiKey) { env.DEEPSEEK_API_KEY = apiKey; env.BT_DSH_LLM_API_KEY = apiKey; env.OPENAI_API_KEY = apiKey; env.ANTHROPIC_API_KEY = apiKey; }

function emit(obj) { process.stdout.write(JSON.stringify(obj)); }

let harness;
try {
  harness = new DeepSeekHarness({
    profile: "sdk", provider, model, cwd, processCwd: cwd, dshBin, dshHome, env,
    ...(patches.length ? { patches } : {}), initializeTimeoutMs: 20_000,
  });
  await harness.start();
  const result = await harness.run(prompt, { sessionId });
  await harness.close();
  emit({
    ok: true,
    sessionId: result.sessionId,
    finalResponse: result.finalResponse,
    events: result.events,
  });
} catch (err) {
  // 成功和失败路径都 close()；close 失败不能覆盖更早错误
  try { await harness?.close(); } catch { /* 保留原始错误 */ }
  const message = String((err && err.message) ?? err);
  // 保留稳定 code/stage；不输出 API key、完整 prompt 或宿主环境
  const code = (err && err.code && typeof err.code === "string") ? err.code : "DSH_TURN_FAILED";
  emit({ ok: false, code, stage: "run", error: message });
  process.exit(1);
}
