/**
 * 多人讨论 Orchestrator（见方案 §8）。BusinessTalking 控制轮次与发言顺序，
 * 每个参与人格使用独立 DSH Session；一轮结束后由中立 Moderator Session 生成
 * StateProposal，BusinessTalking 校验并原子提交。
 */
import { prisma } from "@/lib/db";
import { ensurePersonaSession, writeModeratorManifestForSession } from "./dsh-service";
import { runDiscussionDshTurn } from "./run-dsh-turn";
import type { Prisma } from "@prisma/client";
import { parseStateProposal, emptyState, type DiscussionState, type StateProposal } from "./state";
import { publish } from "./broadcast";
import {
  DiscussionStateConflictError,
  DiscussionRunLeaseLostError,
  DshTurnError,
  isFatalDiscussionRuntimeError,
  DshError,
  type DshErrorCode,
} from "@/lib/dsh/errors";
import {
  acquireDiscussionRun,
  isDiscussionRunOwner,
  releaseDiscussionRun,
  renewDiscussionRun,
} from "./run-lease";

/** 稳定参与者顺序：按 discussion.personaIds 顺序 */
function participantOrder(discussionId: string, personaIds: string[]) {
  // 以 DB 中已建 participant 的顺序为准，缺失则按 personaIds 顺序补齐 id
  return personaIds;
}

export interface TranscriptEntry {
  id: string;
  sender: string;
  role: string;
  content: string;
}

/** 讨论记录注入上限：最近 60 条、单条截断 3000 字符，防止长讨论 token 失控 */
const MAX_TRANSCRIPT_MESSAGES = 60;
const MAX_TRANSCRIPT_MSG_CHARS = 3000;

function renderTranscript(entries: TranscriptEntry[], withIds: boolean): string {
  return entries
    .map((m) => `- ${withIds ? `[${m.id}] ` : ""}${m.sender}：${m.content.slice(0, MAX_TRANSCRIPT_MSG_CHARS)}`)
    .join("\n");
}

/** 加载讨论至今的 persona/user 发言（排除仍待消费的用户插话，避免与 steers 重复注入） */
export async function loadDiscussionTranscript(
  discussionId: string,
  excludeUserMessageIds: string[],
): Promise<TranscriptEntry[]> {
  const rows = await prisma.discussionMessage.findMany({
    where: {
      discussionId,
      role: { in: ["persona", "user"] },
      ...(excludeUserMessageIds.length ? { id: { notIn: excludeUserMessageIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, sender: true, role: true, content: true },
  });
  return rows.slice(-MAX_TRANSCRIPT_MESSAGES);
}

/** 按 acceptedMessageIds 取本轮发言（保持传入顺序），供 Moderator 汇总真实内容 */
export async function loadMessagesByIds(discussionId: string, messageIds: string[]): Promise<TranscriptEntry[]> {
  if (!messageIds.length) return [];
  const rows = await prisma.discussionMessage.findMany({
    where: { discussionId, id: { in: messageIds } },
    select: { id: true, sender: true, role: true, content: true },
  });
  const order = new Map(messageIds.map((id, index) => [id, index]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** 组装多人人格 prompt packet：含 brief、round、当前状态、讨论记录、本轮用户 steer */
export function buildGroupPersonaPrompt(
  personaName: string,
  personaSystemPrompt: string | null | undefined,
  brief: string,
  round: number,
  state: DiscussionState,
  history: TranscriptEntry[],
  steers: string[]
): string {
  const historyText = renderTranscript(history, false);
  const steerText = steers.map((s) => `- ${s}`).join("\n");
  const identity = personaSystemPrompt?.trim() ? `\n\n【你的设定】\n${personaSystemPrompt}` : "";
  return [
    `# 讨论背景\n${brief}`,
    `# 当前轮次\n第 ${round} 轮`,
    `# 当前共享状态\n${safeJson(state)}`,
    `# 讨论记录（此前各轮其他参与者的发言）\n${historyText || "（尚无，本轮你是第一个发言的）"}`,
    steerText ? `# 用户插话\n${steerText}` : "",
    `# 你的身份\n你是 ${personaName}。请用你的立场与风格，针对讨论记录中他人的观点给出新观点或反驳；简洁、有观点、不重复别人。用第一人称。`,
    identity,
    `# 工具权限\n你可以使用只读的 web_search 查证实时事实、产品/竞品、规格和市场数据；该工具受当前讨论的审批策略保护，实际调用前会按会话策略处理。需要具体事实时先查证，不要凭空编造。`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "{}";
  }
}

/**
 * 运行一次 Moderator 回合 → 返回 StateProposal。
 * P0：不再自动重试；DSH 错误、空回复、非法 JSON、schema 校验失败都直接抛出，
 * 由调用方保留旧 discussionState、标记 moderatorStatus=failed 与 Discussion failed，
 * 不写伪造 summary/evidence/decision，不进入下一轮。
 */
export async function runModeratorTurn(
  discussionId: string,
  round: number,
  state: DiscussionState,
  acceptedMessageIds: string[],
  moderatorSessionId: string,
  runId = `moderator-${discussionId}-${round}`,
  stateVersion = state.round,
  roundMessages: TranscriptEntry[] = [],
): Promise<StateProposal> {
  // P0：Moderator 必须看到本轮真实发言内容（带消息 ID 便于引用 sourceMessageIds），
  // 否则 summary/evidence 只能对着 ID 列表凭空编造。
  const prompt = [
    `你是讨论主持汇总者。请严格输出一个**合法的 JSON 对象**，不要任何 Markdown、代码块围栏或解释文字。JSON 结构（全部字段必填，缺失则填空数组）：`,
    `{ "schemaVersion":1, "basedOnStateVersion":<上一状态版本号>, "round":<本轮>, "summary":"一句话共识", "evidence":[{ "id":"e1","claim":"主张","sourceMessageIds":["<消息id>"],"sourceEventIds":[] }], "decisions":[], "openQuestions":[], "acceptedMessageIds":["<本轮消息id>"] }`,
    `# 当前状态\n${safeJson(state)}`,
    `# 本轮发言记录\n${renderTranscript(roundMessages, true) || "（无）"}`,
    `# 本轮已接受的消息 ID\n${safeJson(acceptedMessageIds)}`,
  ].join("\n\n");

  const result = await runDiscussionDshTurn({
    discussionId,
    runId,
    participantId: null,
    sessionId: moderatorSessionId,
    kind: "moderator",
    round,
    attempt: 1,
    prompt,
    inputSnapshot: {
      runId,
      prompt,
      stateVersion,
      acceptedMessageIds,
    } as Prisma.InputJsonValue,
  });
  if (result.status === "failed") {
    throw new DshError(
      (result.errorCode ?? "DSH_PROTOCOL_FAILED") as DshErrorCode,
      result.error ?? "Moderator DSH 回合失败",
    );
  }
  if (!result.finalText.trim()) {
    throw new DshTurnError("Moderator 返回空回复");
  }

  const raw = extractJson(result.finalText);
  return parseStateProposal(raw); // 严格校验；失败抛错（不修复）
}

/** 从回复文本提取首个 JSON 对象（剥代码块围栏 + 首尾大括号） */
export function extractJson(text: string): unknown {
  let trimmed = text.trim();
  trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === "object") return direct;
  } catch {
    /* fallthrough */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1));
      if (obj && typeof obj === "object") return obj;
    } catch {
      /* fallthrough */
    }
  }
  throw new DshTurnError("Moderator 未输出合法 JSON");
}

/** 由本轮真实回合结果构建 participantStatuses：缺失发言者显式可见，而非静默丢失 */
function buildParticipantStatuses(roundResults?: PersonaRoundResult[]): DiscussionState["participantStatuses"] {
  if (!roundResults?.length) return [];
  return roundResults.map((r) => ({
    participantId: r.participantId,
    status: r.status,
    ...(r.outputMessageId ? { lastOutputMessageId: r.outputMessageId } : {}),
  }));
}

/**
 * 原子提交 StateProposal。
 * 乐观锁：updateMany 以 stateVersion 为条件的单条 CAS，count!==1 即冲突；
 * 不做「先读后比再写」，避免 check-act 之间的竞态窗口。
 */
export async function commitStateProposal(
  discussionId: string,
  proposal: StateProposal,
  prediction: { stateVersion: number; round: number },
  runId?: string,
  roundResults?: PersonaRoundResult[],
): Promise<DiscussionState> {
  if (runId && !(await isDiscussionRunOwner(discussionId, runId))) {
    throw new DiscussionRunLeaseLostError();
  }
  const d = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!d) throw new Error("讨论不存在");
  // acceptedMessageIds 必须都属于当前讨论
  if (proposal.acceptedMessageIds.length) {
    const cnt = await prisma.discussionMessage.count({
      where: { discussionId, id: { in: proposal.acceptedMessageIds } },
    });
    if (cnt !== proposal.acceptedMessageIds.length) {
      throw new DiscussionStateConflictError("StateProposal 引用了不属于当前讨论的消息");
    }
  }
  const newState: DiscussionState = {
    schemaVersion: 1,
    brief: d.brief,
    round: proposal.round,
    summary: proposal.summary,
    evidence: proposal.evidence,
    decisions: proposal.decisions,
    openQuestions: proposal.openQuestions,
    userSteers: [],
    participantStatuses: buildParticipantStatuses(roundResults),
  };
  const updated = await prisma.discussion.updateMany({
    where: { id: discussionId, stateVersion: prediction.stateVersion },
    data: {
      discussionState: newState as unknown as Prisma.InputJsonValue,
      stateVersion: { increment: 1 },
      summaryBox: proposal.summary, // 展示投影
    },
  });
  if (updated.count !== 1) {
    throw new DiscussionStateConflictError();
  }
  publish(discussionId, { type: "change" });
  return newState;
}

export interface PersonaRoundResult {
  personaId: string;
  personaName?: string;
  participantId: string;
  sessionId: string;
  status: "completed" | "failed";
  outputMessageId?: string;
  finalText?: string;
  errorCode?: string;
  error?: string;
}

interface PersonaRoundInput {
  discussionId: string;
  runId: string;
  round: number;
  state: DiscussionState;
  brief: string;
  personaIds: string[];
  stateVersion: number;
  /** 此前各轮 persona/user 发言；按人过滤本人发言后注入 prompt */
  history?: TranscriptEntry[];
}

function maxParallelPersonas(): number {
  const parsed = Number(process.env.BT_DSH_MAX_PARALLEL_PERSONAS ?? "4");
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 4;
  return Math.min(parsed, 8);
}

function personaErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

function personaErrorCode(error: unknown): DshErrorCode {
  return error instanceof DshError ? error.code : "DSH_PROTOCOL_FAILED";
}

/**
 * Run one round's Persona turns with a bounded worker pool. Every prompt is
 * built from the same immutable state snapshot; results keep personaIds order.
 */
export async function runPersonaRound(input: PersonaRoundInput): Promise<PersonaRoundResult[]> {
  const tasks = await Promise.all(input.personaIds.map(async (personaId, index) => ({
    index,
    personaId,
    persona: await prisma.persona.findUnique({ where: { id: personaId } }),
  })));
  const results: Array<PersonaRoundResult | undefined> = new Array(tasks.length);
  let nextIndex = 0;
  let fatal: unknown;

  const execute = async (task: typeof tasks[number]): Promise<void> => {
    if (!task.persona) return;
    const persona = task.persona;
    let participantId = "";
    let sessionId = "";
    try {
      const steers = pendingSteers(input.state.userSteers ?? [], task.personaId);
      // 本人历史发言已在其稳定 DSH session 内，注入时排除以免重复
      const history = (input.history ?? []).filter((m) => m.sender !== persona.name);
      const prompt = buildGroupPersonaPrompt(
        persona.name,
        persona.systemPrompt,
        input.brief,
        input.round,
        input.state,
        history,
        steers,
      );
      const { participant } = await ensurePersonaSession(input.discussionId, task.personaId);
      participantId = participant.id;
      sessionId = participant.dshSessionId;
      await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "running" } });
      publish(input.discussionId, { type: "change" });

      const result = await runDiscussionDshTurn({
        discussionId: input.discussionId,
        runId: input.runId,
        participantId: participant.id,
        sessionId: participant.dshSessionId,
        kind: "persona",
        round: input.round,
        attempt: 1,
        prompt,
        inputSnapshot: {
          runId: input.runId,
          prompt,
          stateVersion: input.stateVersion,
        } as Prisma.InputJsonValue,
        personaId: task.personaId,
        sender: task.persona.name,
      });
      if (result.status === "failed") {
        throw new DshError(
          (result.errorCode ?? "DSH_PROTOCOL_FAILED") as DshErrorCode,
          result.error ?? "DSH Persona 回合失败",
        );
      }
      results[task.index] = {
        personaId: task.personaId,
        personaName: task.persona.name,
        participantId: participant.id,
        sessionId: participant.dshSessionId,
        status: "completed",
        outputMessageId: result.outputMessageId,
        finalText: result.finalText,
      };
    } catch (error) {
      const code = personaErrorCode(error);
      const message = personaErrorMessage(error);
      const participant = participantId
        ? { id: participantId }
        : await prisma.discussionParticipant.findFirst({
          where: { discussionId: input.discussionId, personaId: task.personaId },
        });
      if (participant && code !== "DISCUSSION_ARCHIVED") {
        await prisma.discussionTurn.updateMany({
          where: {
            discussionId: input.discussionId,
            participantId: participant.id,
            ...(sessionId ? { sessionId } : {}),
            runId: input.runId,
            status: "running",
          },
          data: { status: "failed", errorCode: code, errorMessage: message, completedAt: new Date() },
        });
        await prisma.discussionParticipant.update({
          where: { id: participant.id },
          data: { status: "failed", lastError: message },
        });
      }
      if (isFatalDiscussionRuntimeError(error)) {
        fatal ??= error;
        return;
      }
      results[task.index] = {
        personaId: task.personaId,
        participantId: participant?.id ?? participantId,
        sessionId,
        status: "failed",
        errorCode: code,
        error: message,
      };
    }
  };

  const worker = async (): Promise<void> => {
    while (!fatal) {
      const index = nextIndex;
      nextIndex += 1;
      const task = tasks[index];
      if (!task) return;
      await execute(task);
    }
  };

  const workerCount = Math.min(maxParallelPersonas(), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (fatal) throw fatal;
  return results.filter((result): result is PersonaRoundResult => Boolean(result));
}

async function renewOrThrow(discussionId: string, runId: string): Promise<void> {
  if (!(await renewDiscussionRun(discussionId, runId))) {
    throw new DiscussionRunLeaseLostError();
  }
}

/** 主循环：rounds 轮，每轮并行跑 Persona，然后由 Moderator 串行汇总并原子提交 */
export async function runDiscussion(discussionId: string): Promise<void> {
  const d = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!d) return;
  const personaIds = (d.personaIds as string[]) ?? [];
  if (personaIds.length < 1) {
    await prisma.discussion.update({ where: { id: discussionId }, data: { status: "failed" } });
    return;
  }

  const lease = await acquireDiscussionRun(discussionId);
  if (!lease) return;
  const { runId } = lease;

  let state: DiscussionState = ((d.discussionState as unknown) ?? emptyState(d.brief)) as DiscussionState;
  let stateVersion = d.stateVersion;

  try {
    await renewOrThrow(discussionId, runId);
    await prisma.discussion.update({ where: { id: discussionId }, data: { status: "running", lastError: null } });
    publish(discussionId, { type: "change" });

    // P0-C 断点续跑：从最后一次成功提交的轮次之后继续（全新讨论 state.round=0 → 从第 1 轮开始）
    const lastCommittedRound = Number.isSafeInteger(state.round) ? state.round : 0;
    for (let round = lastCommittedRound + 1; round <= d.rounds; round++) {
      await renewOrThrow(discussionId, runId);
      // P0-B：注入此前各轮真实发言；排除仍待消费的插话（它们经 userSteers 注入，避免重复）
      const pendingSteerIds = (state.userSteers ?? []).map((s) => s.id);
      const history = await loadDiscussionTranscript(discussionId, pendingSteerIds);
      const roundResults = await runPersonaRound({
        discussionId,
        runId,
        round,
        state,
        brief: d.brief,
        personaIds: participantOrder(discussionId, personaIds),
        stateVersion,
        history,
      });
      await renewOrThrow(discussionId, runId);
      const successfulResults = roundResults.filter((result) => result.status === "completed");
      const acceptedMessageIds = successfulResults.flatMap((result) => result.outputMessageId ? [result.outputMessageId] : []);

      // P0：本轮没有任何真实 Persona message → 禁止 Moderator 生成共识，直接标记失败
      if (successfulResults.length === 0) {
        throw new DshTurnError(`第 ${round} 轮没有任何真实 Persona 发言，放弃 Moderator 汇总`);
      }

      // Moderator 汇总：整个 Discussion 只使用一个稳定 Session。
      const logicalModeratorSessionId = d.moderatorSessionId ?? `bt-discussion-${discussionId}-moderator`;
      if (!d.moderatorSessionId) {
        await prisma.discussion.update({ where: { id: discussionId }, data: { moderatorSessionId: logicalModeratorSessionId } });
      }
      // P0：不自动重试、不构造 fallback proposal；失败即终止讨论
      await renewOrThrow(discussionId, runId);
      try {
        await writeModeratorManifestForSession(logicalModeratorSessionId, discussionId);
      } catch (e) {
        // Manifest/configuration failure happens before runModeratorTurn's
        // error boundary, but it is still a Moderator failure from the
        // discussion's perspective.
        if (await isDiscussionRunOwner(discussionId, runId)) {
          await prisma.discussion.update({
            where: { id: discussionId },
            data: { status: "failed", moderatorStatus: "failed" },
          });
          publish(discussionId, { type: "change" });
        }
        throw e;
      }
      let proposal: StateProposal;
      try {
        // P0-A：取本轮真实发言内容注入 Moderator prompt（保持 acceptedMessageIds 顺序）
        const roundMessages = await loadMessagesByIds(discussionId, acceptedMessageIds);
        proposal = await runModeratorTurn(
          discussionId,
          round,
          state,
          acceptedMessageIds,
          logicalModeratorSessionId,
          runId,
          stateVersion,
          roundMessages,
        );
      } catch (e) {
        // 保留旧 discussionState；设置 moderatorStatus=failed 和 Discussion failed，不写伪造数据。
        // 原始错误向上传播，由外层 catch 统一标记。
        if (!(e instanceof DshError) || e.code !== "DISCUSSION_ARCHIVED") {
          if (await isDiscussionRunOwner(discussionId, runId)) {
            await prisma.discussion.update({
              where: { id: discussionId },
              data: { status: "failed", moderatorStatus: "failed" },
            });
          }
        }
        publish(discussionId, { type: "change" });
        throw e;
      }

      state = await commitStateProposal(discussionId, proposal, {
        stateVersion,
        round,
      }, runId, roundResults);
      stateVersion += 1;
      await renewOrThrow(discussionId, runId);
      await prisma.discussion.update({ where: { id: discussionId }, data: { moderatorStatus: "completed" } });
      publish(discussionId, { type: "change" });
    }

    // 成功标记只允许出现在所有轮次和 Moderator proposal 都真实成功之后
    await renewOrThrow(discussionId, runId);
    await prisma.discussion.update({ where: { id: discussionId }, data: { status: "done", lastError: null } });
    publish(discussionId, { type: "change" });
  } catch (error) {
    // 外层 catch：绝不把异常后的流程继续到 status done；保持非成功状态。
    // 错误必须可见：记服务端日志 + 摘要落库（Discussion.lastError），不再静默吞掉。
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    console.error(`[runDiscussion] 讨论运行失败 discussionId=${discussionId}: ${message}`);
    if (await isDiscussionRunOwner(discussionId, runId)) {
      const current = await prisma.discussion.findUnique({ where: { id: discussionId } });
      if (current && current.status !== "failed" && current.status !== "archived") {
        await prisma.discussion.update({
          where: { id: discussionId },
          data: { status: "failed", lastError: message },
        });
      }
      publish(discussionId, { type: "change" });
    }
  } finally {
    await releaseDiscussionRun(discussionId, runId);
  }
}

/** 写一个中立 Moderator 的 manifest（kind=moderator，无 Persona、无普通 Skill） */
function pendingSteers(steers: { targetParticipantIds: string[]; content: string }[], personaId: string): string[] {
  return steers
    .filter((s) => s.targetParticipantIds.length === 0 || s.targetParticipantIds.includes(personaId))
    .map((s) => s.content);
}
