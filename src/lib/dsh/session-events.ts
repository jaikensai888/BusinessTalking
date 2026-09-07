import type { DshNotification } from "./events";
import { sanitizeData } from "./events";

/** Maximum size of one JSONL frame accepted from the child runner. */
export const MAX_RUNNER_FRAME_BYTES = 2 * 1024 * 1024;

export interface RunnerRunCommand {
  type: "run";
  requestId: string;
  sessionId: string;
  prompt: string;
}

export interface MappedSessionEvent {
  sessionId: string;
  seq: number;
  eventType: string;
  eventTimeMs: number | null;
  data: Record<string, unknown>;
}

/** Compatibility alias for code that refers to the mapped event generically. */
export type MappedEvent = MappedSessionEvent;

export interface DiscussionLiveEvent {
  type: "dsh-event";
  discussionId: string;
  discussionSeq: number;
  participantId: string | null;
  sessionId: string;
  seq: number;
  eventType: string;
  eventTimeMs: number | null;
  data: Record<string, unknown>;
}

export interface RunnerReadyFrame {
  type: "ready";
}

export interface RunnerEventFrame {
  type: "event";
  requestId: string;
  sessionId: string;
  notification: DshNotification;
}

export interface RunnerDoneFrame {
  type: "done";
  requestId: string;
  sessionId: string;
  finalResponse: string;
}

export interface RunnerErrorFrame {
  type: "error";
  requestId?: string;
  code: string;
  stage: string;
  error: string;
}

export interface RunnerFatalFrame {
  type: "fatal";
  code: string;
  stage: string;
  error: string;
}

export type RunnerFrame =
  | RunnerReadyFrame
  | RunnerEventFrame
  | RunnerDoneFrame
  | RunnerErrorFrame
  | RunnerFatalFrame;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}

export function isDshNotification(value: unknown): value is DshNotification {
  if (!isRecord(value) || typeof value.method !== "string") return false;
  return isRecord(value.params);
}

function parseEventFrame(value: Record<string, unknown>): RunnerEventFrame {
  const notification = value.notification;
  if (!isDshNotification(notification)) {
    throw new Error("notification must be a DSH notification");
  }
  return {
    type: "event",
    requestId: requireString(value.requestId, "requestId"),
    sessionId: requireString(value.sessionId, "sessionId"),
    notification,
  };
}

function parseDoneFrame(value: Record<string, unknown>): RunnerDoneFrame {
  return {
    type: "done",
    requestId: requireString(value.requestId, "requestId"),
    sessionId: requireString(value.sessionId, "sessionId"),
    finalResponse: stringValue(value.finalResponse, "finalResponse"),
  };
}

function parseErrorFrame(value: Record<string, unknown>): RunnerErrorFrame {
  if (value.requestId !== undefined) requireString(value.requestId, "requestId");
  return {
    type: "error",
    ...(value.requestId === undefined ? {} : { requestId: value.requestId as string }),
    code: requireString(value.code, "code"),
    stage: requireString(value.stage, "stage"),
    error: requireString(value.error, "error"),
  };
}

function parseFatalFrame(value: Record<string, unknown>): RunnerFatalFrame {
  return {
    type: "fatal",
    code: requireString(value.code, "code"),
    stage: requireString(value.stage, "stage"),
    error: requireString(value.error, "error"),
  };
}

/** Parse and validate exactly one line from the persistent runner protocol. */
export function parseRunnerFrame(line: string): RunnerFrame {
  if (typeof line !== "string") throw new Error("runner frame must be a string");
  if (line.trim().length === 0) throw new Error("empty runner frame");
  const bytes = new TextEncoder().encode(line).byteLength;
  if (bytes > MAX_RUNNER_FRAME_BYTES) throw new Error("runner frame is too large");

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("invalid runner frame JSON");
  }
  const frame = requireObject(value, "runner frame");
  switch (frame.type) {
    case "ready":
      return { type: "ready" };
    case "event":
      return parseEventFrame(frame);
    case "done":
      return parseDoneFrame(frame);
    case "error":
      return parseErrorFrame(frame);
    case "fatal":
      return parseFatalFrame(frame);
    default:
      throw new Error("unknown runner frame type");
  }
}

function safeString(value: unknown, maxLength = 16_000): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return safeString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeValue(item, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      const next = safeValue(item, depth + 1);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return undefined;
}

function safeRecord(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeData(isRecord(value) ? value : {}) as unknown;
  return (safeValue(sanitized) as Record<string, unknown> | undefined) ?? {};
}

function pickStrings(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = safeString(source[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function projectAssistantContent(data: Record<string, unknown>): Record<string, unknown> {
  const message = isRecord(data.message) ? data.message : data;
  const content = Array.isArray(message.content) ? message.content : [];
  const projected = content.flatMap((block) => {
    if (!isRecord(block)) return [];
    const type = block.type;
    if (type !== "text" && type !== "reasoning" && type !== "thinking") return [];
    const text = safeString(block.text ?? block.content);
    return text === undefined ? [] : [{ type, text }];
  });
  return { content: projected };
}

function nestedToolResult(data: Record<string, unknown>): Record<string, unknown> | null {
  const message = isRecord(data.message) ? data.message : data;
  const content = Array.isArray(message.content) ? message.content : [];
  const result = content.find((block) => isRecord(block) && (block.type === "tool-result" || block.type === "tool_result"));
  return isRecord(result) ? result : null;
}

function toolResultText(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === "string") return safeString(value);
  if (!Array.isArray(value)) return undefined;
  const textParts = value.flatMap((block) => {
    if (typeof block === "string") return [block];
    if (!isRecord(block)) return [];
    const nested = toolResultText(block.text ?? block.content, depth + 1);
    return nested ? [nested] : [];
  });
  return textParts.length > 0 ? safeString(textParts.join("\n")) : undefined;
}

function projectToolResult(data: Record<string, unknown>): Record<string, unknown> {
  const message = isRecord(data.message) ? data.message : null;
  const source = message && isRecord(message.source) ? message.source : null;
  const nested = nestedToolResult(data);
  const callId = safeString(data.callId ?? data.id ?? source?.callId ?? nested?.toolCallId);
  const explicitStatus = safeString(data.status ?? data.outcome);
  const failed = data.isError === true || nested?.isError === true || ["error", "failed", "failure"].includes(explicitStatus?.toLowerCase() ?? "");
  const outputValue = data.output ?? data.result ?? nested?.content;
  const errorValue = data.error ?? (failed ? toolResultText(nested?.content) : undefined);
  return {
    ...(callId === undefined ? {} : { callId }),
    ...(explicitStatus === undefined && !failed ? {} : { status: failed ? "error" : explicitStatus }),
    ...(outputValue === undefined || failed ? {} : { output: safeValue(sanitizeData(outputValue)) }),
    ...(errorValue === undefined ? {} : { error: typeof errorValue === "string" ? safeString(errorValue) : safeValue(sanitizeData(errorValue)) }),
  };
}

/**
 * Keep only browser-safe fields for the live timeline. Persistence retains the
 * separately sanitized event payload; this projection is intentionally narrower.
 */
export function projectClientEvent(mapped: MappedSessionEvent): Record<string, unknown> {
  const data = safeRecord(mapped.data);
  switch (mapped.eventType) {
    case "tool/call":
    case "tool/start": {
      const projected: Record<string, unknown> = {};
      const callId = safeString(data.callId ?? data.id);
      const name = safeString(data.name ?? data.toolName);
      if (callId !== undefined) projected.callId = callId;
      if (name !== undefined) projected.name = name;
      const args = safeValue(sanitizeData(data.arguments ?? data.args));
      if (args !== undefined) projected.arguments = args;
      return projected;
    }
    case "tool/result":
    case "tool/end":
      // Tool results emitted by DSH nest callId/content under message. Read
      // only the fields projected by projectToolResult; the source payload is
      // already sanitized at extract/persistence boundaries.
      return projectToolResult(mapped.data);
    case "assistant/chunk":
    case "assistant/message":
      return projectAssistantContent(data);
    case "approval/asked":
    case "approval/decided":
      return pickStrings(data, ["id", "toolName", "callId", "reason", "outcome"]);
    case "turn/start":
    case "turn/end":
    case "step/start":
    case "step/end":
      return {
        ...pickStrings(data, ["status", "outcome", "error"]),
        ...(isRecord(data.reason) && typeof data.reason.kind === "string"
          ? { reason: { kind: data.reason.kind } }
          : {}),
        ...(data.durationMs === undefined ? {} : { durationMs: data.durationMs }),
      };
    default:
      return {};
  }
}

/** Convert an SDK `session.event` notification to a validated mapped event. */
export function extractMappedEvent(notification: DshNotification): MappedSessionEvent | null {
  if (!isDshNotification(notification) || notification.method !== "session.event") return null;
  const params = notification.params;
  const sessionId = params.sessionId;
  const event = params.event;
  if (!isRecord(event)) return null;
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  if (typeof event.type !== "string" || event.type.length === 0) return null;
  if (typeof event.seq !== "number" || !Number.isInteger(event.seq) || event.seq < 0) return null;
  const eventTimeMs = typeof event.time === "number" && Number.isFinite(event.time) ? event.time : null;
  const data = isRecord(event.data) ? event.data : {};
  return {
    sessionId,
    seq: event.seq,
    eventType: event.type,
    eventTimeMs,
    data: sanitizeData(data),
  };
}
