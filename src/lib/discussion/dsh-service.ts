/**
 * 1v1 DSH 讨论 service（见方案 §7）。把「一次提问 → DSH run → 事件/消息投影」串起来。
 *
 * 依赖：场景需 Runtime 已启动（ensureStartedForSettings）与插件（人格 prompt/skill）
 * 功能接线；插件未接线前，本 service 直接把 persona systemPrompt + brief 注入 prompt
 * packet 作为过渡（仍由 DSH 管理 history 与工具调用）。
 */
import { prisma } from "@/lib/db";
import { generateText } from "ai";
import { ensurePersonaSnapshot, type PersonaSnapshot } from "@/lib/dsh/snapshot";
import { writeManifestAtomic, type RuntimeSessionManifest } from "@/lib/dsh/manifest";
import { persistAgentEvents, type DshNotification } from "@/lib/dsh/events";
import { getRuntimeManager, ensureStartedForSettings } from "@/lib/runtime/singleton";
import { getSetting } from "@/lib/settings/store";
import { decrypt } from "@/lib/settings/encryption";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { llmTimeoutMs } from "@/lib/llm/timeout";
import type { RuntimeRunResult } from "@/lib/runtime/types";
import { publish } from "./broadcast";
import { DiscussionArchivedError, DshSessionBusyError } from "@/lib/dsh/errors";

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

/** 构建 Persona 的 RuntimeSessionManifest（keyed 到指定 sessionId）。 */
export function buildPersonaManifest(
  discussionId: string,
  participant: { id: string; dshSessionId: string },
  persona: { id: string; name: string; systemPrompt: string },
  snapshot: PersonaSnapshot,
  sessionId: string
): RuntimeSessionManifest {
  return {
    schemaVersion: 1,
    sessionId,
    discussionId,
    participantId: participant.id,
    kind: "persona",
    runtimeProfile: { provider: "openai", model: "", profileHash: "" }, // 由 runtime 层回填
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
    allowedSkills: [
      {
        name: "persona-profile",
        version: snapshot.skillVersion,
        contentHash: snapshot.skillHash,
        packageRoot: snapshot.snapshotRoot,
        description: `Persona: ${persona.name}`,
      },
    ],
    toolPolicy: { webSearch: true, sideEffects: false },
  };
}

/** 首轮：确保 Persona 快照 + 写 Session manifest */
export async function ensurePersonaSession(discussionId: string, personaId: string) {
  const participant = await ensureParticipant(discussionId, personaId);
  const persona = await loadPersonaSource(personaId);
  const snapshot = ensurePersonaSnapshot(persona);

  const manifest = buildPersonaManifest(discussionId, participant, persona, snapshot, participant.dshSessionId);
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
  return { participant, snapshot, persona };
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
 * 1v1 单个回合：写 manifest → manager.run → 持久化 AgentEvents → 投影 DiscussionMessage。
 * @param isSteerFollowup 是否后续追问（首轮则先 ensurePersonaSession）
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

  const { participant, persona } = await ensurePersonaSession(discussionId, personaId);

  const state = (d.discussionState as unknown) ?? {};
  const prompt = buildPersonaPromptPacket(persona, d.brief, question, state);

  await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "running" } });
  publish(discussionId, { type: "change" });

  // 记录本次回合的输入快照（供失败重试用），即使成功也保留完整 inputSnapshot
  const turn = await prisma.discussionTurn.create({
    data: {
      discussionId,
      participantId: participant.id,
      sessionId: participant.dshSessionId,
      kind: "persona",
      round: 0,
      attempt: 1,
      inputSnapshot: { prompt, stateVersion: (d.stateVersion ?? 0) } as unknown as object,
      status: "running",
    },
  });

  // 常驻 DSH Runtime 跑一回合（进程内单例 DeepSeekHarness，跨回合复用）；失败时回退 AI SDK 兜底。
  // 用「稳定 dshSessionId」让 DSH 保留跨回合上下文；本服务器已是真实 node 进程（非 Electron 托管）。
  let result: { finalResponse: string };
  try {
    result = { finalResponse: await runTurnViaDsh(participant.dshSessionId, prompt) };
  } catch (dshE) {
    // 回退：AI SDK 进程内生成（确保讨论能出回复）
    try {
      result = { finalResponse: await runViaAiSdk(persona.name, persona.systemPrompt, d.brief, question) };
    } catch (aiErr) {
      const error = aiErr instanceof Error ? aiErr.message : String(aiErr);
      await prisma.discussionTurn.update({
        where: { id: turn.id },
        data: { status: "failed", errorCode: "DSH_TURN_FAILED", errorMessage: error, completedAt: new Date() },
      });
      await prisma.discussionParticipant.update({
        where: { id: participant.id },
        data: { status: "failed", lastError: error },
      });
      if (isOneOnOne) {
        await prisma.discussion.update({ where: { id: discussionId }, data: { status: "failed" } });
      }
      publish(discussionId, { type: "change" });
      return { participantId: participant.id, sessionId: participant.dshSessionId, finalText: "", eventsWritten: 0, status: "failed", error };
    }
  }

  // 持久化 DSH 原始事件（sessionId,seq 去重）—— 进程方式默认不返回全量事件，此处计 0
  const eventsWritten = 0;

  const finalText = result.finalResponse ?? "";
  if (finalText.trim()) {
    const msg = await prisma.discussionMessage.create({
      data: {
        discussionId,
        personaId,
        participantId: participant.id,
        sessionId: participant.dshSessionId,
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
    const error = "DSH 返回空回复";
    await prisma.discussionParticipant.update({
      where: { id: participant.id },
      data: { status: "failed", lastError: error },
    });
    await prisma.discussionTurn.update({
      where: { id: turn.id },
      data: { status: "failed", errorCode: "DSH_TURN_FAILED", errorMessage: error, completedAt: new Date() },
    });
    if (isOneOnOne) {
      await prisma.discussion.update({ where: { id: discussionId }, data: { status: "failed" } });
    }
    publish(discussionId, { type: "change" });
    return {
      participantId: participant.id,
      sessionId: participant.dshSessionId,
      finalText: "",
      eventsWritten,
      status: "failed",
      error,
    };
  }

  return {
    participantId: participant.id,
    sessionId: participant.dshSessionId,
    finalText,
    eventsWritten,
    status: "completed",
  };
}

function lastEventSeq(_result: RuntimeRunResult): number {
  // 暂时记录最近一次持久化 seq；由 events 层维护的永久字段后续精化
  return 0;
}

/**
 * 在「常驻进程内 DSH Runtime」（单例 DeepSeekHarness）上跑一回合。跨回合复用同一 runtime，
 * 因此速度远快于每回合现起进程，且能保留同 session 的跨回合上下文。返回 finalResponse。
 * 依赖：服务器为真实 node 进程（process.execPath=node），否则进程内 spawn 会被 Electron 破坏。
 */
export async function runTurnViaDsh(sessionId: string, prompt: string): Promise<string> {
  // 惰性启动常驻 Runtime（用当前 LLM 设置 + 注入 API key），已启动则复用；profile 冲突会 drain 重建
  await ensureStartedForSettings();
  const mgr = getRuntimeManager();
  const res = await mgr.run(sessionId, prompt);
  return res.finalResponse;
}

/** 写一个中立 Moderator 的 manifest（keyed 到稳定 moderatorSessionId） */
export function writeModeratorManifestForSession(sessionId: string, discussionId: string): void {
  const manifest: RuntimeSessionManifest = {
    schemaVersion: 1,
    sessionId,
    discussionId,
    kind: "moderator",
    runtimeProfile: { provider: "openai", model: "", profileHash: "" },
    allowedSkills: [],
    toolPolicy: { webSearch: false, sideEffects: false },
  };
  writeManifestAtomic(manifest);
}

/**
 * AI SDK 进程内生成（兜底路径）。正常情况下常驻 DSH Runtime 已能稳定产出；
 * 仅在 DSH 真正失败时兜底，确保讨论永远能出内容。
 */
async function runViaAiSdk(personaName: string, systemPrompt: string, brief: string, question: string): Promise<string> {
  const [providerRaw, baseUrl, keyCipher, modelRaw, timeoutRaw] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);
  const provider = normalizeProvider(providerRaw);
  const apiKey = keyCipher ? decrypt(keyCipher) : "";
  if (!apiKey) throw new Error("未配置有效的 API Key");

  const modelObj = buildModel(provider, apiKey, modelRaw ?? "", baseUrl || undefined);
  const sys =
    systemPrompt +
    `\n\n【讨论背景】\n${brief}` +
    `\n\n你现在是「${personaName}」。请以你的立场与风格，直接回答用户的问题，用第一人称，简洁、有观点、不绕弯。`;

  const { text } = await generateText({
    model: modelObj,
    system: sys,
    prompt: question,
    abortSignal: AbortSignal.timeout(llmTimeoutMs(timeoutRaw)),
  });
  return text?.trim() || "（无回应）";
}
