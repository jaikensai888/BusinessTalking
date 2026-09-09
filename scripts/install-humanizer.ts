/**
 * 一次性脚本：把导入产物 humanizer 直接安装进 Skill Library（DB + 不可变目录）。
 * 背景：ImportJob 是内存态，dev server 重启后 UI 无法再 confirm；此脚本走与
 * confirm API 相同的 installSkillBundle 链路，效果一致。
 * 用法：npx tsx --env-file=.env scripts/install-humanizer.ts
 */
import fs from "node:fs";
import path from "node:path";
import { installSkillBundle } from "../src/lib/skills/installation";
import { prisma } from "../src/lib/db";
import { hashContent } from "../src/lib/skills/installation";

const SRC = "data/imports/d43fe0ca-3b20-411d-ba1c-eb2507c8f31f/humanizer/SKILL.md";

async function main() {
  const raw = fs.readFileSync(path.resolve(process.cwd(), SRC), "utf8");
  // 剥 frontmatter（parseSkillFile 对多行块描述解析不完整，这里手动只取正文）
  const body = raw.startsWith("---")
    ? raw.slice(raw.indexOf("\n---", 3) + 4).trim()
    : raw.trim();
  if (!body) throw new Error("SKILL.md 正文为空");

  const contentHash = hashContent(body);
  const result = await installSkillBundle({
    name: "humanizer",
    description:
      "Rewrite AI-sounding text so it reads like a person wrote it, without changing what it says. Source: https://github.com/blader/humanizer",
    content: body,
    source: "npx",
    sourceRef: "https://github.com/blader/humanizer",
  });

  console.log("installed:", { ...result, contentHash: contentHash.slice(0, 12) });
  const rev = await prisma.skillRevision.findUnique({ where: { id: result.revisionId } });
  console.log("revision:", {
    name: rev?.name,
    version: rev?.version,
    packageRoot: rev?.packageRoot,
    installedAt: rev?.installedAt,
  });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
