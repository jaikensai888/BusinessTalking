import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * API Key 本机加密存储（AES-256-GCM）。
 * 密钥文件 data/.secret（首次生成，模式 0600），不入版本库。
 */
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
