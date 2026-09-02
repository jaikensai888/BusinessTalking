import { err, ok } from "@/lib/api";
import { decrypt, encrypt } from "@/lib/settings/encryption";
import { getSetting, setSetting } from "@/lib/settings/store";
import { normalizeProvider } from "@/lib/llm/constants";

const ALLOWED_PROVIDERS = ["openai", "anthropic"];

function mask(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 5)}***${key.slice(-3)}`;
}

function parseModels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** GET /api/v1/settings — 仅返回脱敏 Key；兼容旧 provider 值 */
export async function GET() {
  const [provider, baseUrl, keyCipher, modelsRaw, defaultModel, timeout] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.models"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);

  const apiKey = keyCipher ? decrypt(keyCipher) : null;
  const models = parseModels(modelsRaw);
  const legacyDeepseek = provider === "deepseek";
  const resolvedBaseUrl = baseUrl ?? (legacyDeepseek ? "https://api.deepseek.com" : "");

  return ok({
    llm: {
      provider: normalizeProvider(provider),
      baseUrl: resolvedBaseUrl,
      apiKeyConfigured: Boolean(apiKey),
      apiKeyMasked: apiKey ? mask(apiKey) : null,
      models,
      defaultModel: defaultModel ?? models[0] ?? "",
      timeoutSeconds: Number(timeout ?? 120),
    },
  });
}

/** PUT /api/v1/settings — 保存配置（双 provider + baseURL + 多模型）；apiKey 空串不修改 */
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const { provider, baseUrl, apiKey, models, defaultModel, timeoutSeconds } = body ?? {};

  if (provider !== undefined) {
    if (typeof provider !== "string" || !ALLOWED_PROVIDERS.includes(provider)) {
      return err(40001, "provider 仅支持 openai / anthropic", 400);
    }
    await setSetting("llm.provider", provider);
  }

  if (baseUrl !== undefined) {
    if (typeof baseUrl !== "string") return err(40001, "baseUrl 类型错误", 400);
    await setSetting("llm.baseUrl", baseUrl.trim());
  }

  if (models !== undefined) {
    if (!Array.isArray(models) || !models.every((m) => typeof m === "string")) {
      return err(40001, "models 必须是字符串数组", 400);
    }
    const cleaned = models.map((m) => m.trim()).filter(Boolean);
    if (cleaned.length === 0) return err(40001, "至少填写一个模型", 400);
    await setSetting("llm.models", JSON.stringify(cleaned));
  }

  if (defaultModel !== undefined) {
    if (typeof defaultModel !== "string" || !defaultModel) return err(40001, "defaultModel 不能为空", 400);
    await setSetting("llm.defaultModel", defaultModel);
  }

  if (timeoutSeconds !== undefined) {
    const t = Number(timeoutSeconds);
    if (!Number.isFinite(t) || t < 30 || t > 600) return err(40001, "timeoutSeconds 需在 30~600 之间", 400);
    await setSetting("llm.timeoutSeconds", String(t));
  }

  if (typeof apiKey === "string" && apiKey.length > 0) {
    await setSetting("llm.apiKey", encrypt(apiKey));
  }

  return ok({ saved: true });
}
