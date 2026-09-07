import type { DshSessionProcessOptions } from "./session-process";

const INHERITED_ENV_KEYS = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "SystemRoot",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "WINDIR",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "LANG",
  "LC_ALL",
  "NODE_PATH",
  "PWD",
  "INIT_CWD",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

/**
 * Build the only environment a persistent DSH child is allowed to inherit.
 * Session id and prompt intentionally never cross this boundary as env vars;
 * they are carried by the authenticated JSONL command instead.
 */
export function buildDshChildEnv(options: DshSessionProcessOptions): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const key of INHERITED_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.BT_DSH_CWD = options.cwd;
  env.BT_DSH_HOME = options.dshHome;
  if (options.dshBin) env.BT_DSH_BIN = options.dshBin;
  env.BT_DSH_PROVIDER = options.provider;
  env.BT_DSH_MODEL = options.model;
  env.BT_DSH_PATCHES = options.patches.join(",");
  env.DSH_PERMISSION_MODE = "read-only";
  if (options.apiKey) {
    env.BT_DSH_API_KEY = options.apiKey;
    env.BT_DSH_LLM_API_KEY = options.apiKey;
    env.DEEPSEEK_API_KEY = options.apiKey;
    env.OPENAI_API_KEY = options.apiKey;
    env.ANTHROPIC_API_KEY = options.apiKey;
  }
  if (options.approvalUrl) env.BT_DSH_APPROVAL_URL = options.approvalUrl;
  if (options.approvalToken) env.BT_DSH_APPROVAL_TOKEN = options.approvalToken;
  return env;
}
