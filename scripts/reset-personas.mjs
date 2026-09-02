/** 清空人格库（默认人格全部删除），用于替换为 nuwa 人物视角人格 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const del = await prisma.persona.deleteMany();
  console.log(`Deleted ${del.count} personas (conversations cascade)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
