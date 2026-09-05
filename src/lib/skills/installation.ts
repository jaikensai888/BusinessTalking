import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";

/**
 * Skill Library 不可变安装服务。
 *
 * 规则（见 dsh-runtime-execution-plan.md §3.1 / §9）：
 * - Skill 保留为逻辑名与 Recipe 兼容记录；不可变正文/资源进入 SkillRevision。
 * - 安装包有合法 semver 时使用包或 SKILL.md 的 version；否则用 `0.0.0+<contentHash 前12位>`。
 * - 已存在相同 name/version 但 hash 不同，安装失败；不能覆盖旧版本。
 * - 所有资源（SKILL.md + references/ + examples/）复制到不可变版本目录。
 * - 全部写入成功后才把 revision 视为已安装（installedAt）。
 */

const LIBRARY_ROOT = () => path.join(process.cwd(), "data", "skill-library");

/** 合法 semver（1.0.0、0.0.0+abc、1.2.3-beta.1），用于判定可发布版本 */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** 完整 SKILL.md 的 sha256（hex） */
export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** kebab-case skill 名：去空格/下划线转小写连字符，非法字符去除 */
export function toKebabName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 生成稳定的 DSH skill 名：优先 kebab-case；中文等无法转 ASCII 时回退为
 * `skill-<contentHash 前12位>`，保证唯一且不落到空名。
 */
export function skillNameFor(name: string, contentHash: string): string {
  return toKebabName(name) || `skill-${contentHash.slice(0, 12)}`;
}

/** 解析版本：合法 semver 用之；否则 0.0.0+hash12 */
export function resolveVersion(requested: string | null | undefined, contentHash: string): string {
  const trimmed = requested?.trim();
  if (trimmed && SEMVER_RE.test(trimmed)) return trimmed;
  return `0.0.0+${contentHash.slice(0, 12)}`;
}

export type SkillSource = "builtin" | "npx" | "manual";

/** 一个待安装的不可变 skill bundle（SKILL.md 正文 + 资源目录清单） */
export interface SkillBundle {
  name: string;
  description?: string | null;
  content: string; // 完整 SKILL.md 正文
  version?: string | null; // 可选 semver
  source: SkillSource;
  sourceRef?: string | null;
  /** 资源文件相对路径列表（references/、examples/ 下的文件） */
  resources?: string[];
  /** 读取资源正文的回调；用于计算资源 hash 与复制 */
  readResource?: (rel: string) => string | null;
}

export interface InstalledResourceIndex {
  rel: string;
  name: string;
  kind: "reference" | "example";
  size: number;
  hash: string;
}

export interface SkillManifest {
  schematicVersion: 1;
  name: string;
  version: string;
  contentHash: string;
  source: SkillSource;
  sourceRef?: string | null;
  resources: InstalledResourceIndex[];
  installedAt: string;
}

/** 把 bundle 复制到不可变版本目录，返回 { packageRoot, manifest } */
export function persistBundle(
  bundle: SkillBundle,
  contentHash: string,
  version: string
): { packageRoot: string; manifest: SkillManifest } {
  const name = skillNameFor(bundle.name, contentHash);
  const root = path.join(LIBRARY_ROOT(), name, version);
  fs.mkdirSync(root, { recursive: true });

  // 写入 SKILL.md（完整正文）
  const skillMdPath = path.join(root, "SKILL.md");
  fs.writeFileSync(skillMdPath, bundle.content, "utf8");

  const resources: InstalledResourceIndex[] = [];
  for (const rel of bundle.resources ?? []) {
    const safeRel = normalizeInternalRel(rel);
    if (!safeRel) continue;
    const body = bundle.readResource ? bundle.readResource(safeRel) : null;
    if (body == null) continue;

    const dest = path.join(root, ...safeRel.split("/"));
    const destDir = path.dirname(dest);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, body, "utf8");
    resources.push({
      rel: safeRel,
      name: path.basename(safeRel),
      kind: safeRel.startsWith("examples/") ? "example" : "reference",
      size: Buffer.byteLength(body, "utf8"),
      hash: hashContent(body),
    });
  }

  const manifest: SkillManifest = {
    schematicVersion: 1,
    name,
    version,
    contentHash,
    source: bundle.source,
    sourceRef: bundle.sourceRef ?? null,
    resources,
    installedAt: new Date().toISOString(),
  };

  return { packageRoot: root, manifest };
}

/** 规范化内部资源相对路径：只允许 references/ 或 examples/ 下、不可穿越（fail-closed） */
export function normalizeInternalRel(rel: string): string | null {
  const normalized = rel.split("\\").join("/").replace(/^\.\//, "");
  if (!/^(references|examples)\//.test(normalized)) return null;
  const parts = normalized.split("/");
  // 任何 .. 段都直接拒绝（不允许穿越），而不是静默清洗
  if (parts.some((p) => p === "..")) return null;
  const safe = parts.filter((p) => p !== "" && p !== ".").join("/");
  if (!safe || !/^(references|examples)\//.test(safe)) return null;
  return safe;
}

/**
 * 安装一个 skill bundle：复制不可变文件 + 写入 Skill 与 SkillRevision。
 * 同 name/version 已存在但 hash 不同 → 抛错（不能覆盖旧版本）。
 */
export async function installSkillBundle(bundle: SkillBundle): Promise<{ skillId: string; revisionId: string }> {
  const contentHash = hashContent(bundle.content);
  const name = skillNameFor(bundle.name, contentHash);
  const version = resolveVersion(bundle.version, contentHash);

  const existing = await prisma.skillRevision.findUnique({
    where: { name_version: { name, version } },
  });
  if (existing && existing.contentHash !== contentHash) {
    throw new DshSkillError(
      `Skill ${name}@${version} 已存在但内容 hash 不同，不能覆盖旧版本`,
      "IMMUTABLE_SKILL_REVISION"
    );
  }

  const { packageRoot, manifest } = persistBundle(bundle, contentHash, version);

  let skill = await prisma.skill.findFirst({ where: { name } });
  if (!skill) {
    skill = await prisma.skill.create({
      data: {
        name,
        description: bundle.description ?? null,
        category: "通用",
        instructions: bundle.content,
        source: bundle.source,
        sourceRef: bundle.sourceRef ?? null,
        isBuiltin: bundle.source === "builtin",
      },
    });
  } else {
    skill = await prisma.skill.update({
      where: { id: skill.id },
      data: { source: bundle.source, sourceRef: bundle.sourceRef ?? null },
    });
  }

  const revision = await prisma.skillRevision.upsert({
    where: { name_contentHash: { name, contentHash } },
    update: {
      description: bundle.description ?? undefined,
      instructions: bundle.content,
      packageRoot,
      source: bundle.source,
      sourceRef: bundle.sourceRef ?? null,
      manifest: manifest as unknown as object,
      installedAt: new Date(),
    },
    create: {
      skillId: skill.id,
      name,
      version,
      contentHash,
      description: bundle.description ?? null,
      instructions: bundle.content,
      packageRoot,
      source: bundle.source,
      sourceRef: bundle.sourceRef ?? null,
      manifest: manifest as unknown as object,
      installedAt: new Date(),
    },
  });

  return { skillId: skill.id, revisionId: revision.id };
}

/** 为现有 Skill 增加一个 SkillRevision（backfill 用）：基于当前 instructions 与 source */
export async function backfillSkillRevision(skill: {
  id: string;
  name: string;
  description?: string | null;
  instructions: string;
  version?: string | null;
  source: string;
  sourceRef?: string | null;
}): Promise<{ created: boolean; revisionId: string }> {
  const contentHash = hashContent(skill.instructions);
  const name = skillNameFor(skill.name, contentHash);
  const version = resolveVersion(skill.version, contentHash);

  const existing = await prisma.skillRevision.findUnique({ where: { name_contentHash: { name, contentHash } } });
  if (existing) return { created: false, revisionId: existing.id };

  // 没有 packageRoot 的旧 manual skill 视为 legacy：不入库为可执行 revision
  const source = (skill.source as SkillSource) ?? "manual";

  const revision = await prisma.skillRevision.create({
    data: {
      skillId: skill.id,
      name,
      version,
      contentHash,
      description: skill.description ?? null,
      instructions: skill.instructions,
      packageRoot: null,
      source,
      sourceRef: skill.sourceRef ?? null,
      manifest: Prisma.DbNull,
      installedAt: new Date(),
    },
  });
  return { created: true, revisionId: revision.id };
}

export class DshSkillError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "DshSkillError";
    this.code = code;
  }
}
