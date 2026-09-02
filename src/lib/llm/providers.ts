import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderName } from "./constants";

export type { ProviderName } from "./constants";

/** 按 provider 装配 AI SDK 模型；openai 支持自定义 baseURL（DeepSeek 等兼容服务） */
export function buildModel(
  provider: ProviderName,
  apiKey: string,
  model: string,
  baseUrl?: string
): LanguageModel {
  if (provider === "anthropic") {
    return createAnthropic({ apiKey })(model);
  }
  return createOpenAI({ apiKey, baseURL: baseUrl || undefined })(model);
}
