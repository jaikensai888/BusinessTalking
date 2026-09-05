/**
 * DSH 原始事件投影（见方案 §5.4）。把 Runtime 通知转成 AgentEvent 数据，
 * 清理凭据/请求 header/绝对路径后交给持久化层；并提取最终 assistant 文本供
 * Discussion service 写 DiscussionMessage。
 *
 * 本文件只做纯转换（可测试），持久化在 `persistAgentEvents`（Prisma upsert）。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface SessionEventLike {
  type: string;
  seq: number;
  time?: number;
  data?: unknown;
}

export interface DshNotification {
  method: string;
  params: Record<string, unknown>;
}

export interface MappedEvent {
  sessionId: string;
  seq: number;
  eventType: string;
  data: Record<string, unknown>;
}

/** 可选的最终 assistant 文本提取结果 */
export interface ProjectedText {
  sessionId: string;
  seq: number;
  text: string;
}

/** 关键 key：保存时从 payload 中清除 */
const SENSITIVE_KEYS = new Set([
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "password",
  "token",
  "secret",
]);

/** 绝对/内部路径前缀：从 payload 中清除（避免泄漏宿主路径） */
const INTERNAL_PATH_PREFIXES = [
  "G:\\claude_project",
  "G:/claude_project",
  "C:\\Users\\jaike",
  process.cwd(),
];

/**
 * 从一条 `session.event` 通知提取 { sessionId, seq, eventType, data }。
 * 非 session.event 通知返回 null。
 */
export function extractEvent(notification: DshNotification): MappedEvent | null {
  if (notification.method !== "session.event") return null;
  const params = notification.params as { sessionId?: string; event?: SessionEventLike };
  const event = params.event;
  if (!params.sessionId || !event || typeof event.type !== "string" || typeof event.seq !== "number") {
    return null;
  }
  return {
    sessionId: params.sessionId,
    seq: event.seq,
    eventType: event.type,
    data: (event.data ?? {}) as Record<string, unknown>,
  };
}

/** 递归清理 payload 中的敏感字段与内部绝对路径 */
export function sanitizeData<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sanitizeData(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      if (typeof v === "string" && INTERNAL_PATH_PREFIXES.some((p) => p && v.includes(p))) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizeData(v);
    }
    return out as T;
  }
  return value;
}

/** 从 `assistant/message` 事件 data 提取完整 assistant 文本 */
export function extractAssistantText(data: Record<string, unknown>): string {
  // 兼容两种形状：{ message: { content: [...] } } 与 { content: [...] }
  const msg = (data.message as { content?: unknown } | undefined) ?? data;
  const content = Array.isArray(msg.content) ? msg.content : [];
  const texts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const t = (block as { text?: string }).text;
      if (typeof t === "string") texts.push(t);
    } else if (typeof block === "string") {
      texts.push(block);
    }
  }
  return texts.join("");
}

/** 是否为最终 assistant message（用于投影 DiscussionMessage） */
export function isFinalAssistantMessage(eventType: string): boolean {
  return eventType === "assistant/message";
}

/**
 * 持久化一条通知转换出的 AgentEvent：按 (sessionId, seq) upsert 去重。
 * @returns 该事件是否新写入（重复跳过返回 false）。
 */
export async function persistAgentEvent(discussionId: string, mapped: MappedEvent): Promise<boolean> {
  const payload = sanitizeData(mapped.data) as Prisma.InputJsonValue;
  try {
    await prisma.agentEvent.upsert({
      where: { sessionId_seq: { sessionId: mapped.sessionId, seq: mapped.seq } },
      update: {},
      create: {
        discussionId,
        sessionId: mapped.sessionId,
        seq: mapped.seq,
        eventType: mapped.eventType,
        payload,
      },
    });
    return true;
  } catch (e) {
    // upsert 唯一冲突（并发重复）视为已持久化，不抛
    if ((e as { code?: string }).code === "P2002") return false;
    throw e;
  }
}

/**
 * 把一次 run 收到的全部通知批量持久化（按 sessionId+seq 去重）。
 * 返回最终 assistant 文本（若有）与写入计数。
 */
export async function persistAgentEvents(
  discussionId: string,
  notifications: DshNotification[]
): Promise<{ written: number; finalText: string; finalSeq: number | null }> {
  let written = 0;
  let finalText = "";
  let finalSeq: number | null = null;
  for (const n of notifications) {
    const mapped = extractEvent(n);
    if (!mapped) continue;
    if (await persistAgentEvent(discussionId, mapped)) written++;
    if (isFinalAssistantMessage(mapped.eventType)) {
      const text = extractAssistantText(mapped.data);
      if (text) {
        finalText = text;
        finalSeq = mapped.seq;
      }
    }
  }
  return { written, finalText, finalSeq };
}
