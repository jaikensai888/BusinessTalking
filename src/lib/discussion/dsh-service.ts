/**
 * 1v1 DSH 讨论 service（见方案 §7）。把「一次提问 → 独立 DSH 回合 → 消息投影」串起来。
 * 每个回合使用自己的 session manifest，确保 DSH 插件读取到当前讨论的人格 Skill。
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensurePersonaSnapshot, type PersonaSnapshot } from "@/lib/dsh/snapshot";
import {
  isSafeReferenceRel,
  MAX_REFERENCE_BYTES,
  parseManifest,
  SHA256_HEX_RE,
  writeManifestAtomic,
  type RuntimeSessionManifest,
} from "@/lib/dsh/manifest";
import { getDiscussionSessionManager, getDshTurnConfig } from "@/lib/runtime/singleton";
import { acquireDiscussionRun, releaseDiscussionRun } from "./run-lease";
import { publish } from "./broadcast";
import { runDiscussionDshTurn } from "./run-dsh-turn";
import { DiscussionArchivedError, DshError, DshManifestError } from "@/lib/dsh/errors";

/** 从 DB 读取 Persona 源（供快照） */
async function loadPersonaSource(personaId: string) {
  const persona = await prisma.persona.findUnique({ where: { id: personaId } });
  if (!persona) throw new Error(`Persona 不存在：${personaId}`);
  return {
    id: persona.id,
    name: persona.name,
    systemPrompt: persona.systemPrompt,
    skillPath: persona.skillPath ?? null,
  };
}

/** 确保 participant 存在且首次会话（生成稳定 dshSessionId） */
export async function ensureParticipant(discussionId: string, personaId: string) {
  const existing = await prisma.discussionParticipant.findUnique({
    where: { discussionId_personaId: { discussionId, personaId } },
  });
  if (existing) return existing;
  const dshSessionId = `bt-discussion-${discussionId}-${personaId}`;
  return prisma.discussionParticipant.create({
    data: { discussionId, personaId, dshSessionId, status: "pending" },
  });
}

/** 当前 Discussion 锁定的普通 Skill revisions（allowlist；创建时确定、不可变） */
async function loadDiscussionSkills(discussionId: string) {
  const rows = await prisma.discussionSkill.findMany({
    where: { discussionId },
    include: { skillRevision: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.skillRevision);
}

async function loadDiscussionPermissions(discussionId: string): Promise<{ mode: "read-only"; approvalPolicy: "ask" | "never" }> {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    select: { permissionMode: true, approvalPolicy: true },
  });
  const mode = discussion?.permissionMode ?? "read-only";
  const approvalPolicy = discussion?.approvalPolicy ?? "ask";
  if (mode !== "read-only") {
    throw new DshManifestError(`Discussion ${discussionId} permissionMode 必须是 read-only`);
  }
  if (approvalPolicy !== "ask" && approvalPolicy !== "never") {
    throw new DshManifestError(`Discussion ${discussionId} approvalPolicy 非法`);
  }
  return { mode, approvalPolicy };
}

const MAX_SKILL_BYTES = 256 * 1024;

function dshManifestFailure(message: string): never {
  throw new DshManifestError(message);
}

function realpathOrFail(target: string, label: string): string {
  try {
    return fs.realpathSync.native(/* turbopackIgnore: true */ target);
  } catch {
    return dshManifestFailure(`${label} 不存在或不可解析：${target}`);
  }
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveInstalledSkillRoot(packageRoot: string | null, skillName: string): string {
  if (typeof packageRoot !== "string" || !packageRoot.trim()) {
    return dshManifestFailure(`Skill ${skillName} revision 缺少 packageRoot（未安装，不可执行）`);
  }
  const libraryRoot = realpathOrFail(path.join(process.cwd(), "data", "skill-library"), "Skill library");
  const root = realpathOrFail(path.resolve(/* turbopackIgnore: true */ process.cwd(), packageRoot), `Skill ${skillName} packageRoot`);
  if (!isWithin(libraryRoot, root) || !fs.statSync(/* turbopackIgnore: true */ root).isDirectory()) {
    return dshManifestFailure(`Skill ${skillName} packageRoot 不在 data/skill-library 内`);
  }
  return root;
}

function readVerifiedInstalledFile(
  root: string,
  relativePath: string,
  expectedHash: string,
  maxBytes: number,
  expectedSize?: number
): string {
  if (!SHA256_HEX_RE.test(expectedHash)) {
    return dshManifestFailure(`Skill 资源 hash 非法：${relativePath}`);
  }
  const candidate = path.resolve(/* turbopackIgnore: true */ root, relativePath);
  const realRoot = realpathOrFail(root, "Skill packageRoot");
  const realFile = realpathOrFail(candidate, `Skill 文件 ${relativePath}`);
  if (!isWithin(realRoot, realFile)) {
    return dshManifestFailure(`Skill 文件路径越界：${relativePath}`);
  }
  if (!fs.statSync(/* turbopackIgnore: true */ realFile).isFile()) {
    return dshManifestFailure(`Skill 文件不是普通文件：${relativePath}`);
  }
  const body = fs.readFileSync(/* turbopackIgnore: true */ realFile, "utf8");
  const size = Buffer.byteLength(body, "utf8");
  if (size > maxBytes) {
    return dshManifestFailure(`Skill 文件超过大小上限：${relativePath}`);
  }
  if (expectedSize !== undefined && size !== expectedSize) {
    return dshManifestFailure(`Skill 资源 size 不匹配：${relativePath}`);
  }
  const actualHash = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  if (actualHash !== expectedHash) {
    return dshManifestFailure(`Skill 文件 hash 不匹配：${relativePath}`);
  }
  return body;
}

function verifyRevisionResources(
  root: string,
  skillName: string,
  manifest: unknown
): RuntimeSessionManifest["allowedSkills"][number]["resourceIndex"] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return dshManifestFailure(`Skill ${skillName} 缺少可验证的 resource index`);
  }
  const resources = (manifest as { resources?: unknown }).resources;
  if (!Array.isArray(resources)) {
    return dshManifestFailure(`Skill ${skillName} 缺少可验证的 resource index`);
  }
  const seenRel = new Set<string>();
  const seenHash = new Set<string>();
  return resources.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return dshManifestFailure(`Skill ${skillName} resource index 第 ${index + 1} 项非法`);
    }
    const resource = raw as { rel?: unknown; name?: unknown; size?: unknown; hash?: unknown };
    const rel = resource.rel;
    const name = resource.name;
    const size = resource.size;
    const hash = resource.hash;
    if (typeof rel !== "string" || !isSafeReferenceRel(rel) || !rel.toLowerCase().endsWith(".md")) {
      return dshManifestFailure(`Skill ${skillName} resource 路径非法：${String(rel)}`);
    }
    if (typeof name !== "string" || !name) {
      return dshManifestFailure(`Skill ${skillName} resource name 非法：${rel}`);
    }
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || size > MAX_REFERENCE_BYTES) {
      return dshManifestFailure(`Skill ${skillName} resource size 非法：${rel}`);
    }
    if (typeof hash !== "string" || !SHA256_HEX_RE.test(hash)) {
      return dshManifestFailure(`Skill ${skillName} resource hash 非法：${rel}`);
    }
    if (seenRel.has(rel) || seenHash.has(hash)) {
      return dshManifestFailure(`Skill ${skillName} resource index 存在重复条目：${rel}`);
    }
    seenRel.add(rel);
    seenHash.add(hash);
    readVerifiedInstalledFile(root, rel, hash, MAX_REFERENCE_BYTES, size);
    return { rel, name, size, hash };
  });
}

/**
 * 把 SkillRevision 转换为 manifest 的 allowed entry；缺 packageRoot/body/hash 抛错，
 * 不回退到 Skill.instructions、旧 Skill 表或 workspace 文件。
 */
function revisionToAllowedEntry(rev: {
  name: string;
  version: string;
  contentHash: string;
  description: string | null;
  packageRoot: string | null;
  manifest: unknown;
}): RuntimeSessionManifest["allowedSkills"][number] {
  const packageRoot = resolveInstalledSkillRoot(rev.packageRoot, rev.name);
  readVerifiedInstalledFile(packageRoot, "SKILL.md", rev.contentHash, MAX_SKILL_BYTES);
  const resourceIndex = verifyRevisionResources(packageRoot, rev.name, rev.manifest);
  return {
    name: rev.name,
    version: rev.version,
    contentHash: rev.contentHash,
    packageRoot,
    description: rev.description,
    resourceIndex,
  };
}

/** 构建 Persona 的 RuntimeSessionManifest（keyed 到指定 sessionId，异步读取当前 Discussion allowlist）。 */
export async function buildPersonaManifest(
  discussionId: string,
  participant: { id: string; dshSessionId: string },
  persona: { id: string; name: string; systemPrompt: string },
  snapshot: PersonaSnapshot,
  sessionId: string,
  runtime: { provider: string; model: string; baseUrl?: string | null; profileHash: string } = {
    provider: "openai",
    model: "unset",
    profileHash: "unset",
  }
): Promise<RuntimeSessionManifest> {
  const revisions = await loadDiscussionSkills(discussionId);
  const permissions = await loadDiscussionPermissions(discussionId);
  const allowlist: RuntimeSessionManifest["allowedSkills"] = [
    {
      name: "persona-profile",
      version: snapshot.skillVersion,
      contentHash: snapshot.skillHash,
      packageRoot: snapshot.snapshotRoot,
      description: `Persona: ${persona.name}`,
      resourceIndex: snapshot.referenceIndex,
    },
    ...revisions.map((rev) => revisionToAllowedEntry(rev)),
  ];
  // 名称唯一性（普通 Skill 不得覆盖 persona-profile；DB 有 @unique 约束但这里显式 fail-closed）
  const names = allowlist.map((s) => s.name);
  if (new Set(names).size !== names.length) {
    throw new DshManifestError(
      `Discussion ${discussionId} 的 Skill allowlist 存在重复名称：${names.join(", ")}`
    );
  }
  return {
    schemaVersion: 1,
    sessionId,
    discussionId,
    participantId: participant.id,
    kind: "persona",
    runtimeProfile: {
      provider: runtime.provider,
      model: runtime.model,
      baseUrl: runtime.baseUrl ?? null,
      profileHash: runtime.profileHash,
    },
    persona: {
      id: persona.id,
      name: persona.name,
      systemPrompt: persona.systemPrompt,
      skillName: "persona-profile",
      skillVersion: snapshot.skillVersion,
      skillHash: snapshot.skillHash,
      snapshotRoot: snapshot.snapshotRoot,
      referenceIndex: snapshot.referenceIndex,
    },
    allowedSkills: allowlist,
    // web_search 是人格 Session 的只读能力；真正执行前由 DSH approval/request 询问用户。
    toolPolicy: { webSearch: true, sideEffects: false },
    permissions,
  };
}

/** 为一个 DSH 回合确保 Persona 快照 + 写入匹配的 Session manifest */
export async function ensurePersonaSession(discussionId: string, personaId: string) {
  const participant = await ensureParticipant(discussionId, personaId);
  const persona = await loadPersonaSource(personaId);
  const snapshot = ensurePersonaSnapshot(persona);

  // 真实 runtime profile（provider/model/baseUrl/profileHash）；打不开凭据时提前失败
  const config = await getDshTurnConfig();

  const manifest = await buildPersonaManifest(discussionId, participant, persona, snapshot, participant.dshSessionId, {
    provider: config.profile.provider,
    model: config.profile.model,
    baseUrl: config.profile.baseUrl,
    profileHash: config.profile.profileHash,
  });
  // 写盘前严格校验（遵循 P0 契约：persona-profile 与 persona 一致、hash 合法、路径安全）
  parseManifest(manifest);
  writeManifestAtomic(manifest);

  await prisma.discussionParticipant.update({
    where: { id: participant.id },
    data: {
      personaSkillVersion: snapshot.skillVersion,
      personaSkillHash: snapshot.skillHash,
      personaSnapshotRoot: snapshot.snapshotRoot,
      status: "pending",
      lastError: null,
    },
  });
  return { participant, snapshot, persona, sessionId: participant.dshSessionId, manifest };
}

/** 组装 1v1 prompt packet（不含完整 Skill 全文/history；history 由 DSH 管理） */
export function buildPersonaPromptPacket(persona: { name: string; systemPrompt?: string }, brief: string, question: string, state: unknown): string {
  // 把 persona 的 systemPrompt + 讨论背景作为顶层指令注入 prompt
  const identity = persona.systemPrompt?.trim() ? `\n\n【你的设定】\n${persona.systemPrompt}` : "";
  return [
    `# 讨论背景\n${brief}`,
    `# 当前讨论状态\n${safeJson(state)}`,
    `# 你的身份\n你是 ${persona.name}。请以你的立场与风格直接回答下面的问题。`,
    identity,
    `# 工具权限\n你可以使用只读的 web_search 查证实时事实、产品/竞品、规格和市场数据；该工具受当前讨论的审批策略保护，实际调用前会按会话策略处理。需要具体事实时先查证，不要凭空编造。`,
    `# 用户的问题\n${question}`,
  ].filter(Boolean).join("\n\n");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "{}";
  }
}

export interface RunTurnResult {
  participantId: string;
  sessionId: string;
  finalText: string;
  eventsWritten: number;
  status: "completed" | "failed";
  errorCode?: string;
  error?: string;
}

/**
 * 1v1 单个回合：写 manifest → 独立 DSH 进程 → 投影 DiscussionMessage。
 * P0：唯一生成调用是 DSH runner；DSH 失败不得回退 AI SDK，必须将
 * turn/participant/discussion 标记为 failed 并返回失败结果。
 */
export async function runOneOnOneTurn(
  discussionId: string,
  personaId: string,
  question: string
): Promise<RunTurnResult> {
  const d = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!d) throw new Error("讨论不存在");
  if (d.archivedAt) throw new DiscussionArchivedError();
  const isOneOnOne = Array.isArray(d.personaIds) && d.personaIds.length === 1;

  let participant: { id: string; dshSessionId: string } | null = null;
  let persona: { name: string; systemPrompt: string };

  // manifest/快照/配置失败发生在 DiscussionTurn 建立前：仍更新 participant/discussion 状态。
  const markPreTurnFailed = async (errorCode: string, error: string): Promise<RunTurnResult> => {
    const msg = error.slice(0, 300);
    if (participant?.id) {
      await prisma.discussionParticipant.update({
        where: { id: participant.id },
        data: { status: "failed", lastError: msg },
      }).catch(() => undefined);
    }
    if (isOneOnOne) {
      await prisma.discussion.update({ where: { id: discussionId }, data: { status: "failed" } }).catch(() => undefined);
    }
    publish(discussionId, { type: "change" });
    return {
      participantId: participant?.id ?? "",
      sessionId: participant?.dshSessionId ?? "",
      finalText: "",
      eventsWritten: 0,
      status: "failed",
      errorCode,
      error: msg,
    };
  };

  try {
    const ensured = await ensurePersonaSession(discussionId, personaId);
    participant = ensured.participant;
    persona = ensured.persona;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const code = err instanceof DshManifestError ? "DSH_MANIFEST_INVALID" : "DSH_START_FAILED";
    participant = await prisma.discussionParticipant.findFirst({ where: { discussionId, personaId } });
    return markPreTurnFailed(code, err.message);
  }

  const state = (d.discussionState as unknown) ?? {};
  const prompt = buildPersonaPromptPacket(persona, d.brief, question, state);

  if (getDiscussionSessionManager().isBusy(discussionId, participant.dshSessionId)) {
    return {
      participantId: participant.id,
      sessionId: participant.dshSessionId,
      finalText: "",
      eventsWritten: 0,
      status: "failed",
      errorCode: "DSH_SESSION_BUSY",
      error: "该人格的 DSH Session 正在运行，请稍后重试",
    };
  }

  const lease = await acquireDiscussionRun(discussionId);
  if (!lease) {
    return {
      participantId: participant.id,
      sessionId: participant.dshSessionId,
      finalText: "",
      eventsWritten: 0,
      status: "failed",
      errorCode: "DSH_SESSION_BUSY",
      error: "该讨论已有回合正在运行，请稍后重试",
    };
  }

  try {
    await prisma.discussion.update({ where: { id: discussionId }, data: { status: "running" } });
    await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "running" } });
    publish(discussionId, { type: "change" });

    const runId = lease.runId;
    const result = await runDiscussionDshTurn({
      discussionId,
      runId,
      participantId: participant.id,
      sessionId: participant.dshSessionId,
      kind: "persona",
      round: 0,
      attempt: 1,
      prompt,
      inputSnapshot: { runId, prompt, stateVersion: d.stateVersion ?? 0 } as Prisma.InputJsonValue,
      personaId,
      sender: persona.name,
    });
    if (result.status === "failed") {
      if (result.errorCode !== "DSH_SESSION_BUSY" && result.errorCode !== "DISCUSSION_ARCHIVED") {
        await prisma.discussionParticipant.update({
          where: { id: participant.id },
          data: { status: "failed", lastError: (result.error ?? "DSH 回合失败").slice(0, 300) },
        }).catch(() => undefined);
      }
      if (
        isOneOnOne
        && result.errorCode !== "DSH_SESSION_BUSY"
        && result.errorCode !== "DISCUSSION_ARCHIVED"
      ) {
        await prisma.discussion.update({ where: { id: discussionId }, data: { status: "failed" } }).catch(() => undefined);
      }
      publish(discussionId, { type: "change" });
      return {
        participantId: participant.id,
        sessionId: participant.dshSessionId,
        finalText: "",
        eventsWritten: result.eventsWritten,
        status: "failed",
        errorCode: result.errorCode,
        error: result.error,
      };
    }

    if (isOneOnOne) {
      // 1v1 的 ready 表示可以继续提问；成功重试也恢复该状态。
      await prisma.discussion.update({ where: { id: discussionId }, data: { status: "ready" } });
    }
    publish(discussionId, { type: "change" });
    return {
      participantId: participant.id,
      sessionId: participant.dshSessionId,
      finalText: result.finalText,
      eventsWritten: result.eventsWritten,
      status: "completed",
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const dshErr = err instanceof DshError ? err : undefined;
    if (
      isOneOnOne
      && dshErr?.code !== "DSH_SESSION_BUSY"
      && dshErr?.code !== "DISCUSSION_ARCHIVED"
    ) {
      await prisma.discussion.update({ where: { id: discussionId }, data: { status: "failed" } }).catch(() => undefined);
    }
    if (dshErr?.code !== "DSH_SESSION_BUSY" && dshErr?.code !== "DISCUSSION_ARCHIVED") {
      await prisma.discussionParticipant.update({
        where: { id: participant.id },
        data: { status: "failed", lastError: (dshErr?.message ?? err.message).slice(0, 300) },
      }).catch(() => undefined);
    }
    publish(discussionId, { type: "change" });
    return {
      participantId: participant.id,
      sessionId: participant.dshSessionId,
      finalText: "",
      eventsWritten: 0,
      status: "failed",
      errorCode: dshErr?.code ?? "DSH_PROTOCOL_FAILED",
      error: (dshErr?.message ?? err.message).slice(0, 300),
    };
  } finally {
    await releaseDiscussionRun(discussionId, lease.runId);
  }
}

/** 写一个中立 Moderator 的 manifest（keyed 到本次回合的 sessionId；严格校验后写盘）。
 * 使用真实 runtime profile，避免 schema 校验失败或模型启动前配置缺失。 */
export async function writeModeratorManifestForSession(sessionId: string, discussionId: string): Promise<void> {
  const config = await getDshTurnConfig();
  const permissions = await loadDiscussionPermissions(discussionId);
  const manifest: RuntimeSessionManifest = {
    schemaVersion: 1,
    sessionId,
    discussionId,
    kind: "moderator",
    runtimeProfile: {
      provider: config.profile.provider,
      model: config.profile.model,
      baseUrl: config.profile.baseUrl ?? null,
      profileHash: config.profile.profileHash,
    },
    allowedSkills: [],
    toolPolicy: { webSearch: false, sideEffects: false },
    permissions,
  };
  parseManifest(manifest);
  writeManifestAtomic(manifest);
}
