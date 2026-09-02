/**
 * 任务 T1-05: LLM 多 provider 接入层 + 测试连接
 * 目标文件: src/lib/llm/providers.ts、src/app/api/v1/settings/test/route.ts
 */
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOllama } from "ai/ollama-provider"; // 或 @ai-sdk/ollama

export type ProviderName = "deepseek" | "openai" | "anthropic" | "ollama";

export function buildProvider(name: ProviderName, apiKey: string) {
  switch (name) {
    case "deepseek":
      return { provider: createDeepSeek({ apiKey }), defaultModel: "deepseek-chat" };
    case "openai":
      return { provider: createOpenAI({ apiKey }), defaultModel: "gpt-4o-mini" };
    case "anthropic":
      return { provider: createAnthropic({ apiKey }), defaultModel: "claude-3-5-haiku-latest" };
    case "ollama":
      return { provider: createOllama(), defaultModel: "qwen2.5:7b" };
  }
}

// POST /api/v1/settings/test
export async function POST() {
  const cfg = await loadConfig(); // 读取解密后的 Key
  if (!cfg.apiKey && cfg.provider !== "ollama") {
    return err(50201, "未配置有效的 API Key");
  }
  const t0 = Date.now();
  try {
    const { provider, defaultModel } = buildProvider(cfg.provider, cfg.apiKey);
    const model = provider(cfg.model || defaultModel);
    await model.doGenerate({ prompt: "ping" }); // 最小请求
    return ok({ ok: true, latencyMs: Date.now() - t0 });
  } catch (e) {
    return err(50201, `LLM 调用失败：${readable(e)}`);
  }
}
