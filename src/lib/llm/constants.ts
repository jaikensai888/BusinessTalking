/**
 * LLM provider 常量（纯数据，服务端/客户端共用）
 * 仅两种模式：OpenAI（兼容）/ Anthropic；DeepSeek 等走 OpenAI 兼容 baseURL
 */
export type ProviderName = "openai" | "anthropic";

export const PROVIDERS: { value: ProviderName; label: string; description: string }[] = [
  { value: "openai", label: "OpenAI（兼容）", description: "OpenAI、DeepSeek 及任何 OpenAI 兼容服务" },
  { value: "anthropic", label: "Anthropic", description: "Claude 系列" },
];

export const OPENAI_PRESETS: { label: string; baseUrl: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com" },
];

/** 兼容旧数据：deepseek/ollama 归一为 openai，deepseek 补 baseUrl */
export function normalizeProvider(p: string | null | undefined): ProviderName {
  return p === "anthropic" ? "anthropic" : "openai";
}
