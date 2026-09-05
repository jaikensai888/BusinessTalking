/**
 * BusinessTalking LLM 设置 → DSH route / patch / env 映射（见方案 §5.2）。
 * 纯函数，便于测试；不读 DB、不写 secret。
 */
import crypto from "node:crypto";
import type { RuntimeProfile } from "./types";
import { DshRouteUnsupportedError } from "@/lib/dsh/errors";

export type ProviderName = "openai" | "anthropic";

/** 支持的 provider → DSH llm-pi-ai route */
const ROUTE_BY_PROVIDER: Record<ProviderName, string> = {
  openai: "openai-completions",
  anthropic: "anthropic-messages",
};

export interface ProfileInput {
  provider: string | null | undefined;
  baseUrl?: string | null | undefined;
  defaultModel?: string | null | undefined;
}

/** 归一化 provider（兼容 old：deepseek/ollama → openai） */
export function normalizeProvider(p: string | null | undefined): ProviderName {
  return p === "anthropic" ? "anthropic" : "openai";
}

/**
 * 计算 profileHash：包含 provider、model、baseURL 与 tool roster（不含 secret）。
 * 稳定：相同输入 → 相同 hash。
 */
export function computeProfileHash(profile: {
  provider: string;
  model: string;
  baseUrl?: string | null;
}): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ provider: profile.provider, model: profile.model, baseUrl: profile.baseUrl ?? null }))
    .digest("hex");
}

/**
 * 构建 DSH 运行时 profile（含 child env 的 key 名，不含 key 值）。
 * provider/model/baseURL 缺失或不被支持时抛 DshRouteUnsupportedError。
 * dshRoute 是 SDK 实际使用的 DSH 路由名：默认 deepseek-official（sdk profile 内置唯一 adapter）。
 */
export function buildRuntimeProfile(input: ProfileInput): RuntimeProfile {
  const provider = normalizeProvider(input.provider);
  const model = input.defaultModel?.trim();
  if (!model) {
    throw new DshRouteUnsupportedError("未配置 LLM defaultModel，无法选择 DSH 路由");
  }
  if (!(provider in ROUTE_BY_PROVIDER)) {
    throw new DshRouteUnsupportedError(`不支持的 DSH provider 路由：${provider}`);
  }
  const baseUrl = input.baseUrl?.trim() || undefined;
  const dshRoute = resolveDshRoute(provider, baseUrl);

  return {
    provider,
    model,
    baseUrl,
    profileHash: computeProfileHash({ provider, model, baseUrl }),
    dshRoute,
  };
}

/** 把 BusinessTalking provider 映射到 SDK 能认的 DSH 路由名（sdk profile 内置仅 deepseek-official）。 */
export function resolveDshRoute(provider: ProviderName, baseUrl?: string | null): string {
  // DeepSeek（openai 兼容，baseUrl 含 deepseek.com）→ DSH 原生 deepseek-official 路由
  if (provider === "openai" && baseUrl?.includes("deepseek.com")) return "deepseek-official";
  // 其它 provider 无内置 adapter；默认路由能 boot，但需自己注册 pi-ai 路由才能真正服务
  return "deepseek-official";
}

/** 提供给 DSH child 的只读环境变量（key 名集合）；调用方负责注入真实 key 值 */
export function credentialEnvKeys(): string[] {
  return ["BT_DSH_LLM_API_KEY"];
}

/** 生成不含 secret 的 runtime cordis patch（YAML），用于覆盖 llm-pi-ai 配置与关闭未用 route */
export function buildRuntimePatchYaml(profile: RuntimeProfile): string {
  const name = normalizeProviderForProfile(profile.provider);
  const route = ROUTE_BY_PROVIDER[name];
  const baseUrlLine = profile.baseUrl ? `        baseURL: ${JSON.stringify(profile.baseUrl)}` : "";
  return `# runtime patch — 由 BusinessTalking profile builder 生成（不含 key）
- id: llm-pi-ai
  config:
    routes:
      - id: ${route}
        models:
          - ${profile.model}
${baseUrlLine}
`;
}

/** openai 兼容 baseURL 的 route 名（供 patch/查询诊断） */
export function dshRouteName(provider: ProviderName): string {
  return ROUTE_BY_PROVIDER[provider];
}

/** 把任意 provider 字符串安全归一为 ProviderName（用于 patch 生成） */
function normalizeProviderForProfile(provider: string): ProviderName {
  return provider === "anthropic" ? "anthropic" : "openai";
}
