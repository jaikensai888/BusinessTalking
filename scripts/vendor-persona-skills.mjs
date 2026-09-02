/** 把人格落地为 skill 文件（skill/personas/<slug>/SKILL.md），并回填 persona.skillPath */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const ROOT = process.cwd();
const BASE = path.join(ROOT, "skill", "personas");

async function main() {
  const personas = await prisma.persona.findMany({ select: { id: true, name: true, description: true, systemPrompt: true } });
  for (const p of personas) {
    const slug = p.id.replace("seed-persona-", "");
    const dir = path.join(BASE, slug);
    fs.mkdirSync(dir, { recursive: true });
    const md = `---\nname: ${slug}\ndescription: ${p.description ?? ""}\n---\n\n${p.systemPrompt}\n`;
    fs.writeFileSync(path.join(dir, "SKILL.md"), md, "utf8");
    const skillPath = `skill/personas/${slug}/SKILL.md`;
    await prisma.persona.update({ where: { id: p.id }, data: { skillPath } });
    console.log(`skill: ${skillPath} (${p.name})`);
  }
  console.log(`Done ${personas.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
