/** 检查 Persona 表结构（纯 JS） */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const r = await prisma.$queryRawUnsafe("PRAGMA table_info('Persona')");
  console.log("columns:", r.map((c) => c.name).join(", "));
  const cnt = await prisma.persona.count();
  console.log("persona count:", cnt);
  const first = await prisma.persona.findFirst({ select: { id: true, name: true, skillPath: true } });
  console.log("sample:", JSON.stringify(first));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
