/**
 * DiscussionState 与 StateProposal（见方案 §3.4）。
 * DefinitionState 是多人讨论的事实来源；summaryBox 只是展示投影。
 * 用 Zod 严格校验，禁止任意字符串替代结构化字段。
 */
import { z } from "zod";

export const EvidenceSchema = z.object({
  id: z.string(),
  claim: z.string(),
  sourceMessageIds: z.array(z.string()),
  sourceEventIds: z.array(z.string()),
});

export const UserSteerSchema = z.object({
  id: z.string(),
  content: z.string(),
  targetParticipantIds: z.array(z.string()),
  createdAt: z.string(),
});

export const ParticipantStatusSchema = z.object({
  participantId: z.string(),
  status: z.string(),
  lastOutputMessageId: z.string().optional(),
});

export const DiscussionStateSchema = z.object({
  schemaVersion: z.literal(1),
  brief: z.string(),
  round: z.number().int().min(0),
  summary: z.string(),
  evidence: z.array(EvidenceSchema),
  decisions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  userSteers: z.array(UserSteerSchema),
  participantStatuses: z.array(ParticipantStatusSchema),
});

export const StateProposalSchema = z.object({
  schemaVersion: z.literal(1),
  basedOnStateVersion: z.number().int().min(0),
  round: z.number().int().min(0),
  summary: z.string(),
  evidence: z.array(EvidenceSchema).default([]),
  decisions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  acceptedMessageIds: z.array(z.string()),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type UserSteer = z.infer<typeof UserSteerSchema>;
export type ParticipantStatus = z.infer<typeof ParticipantStatusSchema>;
export type DiscussionState = z.infer<typeof DiscussionStateSchema>;
export type StateProposal = z.infer<typeof StateProposalSchema>;

/** 新讨论的初始（空）状态 */
export function emptyState(brief: string): DiscussionState {
  return {
    schemaVersion: 1,
    brief,
    round: 0,
    summary: brief,
    evidence: [],
    decisions: [],
    openQuestions: [],
    userSteers: [],
    participantStatuses: [],
  };
}

/** 严格解析 StateProposal；失败抛错（不修复、不截断） */
export function parseStateProposal(input: unknown): StateProposal {
  const res = StateProposalSchema.safeParse(input);
  if (!res.success) {
    const e = new Error(`StateProposal 校验失败：${res.error.message}`);
    (e as { code?: string }).code = "PROPOSAL_INVALID";
    throw e;
  }
  return res.data;
}

/** 严格解析保存/读取的 DiscussionState */
export function parseDiscussionState(input: unknown): DiscussionState {
  const res = DiscussionStateSchema.safeParse(input);
  if (!res.success) {
    const e = new Error(`DiscussionState 校验失败：${res.error.message}`);
    (e as { code?: string }).code = "STATE_INVALID";
    throw e;
  }
  return res.data;
}
