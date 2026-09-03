import { prisma } from "@/lib/db";
import { subscribe } from "@/lib/discussion/broadcast";

const encoder = new TextEncoder();

/**
 * GET /api/v1/discussions/:id/stream — SSE：讨论进展实时推送。
 *
 * 后端后台任务每次写消息/变更状态时 publish 一个通知；本端点订阅同一 discussion id，
 * 一旦有变化就推送一个 {type:"change"}，前端收到后回源拉取最新状态并渲染。
 * 连接建立时立即先推一次，保证订阅者一进来就能拿到当前快照。
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/stream">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) return new Response("讨论不存在", { status: 404 });

  let unsub: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "change" })}\n\n`));
        } catch {
          /* controller 已关闭 */
        }
      };
      // 订阅前先推一次，让客户端立刻拉取当前状态
      send();
      unsub = subscribe(id, send);
    },
    cancel() {
      unsub?.();
      unsub = null;
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
