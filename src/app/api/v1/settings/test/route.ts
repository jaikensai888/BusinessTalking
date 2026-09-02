import { generateText } from "ai";
import { err, ok } from "@/lib/api";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { decrypt } from "@/lib/settings/encryption";
import { getSetting } from "@/lib/settings/store";

/** POST /api/v1/settings/test — 用当前配置（provider + baseUrl + 默认模型）发最小请求验证 */
export async function POST() {
  const [providerRaw, baseUrl, keyCipher, modelRaw, timeoutRaw] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);

  const provider = normalizeProvider(providerRaw);
  const apiKey = keyCipher ? decrypt(keyCipher) : "";
  const model = modelRaw ?? "";

  if (!apiKey) return err(50201, "未配置有效的 API Key，请先在设置中填写", 502);
  if (!model) return err(50201, "未设置默认模型，请先在设置中填写", 502);

  const t0 = Date.now();
  try {
    const modelObj = buildModel(provider, apiKey, model, baseUrl || undefined);
    const timeoutMs = Math.min(Number(timeoutRaw ?? 120) * 1000, 120000);
    await generateText({
      model: modelObj,
      prompt: "Reply with exactly: OK",
      maxOutputTokens: 4,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return ok({ ok: true, latencyMs: Date.now() - t0, provider, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(50201, `LLM 调用失败：${msg}`, 502);
  }
}
