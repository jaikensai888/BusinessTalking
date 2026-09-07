import { err } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getDiscussionApprovalBridge } from "@/lib/discussion/approval-bridge";
import { listDiscussionEventsAfter } from "@/lib/discussion/event-ledger";
import { subscribe, type DiscussionBroadcastEvent } from "@/lib/discussion/broadcast";
import { AsyncQueue } from "@/lib/discussion/stream-queue";
import type { DiscussionLiveEvent } from "@/lib/dsh/session-events";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const HEARTBEAT_MS = 15_000;

function parseCursor(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function sseFrame(
  eventName: string,
  data: Record<string, unknown>,
  id?: number,
): Uint8Array {
  const idLine = id === undefined ? "" : `id: ${id}\n`;
  return encoder.encode(`event: ${eventName}\n${idLine}data: ${JSON.stringify(data)}\n\n`);
}

function approvalFrame(event: DiscussionBroadcastEvent): { id: string; data: Record<string, unknown> } | null {
  const approval = event.approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) return null;
  const approvalRecord = approval as Record<string, unknown>;
  const id = approvalRecord.approvalId;
  if (typeof id !== "string" || !id) return null;
  return {
    id,
    data: { type: event.type, ...approvalRecord },
  };
}

/**
 * GET /api/v1/discussions/:id/stream — replayable Discussion event stream.
 *
 * The listener is installed before the DB backlog query. The queue therefore
 * bridges the snapshot/live boundary without dropping a committed event.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/stream">) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const rawCursor = req.headers.get("Last-Event-ID") ?? url.searchParams.get("after");
  const after = parseCursor(rawCursor);
  if (after === null) return err(40001, "event cursor 必须是非负整数", 400);

  const discussion = await prisma.discussion.findUnique({ where: { id }, select: { id: true } });
  if (!discussion) return err(40401, "讨论不存在", 404);

  const queue = new AsyncQueue<DiscussionBroadcastEvent>();
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsub?.();
    unsub = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    queue.close();
  };

  const closeStream = () => {
    cleanup();
    try { controller?.close(); } catch { /* client disconnected */ }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      // Subscribe before starting the asynchronous backlog snapshot.
      unsub = subscribe(id, (event) => queue.push(event));

      void (async () => {
        let lastSeq = after;
        const sentApprovalIds = new Set<string>();
        try {
          const backlog = await listDiscussionEventsAfter(id, after);
          if (closed) return;

          for (const event of backlog) {
            if (event.discussionId !== id) continue;
            if (!Number.isSafeInteger(event.discussionSeq) || event.discussionSeq !== lastSeq + 1) {
              controller?.enqueue(sseFrame("error", {
                type: "stream-gap",
                expected: lastSeq + 1,
                received: event.discussionSeq,
              }));
              closeStream();
              return;
            }
            controller?.enqueue(sseFrame("dsh", event as unknown as Record<string, unknown>, event.discussionSeq));
            lastSeq = event.discussionSeq;
          }

          controller?.enqueue(sseFrame("ready", { discussionId: id, cursor: lastSeq }));
          const pending = getDiscussionApprovalBridge().listPending(id);
          for (const approval of pending) {
            const approvalKey = `approval-request:${approval.approvalId}`;
            if (sentApprovalIds.has(approvalKey)) continue;
            sentApprovalIds.add(approvalKey);
            controller?.enqueue(sseFrame("approval", { type: "approval-request", ...approval }));
          }

          heartbeat = setInterval(() => {
            if (!closed) {
              try { controller?.enqueue(encoder.encode(": heartbeat\n\n")); } catch { closeStream(); }
            }
          }, HEARTBEAT_MS);
          heartbeat.unref?.();

          while (!closed) {
            const event = await queue.next();
            if (!event || closed) break;
            if (event.type === "dsh-event") {
              const liveEvent = event as unknown as DiscussionLiveEvent;
              if (liveEvent.discussionId !== id) continue;
              const seq = liveEvent.discussionSeq;
              if (!Number.isSafeInteger(seq) || seq <= lastSeq) continue;
              if (seq !== lastSeq + 1) {
                controller?.enqueue(sseFrame("error", {
                  type: "stream-gap",
                  expected: lastSeq + 1,
                  received: seq,
                }));
                closeStream();
                break;
              }
              controller?.enqueue(sseFrame("dsh", liveEvent as unknown as Record<string, unknown>, seq));
              lastSeq = seq;
              continue;
            }
            if (event.type === "approval-request" || event.type === "approval-decision") {
              const frame = approvalFrame(event);
              if (!frame || sentApprovalIds.has(`${event.type}:${frame.id}`)) continue;
              sentApprovalIds.add(`${event.type}:${frame.id}`);
              controller?.enqueue(sseFrame("approval", frame.data));
              continue;
            }
            if (event.type === "change") {
              // Compatibility hint for non-event status projections. It has no
              // id and never advances the durable event cursor.
              controller?.enqueue(sseFrame("change", { type: "change" }));
            }
          }
        } catch (error) {
          if (!closed) {
            try {
              controller?.enqueue(sseFrame("error", {
                type: "stream-error",
                message: error instanceof Error ? error.message.slice(0, 300) : "stream failed",
              }));
            } catch { /* client disconnected */ }
            closeStream();
          }
        }
      })();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
