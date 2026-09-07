"use client";

import { useEffect, useRef, useState } from "react";
import {
  emptyProcessState,
  reduceDiscussionEvent,
  type DiscussionLiveEvent,
  type DiscussionProjectionEvent,
  type DshProcessState,
} from "@/lib/discussion/dsh-turn-projection";

export interface DiscussionSseFrame {
  event: string;
  data: Record<string, unknown>;
}
export interface DiscussionEventsHookState {
  cursor: number;
  process: DshProcessState;
  connected: boolean;
  reconnecting: boolean;
  streamError?: string;
}

export function emptyHookState(): DiscussionEventsHookState {
  return {
    cursor: 0,
    process: emptyProcessState(),
    connected: false,
    reconnecting: false,
  };
}

/** Parse one complete SSE frame. Comment-only frames are heartbeat noise. */
export function parseDiscussionSseFrame(frame: string): DiscussionSseFrame | null {
  const eventLines: string[] = [];
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      const event = line.slice("event:".length).trim();
      if (event) eventLines.push(event);
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return { event: eventLines[0] ?? "message", data: parsed as Record<string, unknown> };
}

export function nextReconnectDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) && attempt >= 0 ? Math.floor(attempt) : 0;
  return Math.min(30_000, 250 * 2 ** Math.min(safeAttempt, 7));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDiscussionLiveEvent(value: unknown): value is DiscussionLiveEvent {
  if (!isRecord(value)) return false;
  return value.type === "dsh-event"
    && typeof value.discussionId === "string"
    && Number.isSafeInteger(value.discussionSeq)
    && typeof value.sessionId === "string"
    && Number.isSafeInteger(value.seq)
    && typeof value.eventType === "string"
    && isRecord(value.data);
}

function isApprovalEvent(value: unknown): value is DiscussionProjectionEvent {
  if (!isRecord(value)) return false;
  if (value.type !== "approval-request" && value.type !== "approval-decision") return false;
  return typeof value.approvalId === "string"
    && typeof value.discussionId === "string"
    && typeof value.sessionId === "string"
    && typeof value.toolName === "string";
}

function streamErrorMessage(data: Record<string, unknown>): string {
  if (typeof data.message === "string" && data.message) return data.message.slice(0, 300);
  if (typeof data.error === "string" && data.error) return data.error.slice(0, 300);
  if (data.type === "stream-gap") return "实时事件流出现缺口，正在重新同步";
  return "实时事件流已断开，正在重连";
}

/** Apply one parsed SSE frame without changing the durable cursor for ephemeral frames. */
export function applyDiscussionSseFrame(
  state: DiscussionEventsHookState,
  frame: DiscussionSseFrame,
): DiscussionEventsHookState {
  if (frame.event === "ready") {
    const readyCursor = Number.isSafeInteger(frame.data.cursor) && (frame.data.cursor as number) >= 0
      ? frame.data.cursor as number
      : state.cursor;
    const cursor = Math.max(state.cursor, readyCursor);
    return {
      ...state,
      cursor,
      process: {
        ...state.process,
        cursor: Math.max(state.process.cursor, readyCursor),
        needsResync: false,
        streamError: undefined,
      },
      connected: true,
      reconnecting: false,
      streamError: undefined,
    };
  }

  if (frame.event === "dsh" && isDiscussionLiveEvent(frame.data)) {
    const reduced = reduceDiscussionEvent(state.process, frame.data);
    return {
      ...state,
      cursor: reduced.cursor,
      process: reduced,
      connected: true,
      reconnecting: false,
      ...(reduced.streamError ? { streamError: reduced.streamError } : {}),
    };
  }

  if (frame.event === "approval" && isApprovalEvent(frame.data)) {
    const reduced = reduceDiscussionEvent(state.process, frame.data);
    return { ...state, process: reduced, connected: true, reconnecting: false };
  }

  if (frame.event === "error") {
    const message = streamErrorMessage(frame.data);
    return {
      ...state,
      streamError: message,
      process: {
        ...state.process,
        ...(frame.data.type === "stream-gap" ? { needsResync: true, streamError: message } : {}),
      },
      connected: false,
      reconnecting: true,
    };
  }

  return state;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 300);
  return "实时事件流已断开，正在重连";
}

/**
 * Consume the replayable discussion stream. Durable DSH frames advance the
 * cursor; approval frames are deliberately ephemeral and are never used as a
 * replay cursor. A reconnect always resumes from the last contiguous event.
 */
export function useDiscussionEvents(
  discussionId: string | null,
  onFrame?: (frame: DiscussionSseFrame) => void,
): DiscussionEventsHookState {
  const [state, setState] = useState<DiscussionEventsHookState>(emptyHookState);
  const stateRef = useRef(state);
  const onFrameRef = useRef(onFrame);
  const cursorRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;
    let attempt = 0;

    if (!discussionId) {
      cursorRef.current = 0;
      stateRef.current = emptyHookState();
      setState(stateRef.current);
      return () => undefined;
    }

    cursorRef.current = 0;
    stateRef.current = emptyHookState();
    setState(stateRef.current);

    const update = (next: DiscussionEventsHookState) => {
      if (disposed) return;
      stateRef.current = next;
      cursorRef.current = next.cursor;
      setState(next);
    };

    const scheduleReconnect = (message?: string) => {
      if (disposed || reconnectTimer) return;
      attempt = Math.min(attempt + 1, 99);
      const delay = nextReconnectDelay(attempt - 1);
      const current = stateRef.current;
      update({
        ...current,
        connected: false,
        reconnecting: true,
        ...(message ? { streamError: message } : {}),
      });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const consumeFrame = (frame: DiscussionSseFrame, controller: AbortController) => {
      onFrameRef.current?.(frame);
      const next = applyDiscussionSseFrame(stateRef.current, frame);
      update(next);
      if (next.process.needsResync) {
        controller.abort();
      }
    };

    const connect = async () => {
      if (disposed) return;
      // A prior gap must not make the reducer ignore the replay that follows.
      if (stateRef.current.process.needsResync) {
        update({
          ...stateRef.current,
          process: { ...stateRef.current.process, needsResync: false, streamError: undefined },
        });
      }

      const controller = new AbortController();
      activeController = controller;
      update({ ...stateRef.current, reconnecting: attempt > 0, streamError: undefined });

      try {
        const response = await fetch(
          `/api/v1/discussions/${encodeURIComponent(discussionId)}/stream?after=${cursorRef.current}`,
          { headers: { Accept: "text/event-stream" }, signal: controller.signal },
        );
        if (!response.ok) throw new Error(`实时事件流请求失败（${response.status}）`);
        if (!response.body) throw new Error("实时事件流没有响应体");

        update({ ...stateRef.current, connected: true, reconnecting: false, streamError: undefined });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!disposed && !controller.signal.aborted) {
          const result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const raw of frames) {
            const frame = parseDiscussionSseFrame(raw);
            if (frame) consumeFrame(frame, controller);
          }
        }
        if (!disposed && !controller.signal.aborted) {
          scheduleReconnect();
        } else if (!disposed && controller.signal.aborted && stateRef.current.process.needsResync) {
          scheduleReconnect(stateRef.current.streamError ?? "实时事件流需要重新同步");
        }
      } catch (error) {
        if (disposed || (isAbortError(error) && !stateRef.current.process.needsResync)) return;
        scheduleReconnect(errorMessage(error));
      } finally {
        if (activeController === controller) activeController = null;
      }
    };

    void connect();
    return () => {
      disposed = true;
      activeController?.abort();
      activeController = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };
  }, [discussionId]);

  return state;
}
