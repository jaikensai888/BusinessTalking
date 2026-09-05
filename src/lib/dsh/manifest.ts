import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DshManifestError } from "./errors";

/**
 * Runtime Session manifest（见 dsh-runtime-execution-plan.md §4.1）。
 * manifest 不保存 API key；DSH plugin 只读服务器已解析的 snapshot/packageRoot。
 */

export const ReferenceIndexSchema = z.object({
  rel: z.string(),
  name: z.string(),
  size: z.number(),
  hash: z.string(),
});

export const RuntimeProfileSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string().nullable().optional(),
  profileHash: z.string(),
});

export const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemPrompt: z.string(),
  skillName: z.string(), // 固定 persona-profile
  skillVersion: z.string(),
  skillHash: z.string(),
  snapshotRoot: z.string(),
  referenceIndex: z.array(ReferenceIndexSchema),
});

export const AllowedSkillSchema = z.object({
  name: z.string(),
  version: z.string(),
  contentHash: z.string(),
  packageRoot: z.string().nullable(),
  description: z.string().nullable(),
});

export const ToolPolicySchema = z.object({
  webSearch: z.boolean(),
  sideEffects: z.literal(false),
});

export const RuntimeSessionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string(),
  discussionId: z.string(),
  participantId: z.string().optional(),
  kind: z.enum(["persona", "moderator"]),
  runtimeProfile: RuntimeProfileSchema,
  persona: PersonaSchema.optional(),
  allowedSkills: z.array(AllowedSkillSchema),
  toolPolicy: ToolPolicySchema,
});

export type ReferenceIndex = z.infer<typeof ReferenceIndexSchema>;
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;
export type PersonaBlock = z.infer<typeof PersonaSchema>;
export type AllowedSkill = z.infer<typeof AllowedSkillSchema>;
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;
export type RuntimeSessionManifest = z.infer<typeof RuntimeSessionManifestSchema>;

/** manifest 落盘根目录 */
export function manifestsRoot(): string {
  return path.join(process.cwd(), "data", "dsh", "manifests");
}

/** 校验 sessionId 只含 URL-safe 字符（防路径注入）；返回安全的文件名 */
export function safeSessionFileName(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new DshManifestError("Session id 含非法字符，拒绝写入 manifest");
  }
  return `${sessionId}.json`;
}

function manifestPath(sessionId: string): string {
  return path.join(manifestsRoot(), safeSessionFileName(sessionId));
}

/** 严格解析并校验 manifest；失败抛 DshManifestError */
export function parseManifest(input: unknown): RuntimeSessionManifest {
  const res = RuntimeSessionManifestSchema.safeParse(input);
  if (!res.success) {
    throw new DshManifestError(`manifest 校验失败：${res.error.message}`);
  }
  return res.data;
}

/** 原子写入：临时文件 + rename（先写后名），避免读到半写文件 */
export function writeManifestAtomic(manifest: RuntimeSessionManifest): string {
  const finalPath = manifestPath(manifest.sessionId);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

/** 读取并校验 manifest；不存在或损坏抛 DshManifestError */
export function readManifest(sessionId: string): RuntimeSessionManifest {
  const p = manifestPath(sessionId);
  if (!fs.existsSync(p)) throw new DshManifestError(`manifest 不存在：${sessionId}`);
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return parseManifest(raw);
  } catch (e) {
    if (e instanceof DshManifestError) throw e;
    throw new DshManifestError(`manifest 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 删除 manifest（purge 用） */
export function deleteManifest(sessionId: string): void {
  try {
    const p = manifestPath(sessionId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
