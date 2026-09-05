import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DshManifestError } from "./errors";

/**
 * Persona snapshot（见 dsh-runtime-execution-plan.md §4.2）。
 * 首次对一个 participant 调用 DSH 前执行：把 Persona 的 systemPrompt、SKILL.md 与
 * references/ 目录冻结为不可变快照，仅把 core SKILL.md 正文放入人格块，references
 * 只建索引、不 eager 读正文。
 */

const MAX_SKILL_BYTES = 256 * 1024; // SKILL.md ≤ 256 KiB
const MAX_REF_BYTES = 512 * 1024; // 单个 reference ≤ 512 KiB
const MAX_TOTAL_BYTES = 8 * 1024 * 1024; // 快照总大小 ≤ 8 MiB

/** 只允许 .md 与目录元数据；快照根必须位于允许的 persona root 内 */
function allowedRefExt(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export interface SnapshotReferenceIndex {
  rel: string;
  name: string;
  size: number;
  hash: string;
}

export interface PersonaSnapshot {
  systemPrompt: string;
  skillName: string; // persona-profile
  skillVersion: string;
  skillHash: string; // SKILL.md 完整 hash
  snapshotRoot: string;
  referenceIndex: SnapshotReferenceIndex[];
}

export interface PersonaSource {
  id: string;
  name: string;
  systemPrompt: string;
  skillPath: string | null; // 相对 cwd 的 SKILL.md 路径
  /** 显式版本号（用于 persona skill），缺省用 hash 派生 */
  skillVersion?: string | null;
}

function snapshotsRoot(): string {
  return path.join(process.cwd(), "data", "dsh", "snapshots");
}

function resolveCwd(p: string): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), p);
}

/**
 * 确保 Persona snapshot 存在。
 * 幂等：同一 (personaId, skillHash) 只建一次；若已存在则直接返回。
 */
export function ensurePersonaSnapshot(persona: PersonaSource): PersonaSnapshot {
  if (!persona.skillPath) {
    throw new DshManifestError(`Persona ${persona.name} 缺少 skillPath，无法生成人格快照`);
  }
  const skillAbs = resolveCwd(persona.skillPath);
  if (!fs.existsSync(skillAbs)) {
    throw new DshManifestError(`Persona SKILL.md 不存在：${persona.skillPath}`);
  }
  const stat = fs.statSync(skillAbs);
  if (stat.size > MAX_SKILL_BYTES) {
    throw new DshManifestError(`Persona SKILL.md 超过 256 KiB 上限`);
  }
  const skillContent = fs.readFileSync(skillAbs, "utf8");
  const skillHash = hashContent(skillContent);

  const baseDir = path.dirname(skillAbs);
  const version =
    persona.skillVersion?.trim() || (skillHash.length >= 12 ? `0.0.0+${skillHash.slice(0, 12)}` : skillHash);
  const name = path.basename(path.dirname(skillAbs)) || "persona";

  // snapshot 目录：data/dsh/snapshots/<personaId>-<hash12>
  const snapshotRoot = path.join(snapshotsRoot(), `${persona.id}-${skillHash.slice(0, 12)}`);
  const skillMdPath = path.join(snapshotRoot, "SKILL.md");

  // 幂等：快照已存在且 hash 一致则直接复用（用已落盘的 SKILL.md 校验）
  if (fs.existsSync(skillMdPath) && hashContent(fs.readFileSync(skillMdPath, "utf8")) === skillHash) {
    const referenceIndex = indexReferences(persona.id, snapshotRoot, baseDir);
    return {
      systemPrompt: persona.systemPrompt,
      skillName: "persona-profile",
      skillVersion: version,
      skillHash,
      snapshotRoot,
      referenceIndex,
    };
  }

  fs.mkdirSync(snapshotRoot, { recursive: true });
  fs.writeFileSync(skillMdPath, skillContent, "utf8");

  // 复制 references/ 与 examples/ 下的 .md，并建立索引（只复制，不读入 prompt）
  let total = stat.size;
  const referenceIndex: SnapshotReferenceIndex[] = [];
  for (const kind of ["references", "examples"] as const) {
    const srcDir = path.join(/* turbopackIgnore: true */ baseDir, kind);
    if (!fs.existsSync(/* turbopackIgnore: true */ srcDir)) continue;
    walkCopy(srcDir, kind, snapshotRoot, referenceIndex, (n) => (total += n));
    if (total > MAX_TOTAL_BYTES) {
      throw new DshManifestError(`Persona 快照总大小超过 8 MiB`);
    }
  }

  return {
    systemPrompt: persona.systemPrompt,
    skillName: "persona-profile",
    skillVersion: version,
    skillHash,
    snapshotRoot,
    referenceIndex,
  };
}

function walkCopy(
  srcDir: string,
  kindPrefix: string,
  snapshotRoot: string,
  index: SnapshotReferenceIndex[],
  addSize: (n: number) => void
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(srcDir, e.name);
    const rel = `${kindPrefix}/${e.name}`;
    if (e.isDirectory()) {
      walkCopy(full, rel, snapshotRoot, index, addSize);
    } else if (e.isFile() && allowedRefExt(e.name)) {
      const body = fs.readFileSync(full, "utf8");
      if (Buffer.byteLength(body, "utf8") > MAX_REF_BYTES) {
        throw new DshManifestError(`reference ${rel} 超过 512 KiB 上限`);
      }
      const dest = path.join(snapshotRoot, ...rel.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body, "utf8");
      const size = Buffer.byteLength(body, "utf8");
      addSize(size);
      index.push({ rel, name: e.name, size, hash: hashContent(body) });
    }
  }
}

/** 重新扫描已落盘快照的 reference 索引（幂等复用快照时调用） */
function indexReferences(_personaId: string, snapshotRoot: string, _baseDir: string): SnapshotReferenceIndex[] {
  const index: SnapshotReferenceIndex[] = [];
  const collect = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = `${prefix}/${e.name}`;
      if (e.isDirectory()) collect(full, rel);
      else if (e.isFile()) {
        const body = fs.readFileSync(full, "utf8");
        index.push({ rel, name: e.name, size: Buffer.byteLength(body, "utf8"), hash: hashContent(body) });
      }
    }
  };
  collect(path.join(snapshotRoot, "references"), "references");
  collect(path.join(snapshotRoot, "examples"), "examples");
  return index;
}
