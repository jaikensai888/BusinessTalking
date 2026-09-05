export interface LiveMessage {
  role?: string;
  content?: string | null;
}

export interface LiveParticipant {
  status?: string;
  lastError?: string | null;
}

export interface LiveDiscussionSnapshot {
  status?: string;
  personas?: readonly unknown[];
  messages?: readonly LiveMessage[];
  participants?: readonly LiveParticipant[];
}

/** 只有本轮新增的、非空 persona 消息才能结束等待。 */
export function hasNewPersonaReply(messages: readonly LiveMessage[], previousReplyCount: number): boolean {
  const replyCount = messages.filter(
    (message) => message.role === "persona" && (message.content ?? "").trim().length > 0
  ).length;
  return replyCount > previousReplyCount;
}

/** 读取 1v1 的失败状态；重试已进入 pending/running 时暂不显示旧失败。 */
export function getOneOnOneFailure(snapshot: LiveDiscussionSnapshot): string | null {
  if ((snapshot.personas?.length ?? 0) !== 1) return null;

  const participants = snapshot.participants ?? [];
  if (participants.some((participant) => participant.status === "pending" || participant.status === "running")) {
    return null;
  }

  const failedParticipant = participants.find((participant) => participant.status === "failed");
  if (snapshot.status !== "failed" && !failedParticipant) return null;

  const message = failedParticipant?.lastError?.trim();
  return message || "讨论失败，请稍后重试";
}

/**
 * 1v1 的 Discussion.status 在生成期间也可能是 ready；消息顺序才是可靠信号。
 * 最后一条仍是 user，表示该问题还没有对应的 persona 回复。
 */
export function isOneOnOneReplyPending(snapshot: LiveDiscussionSnapshot): boolean {
  if (getOneOnOneFailure(snapshot)) return false;
  const messages = snapshot.messages ?? [];
  return messages.length > 0 && messages[messages.length - 1]?.role === "user";
}
