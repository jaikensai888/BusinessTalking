/**
 * 多人讨论 Orchestrator（见方案 §8）。BusinessTalking 控制轮次与发言顺序，
 * 每个参与人格使用独立 DSH Session；一轮结束后由中立 Moderator Session 生成
 * StateProposal，BusinessTalking 校验并原子提交。
 */
import { prisma } from "@/lib/db";
import { ensurePersonaSession, runTurnViaDsh, writeModeratorManifestForSession } from "./dsh-service";
import { persistAgentEvents, type DshNotification } from "@/lib/dsh/events";
import { parseStateProposal, emptyState, type DiscussionState, type StateProposal } from "./state";
import { publish } from "./broadcast";
import { DiscussionStateConflictError, DshTurnError } from "@/lib/dsh/errors";

/** 稳定参与者顺序：按 discussion.personaIds 顺序 */
function participantOrder(discussionId: string, personaIds: string[]) {
  // 以 DB 中已建 participant 的顺序为准，缺失则按 personaIds 顺序补齐 id
  return personaIds;
}

/** 组装多人人格 prompt packet：含 brief、round、当前状态、本轮用户 steer、前序输出 */
export function buildGroupPersonaPrompt(
  personaName: string,
  personaSystemPrompt: string | null | undefined,
  brief: string,
  round: number,
  state: DiscussionState,
  roundOutputs: { name: string; text: string }[],
  steers: string[]
): string {
  const outputs = roundOutputs.map((o) => `- ${o.name}：${o.text}`).join("\n");
  const steerText = steers.map((s) => `- ${s}`).join("\n");
  const identity = personaSystemPrompt?.trim() ? `\n\n【你的设定】\n${personaSystemPrompt}` : "";
  return [
    `# 讨论背景\n${brief}`,
    `# 当前轮次\n第 ${round} 轮`,
    `# 当前共享状态\n${safeJson(state)}`,
    `# 本轮已完成发言\n${outputs || "（尚无）"}`,
    steerText ? `# 用户插话\n${steerText}` : "",
    `# 你的身份\n你是 ${personaName}。请用你的立场与风格，针对方案与他人观点给出新观点；简洁、有观点、不重复别人。用第一人称。`,
    identity,
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

/** 运行一次 Moderator 回合 → 返回 StateProposal */
export async function runModeratorTurn(
  discussionId: string,
  round: number,
  state: DiscussionState,
  acceptedMessageIds: string[],
  moderatorSessionId: string,
  attempt = 1
): Promise<StateProposal> {
  const prompt = [
    `你是讨论主持汇总者。请严格输出一个**合法的 JSON 对象**，不要任何 Markdown、代码块围栏或解释文字。JSON 结构（全部字段必填，缺失则填空数组）：`,
    `{ "schemaVersion":1, "basedOnStateVersion":<上一状态版本号>, "round":<本轮>, "summary":"一句话共识", "evidence":[{ "id":"e1","claim":"主张","sourceMessageIds":["<消息id>"],"sourceEventIds":[] }], "decisions":[], "openQuestions":[], "acceptedMessageIds":["<本轮消息id>"] }`,
    `# 当前状态\n${safeJson(state)}`,
    `# 本轮已接受的消息 ID\n${safeJson(acceptedMessageIds)}`,
  ].join("\n\n");

  const finalResponse = await runTurnViaDsh(moderatorSessionId, prompt);

  const raw = extractJson(finalResponse);
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

/** 原子提交 StateProposal（乐观锁 stateVersion） */
export async function commitStateProposal(
  discussionId: string,
  proposal: StateProposal,
  prediction: { stateVersion: number; round: number }
): Promise<DiscussionState> {
  const d = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!d) throw new Error("讨论不存在");
  if (d.stateVersion !== prediction.stateVersion) {
    throw new DiscussionStateConflictError();
  }
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
    participantStatuses: [],
  };
  await prisma.discussion.update({
    where: { id: discussionId },
    data: {
      discussionState: newState as unknown as object,
      stateVersion: { increment: 1 },
      summaryBox: proposal.summary, // 展示投影
    },
  });
  publish(discussionId, { type: "change" });
  return newState;
}

/** 主循环：rounds 轮，每轮按顺序跑每个人格，然后 Moderator 汇总并原子提交 */
export async function runDiscussion(discussionId: string): Promise<void> {
  const d = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!d) return;
  const personaIds = (d.personaIds as string[]) ?? [];
  if (personaIds.length < 1) {
    await prisma.discussion.update({ where: { id: discussionId }, data: { status: "failed" } });
    return;
  }

  let state: DiscussionState = ((d.discussionState as unknown) ?? emptyState(d.brief)) as DiscussionState;

  await prisma.discussion.update({ where: { id: discussionId }, data: { status: "running" } });
  publish(discussionId, { type: "change" });

  try {
    for (let round = 1; round <= d.rounds; round++) {
      const roundOutputs: { name: string; text: string }[] = [];
      const acceptedMessageIds: string[] = [];

      for (const personaId of participantOrder(discussionId, personaIds)) {
        const persona = await prisma.persona.findUnique({ where: { id: personaId } });
        if (!persona) continue;
        // 轮次开始前的用户 steer（从 state.userSteers 提取未消费的）
        const steers = pendingSteers(state.userSteers ?? [], personaId);
        const prompt = buildGroupPersonaPrompt(persona.name, persona.systemPrompt, d.brief, round, state, roundOutputs, steers);

        try {
          const { participant } = await ensurePersonaSession(discussionId, personaId);
          await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "running" } });
          publish(discussionId, { type: "change" });

          // 记录本回合输入快照（供失败重试用）
          const turn = await prisma.discussionTurn.create({
            data: {
              discussionId,
              participantId: participant.id,
              sessionId: participant.dshSessionId,
              kind: "persona",
              round,
              attempt: 1,
              inputSnapshot: { prompt, stateVersion: state.round } as unknown as object,
              status: "running",
            },
          });

          const text = (await runTurnViaDsh(participant.dshSessionId, prompt)).trim();
          if (text) {
            const msg = await prisma.discussionMessage.create({
              data: {
                discussionId,
                personaId,
                participantId: participant.id,
                sessionId: participant.dshSessionId,
                sender: persona.name,
                role: "persona",
                turn: round,
                content: text,
              },
            });
            roundOutputs.push({ name: persona.name, text: text.slice(0, 120) });
            acceptedMessageIds.push(msg.id);
            await prisma.discussionTurn.update({
              where: { id: turn.id },
              data: { status: "completed", outputMessageId: msg.id, completedAt: new Date() },
            });
          } else {
            await prisma.discussionTurn.update({
              where: { id: turn.id },
              data: { status: "completed", completedAt: new Date() },
            });
          }
          await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { status: "completed" } });
        } catch (e) {
          // 单 Persona 回合失败：标记 failed，继续同轮其他人格
          const error = e instanceof Error ? e.message : String(e);
          const participant = await prisma.discussionParticipant.findFirst({ where: { discussionId, personaId } });
          if (participant) {
            await prisma.discussionTurn.updateMany({
              where: { participantId: participant.id, status: "running" },
              data: { status: "failed", errorCode: "DSH_TURN_FAILED", errorMessage: error, completedAt: new Date() },
            });
            await prisma.discussionParticipant.update({
              where: { id: participant.id },
              data: { status: "failed", lastError: error },
            });
          }
          publish(discussionId, { type: "change" });
        }
      }

      // Moderator 汇总（独立 Session；每回合用全新 session，避免复用已完结 session 空回复）
      const moderatorSessionId = d.moderatorSessionId ?? `bt-discussion-${discussionId}-moderator`;
      if (!d.moderatorSessionId) {
        await prisma.discussion.update({ where: { id: discussionId }, data: { moderatorSessionId } });
        writeModeratorManifestForSession(moderatorSessionId, discussionId);
      }
      let proposal: StateProposal;
      try {
        proposal = await runModeratorTurn(discussionId, round, state, acceptedMessageIds, moderatorSessionId, 1);
      } catch (e) {
        // 重试一次（模型输出可能不稳定）
        try {
          proposal = await runModeratorTurn(discussionId, round, state, acceptedMessageIds, moderatorSessionId, 2);
        } catch {
          // 兜底：用本轮人格回复作为共识摘要，保证讨论能完成
          proposal = {
            schemaVersion: 1,
            basedOnStateVersion: state.round,
            round,
            summary: roundOutputs.map((o) => `${o.name}：${o.text}`).join("\n") || state.summary,
            evidence: [],
            decisions: [],
            openQuestions: [],
            acceptedMessageIds,
          };
        }
      }

      state = await commitStateProposal(discussionId, proposal, {
        stateVersion: d.stateVersion + (round - 1),
        round,
      });
      await prisma.discussion.update({ where: { id: discussionId }, data: { moderatorStatus: "completed" } });
      publish(discussionId, { type: "change" });
    }

    await prisma.discussion.update({ where: { id: discussionId }, data: { status: "done" } });
    publish(discussionId, { type: "change" });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.discussion.update({ where: { id: discussionId }, data: { status: "failed" } });
    publish(discussionId, { type: "change" });
    void error;
  } finally {
    // Runtime 常驻：仅 Drain/shutdown 时关闭；处者（如 Worker shutdown）调用 shutdownRuntime
  }
}

/** 写一个中立 Moderator 的 manifest（kind=moderator，无 Persona、无普通 Skill） */
function pendingSteers(steers: { targetParticipantIds: string[]; content: string }[], personaId: string): string[] {
  return steers
    .filter((s) => s.targetParticipantIds.length === 0 || s.targetParticipantIds.includes(personaId))
    .map((s) => s.content);
}
