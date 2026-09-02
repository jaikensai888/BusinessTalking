/**
 * 验证 API Key 密文落库（不应包含明文 "sk-test-fake-key"）
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const row = await prisma.setting.findUnique({ where: { key: "llm.apiKey" } });
  if (!row) {
    console.log("FAIL: llm.apiKey setting not found");
    return;
  }
  const value = row.value;
  const looksEncrypted = /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(value);
  const containsPlaintext = value.includes("sk-test-fake-key");
  console.log(`encrypted format: ${looksEncrypted}`);
  console.log(`plaintext leaked: ${containsPlaintext}`);
  console.log(`value prefix: ${value.slice(0, 40)}...`);
  console.log(`RESULT: ${looksEncrypted && !containsPlaintext ? "PASS" : "FAIL"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
