/**
 * 任务 T1-04: Settings API + Key 加密
 * 目标文件: src/lib/settings/encryption.ts、src/app/api/v1/settings/route.ts
 * AES-256-GCM；密钥文件 data/.secret（首次生成，不入库）
 */
// encryption.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SECRET_PATH = path.join(process.cwd(), "data", ".secret");

function getKey(): Buffer {
  if (!fs.existsSync(SECRET_PATH)) {
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(SECRET_PATH, key, { mode: 0o600 });
    return key;
  }
  return fs.readFileSync(SECRET_PATH);
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// route.ts (GET/PUT /api/v1/settings)
export async function GET() {
  const [provider, model, timeout, keyCipher] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.model"),
    getSetting("llm.timeoutSeconds"),
    getSetting("llm.apiKey"),
  ]);
  return ok({
    llm: {
      provider: provider ?? "deepseek",
      apiKeyConfigured: Boolean(keyCipher),
      apiKeyMasked: keyCipher ? mask(decrypt(keyCipher)) : null,
      model: model ?? "",
      timeoutSeconds: Number(timeout ?? 120),
    },
  });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { provider, apiKey, model, timeoutSeconds } = body;
  if (provider) await setSetting("llm.provider", provider);
  if (model) await setSetting("llm.model", model);
  if (timeoutSeconds) await setSetting("llm.timeoutSeconds", String(timeoutSeconds));
  if (apiKey && typeof apiKey === "string" && apiKey.length > 0) {
    await setSetting("llm.apiKey", encrypt(apiKey)); // 仅存密文
  }
  return ok({ saved: true });
}
