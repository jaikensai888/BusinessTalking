/**
 * 1v1 DSH SSE 适配（见方案 §7.1）。沿用 delta/done/error 事件名；
 * DSH SDK 第一阶段按完整 assistant/message 发送一条 final delta（不承诺 token 级流式）。
 * SSE 断开不取消 DSH Session；客户端重连后按 Discussion API 读取持久化状态。
 * 广播只做实时提醒，不作为唯一数据源。
 */
import { runOneOnOneTurn } from "./dsh-service";
import { DshError } from "@/lib/dsh/errors";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;
const encoder = new TextEncoder();

function frame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function errorResponse(message: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(frame({ type: "error", message }));
      c.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

/** 1v1 SSE：调用 DSH service 跑一轮，把完整回复作为一条 final delta 推送后 done */
export function streamOneOnOneDsh(
  discussionId: string,
  personaId: string,
  question: string,
  init?: { id: string; shortId: string | null }
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (init) controller.enqueue(frame({ type: "init", id: init.id, shortId: init.shortId }));
        const res = await runOneOnOneTurn(discussionId, personaId, question);
        if (res.status === "failed") {
          controller.enqueue(frame({ type: "error", message: res.error ?? "DSH 回合失败" }));
        } else {
          if (res.finalText) controller.enqueue(frame({ type: "delta", text: res.finalText }));
          controller.enqueue(frame({ type: "done" }));
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof DshError ? e.message : e instanceof Error ? e.message : String(e);
        controller.enqueue(frame({ type: "error", message: msg }));
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
