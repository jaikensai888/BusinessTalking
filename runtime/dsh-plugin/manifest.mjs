/**
 * BusinessTalking DSH plugin —— manifest/path/hash 纯 helper（P0 Task 2/3）。
 *
 * 只读参与：不写文件、不扫 workspace、不访问外部服务。
 * - loadManifest(sessionId)：只接受显式 sessionId，从项目 `data/dsh/manifests/<sessionId>.json`
 *   读取并做最小结构校验（严格 schema 校验在 TS 侧 parseManifest；此处做运行时 fail-closed）。
 * - 路径边界：snapshot 必须在 `data/dsh/snapshots`、packageRoot 必须在 `data/skill-library` 或
 *   `data/dsh/snapshots` 内；使用 path.resolve + path.relative + realpath，拒绝 symlink/逃逸。
 * - 所有 hash 均为 sha256 64 位小写 hex。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
export const MAX_REFERENCE_BYTES = 512 * 1024;
export const MAX_SKILL_BYTES = 256 * 1024;

/** 只允许 URL-safe 的 session 文件名（与 TS 侧 safeSessionFileName 一致） */
export function isSafeSessionId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(id);
}

export function manifestsRoot(cwd) {
  return path.join(cwd, "data", "dsh", "manifests");
}

/** 只允许 references/ examples/ 前缀的相对路径，禁绝对路径、`..`、反斜杠 */
export function isSafeReferenceRel(rel) {
  if (typeof rel !== "string") return false;
  if (!/^(references|examples)\//.test(rel)) return false;
  if (rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== ".." && seg !== "." && seg !== "");
}

/** realpath（不存在时回退 resolve），用于 symlink 检测 */
export function realpathSafe(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** 判断 child 是否位于 parent 之内（含 parent 本身）；path.relative 边界检查 */
export function isWithin(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export class ManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ManifestError";
    this.code = code;
  }
}

function fail(message) {
  throw new ManifestError("DSH_MANIFEST_INVALID", message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} 必须是非空字符串`);
  return value;
}

function requireHash(value, label) {
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
    fail(`${label} 必须是 64 位小写 hex`);
  }
  return value;
}

function validateResourceIndex(cwd, root, index, owner) {
  if (!Array.isArray(index)) fail(`${owner} 缺少 resourceIndex`);
  const seenRel = new Set();
  const seenHash = new Set();
  for (const [position, raw] of index.entries()) {
    if (!isObject(raw)) fail(`${owner} resourceIndex 第 ${position + 1} 项非法`);
    const rel = raw.rel;
    const name = raw.name;
    const size = raw.size;
    const hash = raw.hash;
    if (typeof rel !== "string" || !isSafeReferenceRel(rel) || !rel.toLowerCase().endsWith(".md")) {
      fail(`${owner} resource 路径非法：${String(rel)}`);
    }
    if (typeof name !== "string" || !name) fail(`${owner} resource name 非法：${rel}`);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_REFERENCE_BYTES) {
      fail(`${owner} resource size 非法：${rel}`);
    }
    requireHash(hash, `${owner} resource hash`);
    if (seenRel.has(rel) || seenHash.has(hash)) fail(`${owner} resourceIndex 存在重复条目：${rel}`);
    seenRel.add(rel);
    seenHash.add(hash);
    const body = readVerifiedFile(root, rel, hash, cwd, MAX_REFERENCE_BYTES);
    if (Buffer.byteLength(body, "utf8") !== size) fail(`${owner} resource size 不匹配：${rel}`);
  }
}

function validateAllowedSkill(cwd, entry) {
  if (!isObject(entry)) fail("allowedSkills 存在非法条目");
  requireString(entry.name, "Skill name");
  requireString(entry.version, `Skill ${entry.name} version`);
  requireHash(entry.contentHash, `Skill ${entry.name} contentHash`);
  const root = resolveRoot(cwd, requireString(entry.packageRoot, `Skill ${entry.name} packageRoot`), "skill");
  readVerifiedFile(root, "SKILL.md", entry.contentHash, cwd, MAX_SKILL_BYTES);
  validateResourceIndex(cwd, root, entry.resourceIndex, `Skill ${entry.name}`);
}

function validateManifest(cwd, manifest, sessionId) {
  if (!isObject(manifest)) fail("manifest 必须是对象");
  if (manifest.schemaVersion !== 1) fail("manifest schemaVersion 必须为 1");
  if (manifest.sessionId !== sessionId) fail("manifest sessionId 与请求不一致");
  requireString(manifest.discussionId, "manifest discussionId");
  if (manifest.kind !== "persona" && manifest.kind !== "moderator") fail("manifest kind 非法");

  const profile = manifest.runtimeProfile;
  if (!isObject(profile)) fail("manifest 缺少 runtimeProfile");
  requireString(profile.provider, "runtimeProfile.provider");
  requireString(profile.model, "runtimeProfile.model");
  requireHash(profile.profileHash, "runtimeProfile.profileHash");

  const policy = manifest.toolPolicy;
  if (!isObject(policy) || policy.sideEffects !== false || policy.webSearch !== false) {
    fail("P0 manifest 必须关闭 sideEffects 和 web_search");
  }

  if (!Array.isArray(manifest.allowedSkills)) fail("allowedSkills 必须是数组");
  const names = new Set();
  for (const entry of manifest.allowedSkills) {
    if (!isObject(entry) || typeof entry.name !== "string") fail("allowedSkills 存在非法条目");
    if (names.has(entry.name)) fail(`allowedSkills 名称重复：${entry.name}`);
    names.add(entry.name);
  }

  if (manifest.kind === "moderator") {
    if (manifest.persona !== undefined && manifest.persona !== null) fail("moderator manifest 不得有 persona");
    if (manifest.allowedSkills.length !== 0) fail("moderator manifest 的 allowedSkills 必须为空");
    return;
  }

  if (!requireString(manifest.participantId, "persona manifest participantId")) return;
  const persona = manifest.persona;
  if (!isObject(persona)) fail("persona manifest 缺少 persona");
  if (persona.skillName !== "persona-profile") fail("persona skillName 必须为 persona-profile");
  requireString(persona.id, "persona.id");
  requireString(persona.name, "persona.name");
  if (typeof persona.systemPrompt !== "string") fail("persona.systemPrompt 必须是字符串");
  requireString(persona.skillVersion, "persona.skillVersion");
  requireHash(persona.skillHash, "persona.skillHash");
  const snapshotRoot = resolveRoot(cwd, requireString(persona.snapshotRoot, "persona.snapshotRoot"), "snapshot");
  readVerifiedFile(snapshotRoot, "SKILL.md", persona.skillHash, cwd, MAX_SKILL_BYTES);
  validateResourceIndex(cwd, snapshotRoot, persona.referenceIndex, "persona");

  const profileEntries = manifest.allowedSkills.filter((entry) => isObject(entry) && entry.name === "persona-profile");
  if (profileEntries.length !== 1) fail("allowedSkills 必须包含唯一 persona-profile");
  const profileEntry = profileEntries[0];
  if (profileEntry.version !== persona.skillVersion || profileEntry.contentHash !== persona.skillHash || profileEntry.packageRoot !== persona.snapshotRoot) {
    fail("persona-profile 与 persona 块不一致");
  }
  if (JSON.stringify(profileEntry.resourceIndex) !== JSON.stringify(persona.referenceIndex)) {
    fail("persona-profile resourceIndex 与 persona 不一致");
  }
  for (const entry of manifest.allowedSkills) {
    if (entry.name !== "persona-profile") validateAllowedSkill(cwd, entry);
  }
}

/** 按当前 manifest 声明的根目录做边界检查；越界抛 ManifestError('DSH_MANIFEST_INVALID') */
export function assertPathWithin(manifest, cwd, fieldPath, rootCandidates) {
  const value = fieldPath; // 已 resolve 的绝对路径
  const ok = rootCandidates.some((root) => {
    const realRoot = realpathSafe(path.resolve(cwd, root));
    return isWithin(realRoot, realpathSafe(value));
  });
  if (!ok) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `manifest 路径越界：${value}`);
  }
  return value;
}

/**
 * 读取 manifest（fail-closed）。缺 sessionId → 抛错；文件缺失/JSON 损坏/结构不合法 → 抛错。
 * 子进程边界内重新执行完整的运行时校验，不能信任调用方是否经过 TS writer。
 */
export function loadManifest(cwd, sessionId) {
  if (!isSafeSessionId(sessionId)) {
    throw new ManifestError("DSH_MANIFEST_INVALID", "DSH session id 非法");
  }
  const file = path.join(manifestsRoot(cwd), `${sessionId}.json`);
  if (!fs.existsSync(file)) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `未找到 manifest：${sessionId}`);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `manifest 损坏：${e.message}`);
  }
  const m = raw ?? {};
  validateManifest(cwd, m, sessionId);
  return m;
}

/** 读取并验证 snapshot/packageRoot 下某文件的 sha256；与 manifest 中声明 hash 一致才返回 */
export function readVerifiedFile(rootDir, relPath, sha256Hex, cwd, sizeLimit = MAX_REFERENCE_BYTES, expectedSize) {
  requireHash(sha256Hex, "文件 hash");
  const full = path.resolve(rootDir, relPath);
  if (!isWithin(realpathSafe(rootDir), realpathSafe(full))) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `读取路径越界：${relPath}`);
  }
  if (!fs.existsSync(full)) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `文件不存在：${relPath}`);
  }
  const body = fs.readFileSync(full, "utf8");
  const size = Buffer.byteLength(body, "utf8");
  if (size > sizeLimit) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `文件超过大小上限：${relPath}`);
  }
  if (expectedSize !== undefined && size !== expectedSize) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `文件 size 不匹配：${relPath}`);
  }
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  if (hash !== sha256Hex) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `hash 不匹配：${relPath}`);
  }
  return body;
}

/** 从 manifest 的某个 allowed entry 定位到 root 目录（返回绝对路径），并做边界校验 */
export function resolveEntryRoot(cwd, manifest, entry) {
  if (!entry.packageRoot) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `Skill ${entry?.name ?? "?"} 缺少 packageRoot`);
  }
  return resolveRoot(cwd, entry.packageRoot, "skill");
}

/** packageRoot/snapshotRoot → 绝对路径 + realpath 边界校验，并区分资源根类型。 */
export function resolveRoot(cwd, root, kind = "any") {
  if (typeof root !== "string" || !root.trim()) {
    throw new ManifestError("DSH_MANIFEST_INVALID", "Skill root 必须是非空字符串");
  }
  const abs = path.resolve(cwd, root);
  if (!fs.existsSync(abs)) throw new ManifestError("DSH_MANIFEST_INVALID", `Skill root 不存在：${root}`);
  if (!fs.statSync(abs).isDirectory()) throw new ManifestError("DSH_MANIFEST_INVALID", `Skill root 不是目录：${root}`);
  const candidates = kind === "skill"
    ? [path.resolve(cwd, "data", "skill-library")]
    : kind === "snapshot"
      ? [path.resolve(cwd, "data", "dsh", "snapshots")]
      : [
          path.resolve(cwd, "data", "skill-library"),
          path.resolve(cwd, "data", "dsh", "snapshots"),
        ];
  const realAbs = realpathSafe(abs);
  const ok = candidates.some((base) => isWithin(realpathSafe(base), realAbs));
  if (!ok) {
    throw new ManifestError("DSH_MANIFEST_INVALID", `Skill root 越界：${root}`);
  }
  return realAbs;
}

/** packageRoot 只允许项目内 data/skill-library 或 data/dsh/snapshots（含子目录） */
export function isSafeReferenceRoot(packageRoot) {
  if (typeof packageRoot !== "string") return false;
  const normalized = packageRoot.replace(/\\/g, "/");
  return (
    normalized.startsWith("data/skill-library/") ||
    normalized.startsWith("data/dsh/snapshots/") ||
    normalized === "data/skill-library" ||
    normalized === "data/dsh/snapshots"
  );
}
