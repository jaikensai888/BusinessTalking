import { randomBytes } from "node:crypto";

// 去除易混淆字符（0/O、1/I）的 31 字符大写字母数字集
const CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** 生成一个短编号（默认 6 位），用于给用户引用/排查（如 RW3K9Q） */
export function genShortId(length = 6): string {
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; i < length; i++) out += CHARS[bytes[i] % CHARS.length];
  return out;
}
