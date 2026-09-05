/**
 * 一次性 backfill：为现有 Skill 创建 SkillRevision（不可变内容版本）。
 * 独立于 tsx 运行（本环境 sandbox 会终止 tsx）：自包含实现 hash/version 规则。
 * usage: node scripts/backfill-skill-revisions.mjs
 */
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function hashContent(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
function toKebabName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
function skillNameFor(name, contentHash) {
  return toKebabName(name) || `skill-${contentHash.slice(0, 12)}`;
}
function resolveVersion(requested, contentHash) {
  const trimmed = requested?.trim?.();
  if (trimmed && SEMVER_RE.test(trimmed)) return trimmed;
  return `0.0.0+${contentHash.slice(0, 12)}`;
}

async function main() {
  const skills = await prisma.skill.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      instructions: true,
      version: true,
      source: true,
      sourceRef: true,
    },
  });
  let created = 0;
  let skipped = 0;
  for (const s of skills) {
    if (!s.instructions?.trim()) {
      skipped++;
      continue;
    }
    const contentHash = hashContent(s.instructions);
    const name = skillNameFor(s.name, contentHash);
    const version = resolveVersion(s.version, contentHash);
    // 清理本 skill 遗留的旧 revision（含此前空名失败结果），再重建，保证幂等
    await prisma.skillRevision.deleteMany({ where: { skillId: s.id } });
    const existing = await prisma.skillRevision.findUnique({
      where: { name_contentHash: { name, contentHash } },
    });
    if (existing) {
      skipped++;
      continue;
    }
    try {
      await prisma.skillRevision.create({
        data: {
          skillId: s.id,
          name,
          version,
          contentHash,
          description: s.description ?? null,
          instructions: s.instructions,
          packageRoot: null, // 无不可变软件包：legacy，仅旧 Recipe 可用
          source: s.source ?? "manual",
          sourceRef: s.sourceRef ?? null,
          manifest: null,
          installedAt: new Date(),
        },
      });
      created++;
    } catch (e) {
      console.error(`backfill failed for ${s.name}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`backfill done: ${created} created, ${skipped} skipped (out of ${skills.length})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
