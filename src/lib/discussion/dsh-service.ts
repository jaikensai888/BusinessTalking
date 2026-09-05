/**
 * 1v1 DSH 讨论 service（见方案 §7）。把「一次提问 → 独立 DSH 回合 → 消息投影」串起来。
 * 每个回合使用自己的 session manifest，确保 DSH 插件读取到当前讨论的人格 Skill。
 */
import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { ensurePersonaSnapshot, type PersonaSnapshot } from "@/lib/dsh/snapshot";
import { deleteManifest, parseManifest, writeManifestAtomic, type RuntimeSessionManifest } from "@/lib/dsh/manifest";
import { getDshTurnConfig } from "@/lib/runtime/singleton";
import { runTurnViaProcess } from "@/lib/runtime/turn-process";
import { publish } from "./broadcast";
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
  if (!rev.packageRoot) {
    throw new DshManifestError(`Skill ${rev.name} revision 缺少 packageRoot（未安装，不可执行）`);
  }
  const manifest = (rev.manifest ?? {}) as { resources?: { rel: string; name: string; kind: string; size: number; hash: string }[] };
  const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
  return {
    name: rev.name,
    version: rev.version,
    contentHash: rev.contentHash,
    packageRoot: rev.packageRoot,
    description: rev.description,
    resourceIndex: resources.map((r) => ({
      rel: r.rel,
      name: r.name,
      size: r.size,
      hash: r.hash,
    })),
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
    toolPolicy: { webSearch: false, sideEffects: false },
  };
}

/** 为一个 DSH 回合确保 Persona 快照 + 写入匹配的 Session manifest */
export async function ensurePersonaSession(discussionId: string, personaId: string, sessionId?: string) {
  const participant = await ensureParticipant(discussionId, personaId);
  const persona = await loadPersonaSource(personaId);
  const snapshot = ensurePersonaSnapshot(persona);

  // 真实 runtime profile（provider/model/baseUrl/profileHash）；打不开凭据时提前失败
  const config = await getDshTurnConfig();

  const manifestSessionId = sessionId ?? participant.dshSessionId;
  const manifest = await buildPersonaManifest(discussionId, participant, persona, snapshot, manifestSessionId, {
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
  return { participant, snapshot, persona, sessionId: manifestSessionId, manifest };
}

/** 每个独立 DSH 回合使用新的 session，避免跨进程复用已结束 session 返回空回复。 */
export function freshTurnSessionId(discussionId: string, actorId: string): string {
  return `bt-turn-${discussionId}-${actorId}-${randomUUID()}`;
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
  question: string,
  opts: { first?: boolean } = {}
): Promise<RunTurnResult> {
  const d = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!d) throw new Error("讨论不存在");
  if (d.archivedAt) throw new DiscussionArchivedError();
  const isOneOnOne = Array.isArray(d.personaIds) && d.personaIds.length === 1;

  const turnSessionId = freshTurnSessionId(discussionId, personaId);
  let participant: { id: string; dshSessionId: string };
  let persona: { name: string; systemPrompt: string };

  // 失败辅助：把 turn/participant/discussion 状态落为 failed（讨论自身失败保持非成功）。
  // 注意：不抛 new error —— 标记失败本身的异常不得覆盖原始 DSH 错误。
  const markFailed = async (errorCode: string, error: string) => {
    const msg = error.slice(0, 300);
    if (turnSessionId) {
      await prisma.discussionTurn.updateMany({
        where: { discussionId, participantId: participant?.id || undefined, sessionId: turnSessionId, status: "running" },
        data: { status: "failed", errorCode, errorMessage: msg, completedAt: new Date() },
      }).catch(() => undefined);
    }
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
    return { participantId: participant?.id ?? "", sessionId: turnSessionId, finalText: "", eventsWritten: 0, status: "failed" as const, error: msg };
  };

  // manifest/快照/配置失败发生在 DiscussionTurn 建立前：仍更新 participant/discussion 状态
  try {
    const ensured = await ensurePersonaSession(discussionId, personaId, turnSessionId);
    participant = ensured.participant;
    persona = ensured.persona;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    // DshManifestError 保留精确 code；其他按 DSH_MANIFEST_INVALID 处理（配置/快照失败均属启动前失败）
    const code = err instanceof DshManifestError ? "DSH_MANIFEST_INVALID" : "DSH_START_FAILED";
    const existing = await prisma.discussionParticipant.findFirst({ where: { discussionId, personaId } });
    participant = existing ?? { id: "", dshSessionId: turnSessionId };
    return markFailed(code, err.message);
  }

  const state = (d.discussionState as unknown) ?? {};
  const prompt = buildPersonaPromptPacket(persona, d.brief, question, state);

  await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "running" } });
  publish(discussionId, { type: "change" });

  // 记录本次回合的输入快照（供失败重试用），即使成功也保留完整 inputSnapshot
  const turn = await prisma.discussionTurn.create({
    data: {
      discussionId,
      participantId: participant.id,
      sessionId: turnSessionId,
      kind: "persona",
      round: 0,
      attempt: 1,
      inputSnapshot: { prompt, stateVersion: (d.stateVersion ?? 0) } as unknown as object,
      status: "running",
    },
  });

  // P0：唯一生成调用是 DSH runner，无任何隐式 fallback
  let finalText = "";
  try {
    finalText = (await runTurnViaDsh(turnSessionId, prompt)) ?? "";
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const dshErr = err instanceof DshError ? err : undefined;
    return markFailed(dshErr?.code ?? "DSH_TURN_FAILED", dshErr?.message ?? err.message);
  }

  // 持久化 DSH 原始事件（sessionId,seq 去重）—— 进程方式默认不返回全量事件，此处计 0
  const eventsWritten = 0;

  if (finalText.trim()) {
    const msg = await prisma.discussionMessage.create({
      data: {
        discussionId,
        personaId,
        participantId: participant.id,
        sessionId: turnSessionId,
        sender: persona.name,
        role: "persona",
        turn: 0,
        content: finalText.trim(),
        attempt: 1,
      },
    });
    await prisma.discussionParticipant.update({
      where: { id: participant.id },
      data: { status: "completed", lastEventSeq: 0, lastError: null },
    });
    await prisma.discussionTurn.update({
      where: { id: turn.id },
      data: { status: "completed", outputMessageId: msg.id, completedAt: new Date() },
    });
    if (isOneOnOne) {
      // 1v1 的 ready 表示可以继续提问；失败重试成功后恢复该状态。
      await prisma.discussion.update({ where: { id: discussionId }, data: { status: "ready" } });
    }
    publish(discussionId, { type: "change" });
  } else {
    return markFailed("DSH_TURN_FAILED", "DSH 返回空回复");
  }

  return {
    participantId: participant.id,
    sessionId: turnSessionId,
    finalText,
    eventsWritten,
    status: "completed",
  };
}

/**
 * 用独立真实 Node 进程跑一回合，并把调用方传入的 sessionId 作为 manifest key。
 * 这样插件不会回退到固定的 bt-e2e manifest；每回合结束后清理临时 manifest。
 * 清理失败仅记录错误，不得覆盖原始 DSH 错误，更不能令结果变成功。
 */
export async function runTurnViaDsh(sessionId: string, prompt: string): Promise<string> {
  try {
    const config = await getDshTurnConfig();
    const res = await runTurnViaProcess({
      sessionId,
      prompt,
      provider: config.profile.dshRoute ?? config.profile.provider,
      model: config.profile.model,
      cwd: config.cwd,
      dshBin: config.dshBin,
      dshHome: config.dshHome,
      apiKey: config.apiKey,
      patches: config.patches,
    });
    return res.finalResponse;
  } finally {
    try {
      deleteManifest(sessionId);
    } catch (e) {
      console.error("[dsh-turn] manifest 清理失败（不覆盖原始结果）：", e instanceof Error ? e.message : e);
    }
  }
}

/** 写一个中立 Moderator 的 manifest（keyed 到本次回合的 sessionId；严格校验后写盘）。
 * 使用真实 runtime profile，避免 schema 校验失败或模型启动前配置缺失。 */
export async function writeModeratorManifestForSession(sessionId: string, discussionId: string): Promise<void> {
  const config = await getDshTurnConfig();
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
  };
  parseManifest(manifest);
  writeManifestAtomic(manifest);
}
