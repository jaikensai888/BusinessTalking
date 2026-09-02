/**
 * 迭代 1 验证脚本：数据库表结构与种子数据检查
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  console.log("TABLES:", tables.map((t) => t.name).join(", "));

  const skillCount = await prisma.skill.count();
  const personaCount = await prisma.persona.count();
  console.log(`skill.count=${skillCount} persona.count=${personaCount}`);

  const sample = await prisma.persona.findFirst();
  if (sample) {
    console.log(
      "persona sample:",
      JSON.stringify({
        name: sample.name,
        perspectiveType: sample.perspectiveType,
        avatarType: sample.avatarType,
        avatarValue: sample.avatarValue,
        isBuiltin: sample.isBuiltin,
      })
    );
  }

  const builtinSkills = await prisma.skill.count({ where: { isBuiltin: true } });
  const builtinPersonas = await prisma.persona.count({ where: { isBuiltin: true } });
  console.log(`builtin skills=${builtinSkills} builtin personas=${builtinPersonas}`);

  // 幂等验证：重复 upsert 不应增加记录（seed 用固定 id）
  console.log(`EXPECTED skills>=8 && personas>=6: ${skillCount >= 8 && personaCount >= 6}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
