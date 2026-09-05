import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DshManifestError } from "./errors";

/**
 * Runtime Session manifest（见 dsh-runtime-execution-plan.md §4.1）。
 * manifest 不保存 API key；DSH plugin 只读服务器已解析的 snapshot/packageRoot。
 *
 * P0 契约（见 dsh-p0-remediation-execution-plan.md Task 1）：
 *  - hash 必须是 64 位小写 hex（sha256）；
 *  - reference size 必须是 [0, 512 KiB] 的整数；
 *  - resource index 路径只允许 `references/` 或 `examples/` 前缀，禁止绝对路径/`..`；
 *  - persona 块与 allowedSkills 中的 persona-profile 必须完全一致；
 *  - moderator 不得有 persona，不得有普通 Skill，不得开 web_search；
 *  - 普通 Skill 必须有非空 packageRoot（安装过的不可变目录），名称唯一。
 */

/** 64 位小写 hex（sha256） */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
/** 单个 reference 文件上限（与 snapshot.ts 的 MAX_REF_BYTES 对齐） */
export const MAX_REFERENCE_BYTES = 512 * 1024;

/** resource index 相对路径：只允许 references/ 或 examples/ 前缀，禁绝对路径与 `..` */
export function isSafeReferenceRel(rel: string): boolean {
  if (!/^(references|examples)\//.test(rel)) return false;
  if (rel.includes("\\")) return false;
  if (rel.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) return false;
  return true;
}

export const ReferenceIndexEntrySchema = z.object({
  rel: z.string().refine(isSafeReferenceRel, {
    message: "reference rel 只允许 references/ 或 examples/ 下的相对路径",
  }),
  name: z.string().min(1),
  size: z.number().int().min(0).max(MAX_REFERENCE_BYTES),
  hash: z.string().regex(SHA256_HEX_RE, { message: "reference hash 必须是 64 位小写 hex" }),
});

export const ReferenceIndexSchema = z
  .array(ReferenceIndexEntrySchema)
  .refine((arr) => new Set(arr.map((r) => r.rel)).size === arr.length, {
    message: "reference index 不允许重复条目",
  })
  .refine((arr) => new Set(arr.map((r) => r.hash)).size === arr.length, {
    message: "reference index 不允许重复 hash",
  });

export const RuntimeProfileSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().nullable().optional(),
  profileHash: z.string().regex(SHA256_HEX_RE, { message: "profileHash 必须是 64 位小写 hex" }),
});

export const PersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  systemPrompt: z.string(),
  skillName: z.literal("persona-profile"),
  skillVersion: z.string().min(1),
  skillHash: z.string().regex(SHA256_HEX_RE, { message: "persona skillHash 必须是 64 位小写 hex" }),
  snapshotRoot: z.string().min(1),
  referenceIndex: ReferenceIndexSchema,
});

export const AllowedSkillSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  contentHash: z.string().regex(SHA256_HEX_RE, { message: "skill contentHash 必须是 64 位小写 hex" }),
  packageRoot: z.string().min(1), // 非空：必须指向安装过的不可变目录
  description: z.string().nullable(),
  resourceIndex: ReferenceIndexSchema,
});

export const ToolPolicySchema = z.object({
  webSearch: z.boolean(),
  sideEffects: z.literal(false),
});

export const RuntimeSessionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: z.string().min(1),
    discussionId: z.string().min(1),
    participantId: z.string().optional(),
    kind: z.enum(["persona", "moderator"]),
    runtimeProfile: RuntimeProfileSchema,
    persona: PersonaSchema.optional(),
    allowedSkills: z.array(AllowedSkillSchema),
    toolPolicy: ToolPolicySchema,
  })
  .superRefine((m, ctx) => {
    const add = (msg: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });

    // allowedSkills 名称唯一，且普通 Skill 不得覆盖 persona-profile
    const names = m.allowedSkills.map((s) => s.name);
    if (new Set(names).size !== names.length) {
      add("allowedSkills 名称必须唯一");
    }

    if (m.kind === "persona") {
      if (!m.participantId) add("persona manifest 必须有 participantId");
      if (!m.persona) {
        add("persona manifest 必须有 persona 块");
      } else {
        const profile = m.allowedSkills.filter((s) => s.name === m.persona?.skillName);
        if (profile.length !== 1) {
          add(`allowedSkills 必须包含唯一的 ${m.persona.skillName}`);
        } else {
          const p = profile[0];
          if (p.version !== m.persona.skillVersion) add("persona-profile version 与 persona 不一致");
          if (p.contentHash !== m.persona.skillHash) add("persona-profile contentHash 与 persona 不一致");
          if (p.packageRoot !== m.persona.snapshotRoot) add("persona-profile packageRoot 与 persona 不一致");
        }
        // 不允许普通 Skill 覆盖 persona-profile（唯一性由上面覆盖）
      }
    } else {
      // moderator
      if (m.persona) add("moderator manifest 不得有 persona");
      if (m.allowedSkills.length !== 0) add("moderator manifest 的 allowedSkills 必须为空");
      if (m.toolPolicy.webSearch) add("moderator manifest 不得开启 web_search");
    }
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
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) {
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
