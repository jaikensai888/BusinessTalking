import { streamText } from "ai";
import { err } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { decrypt } from "@/lib/settings/encryption";
import { getSetting } from "@/lib/settings/store";
import { llmTimeoutMs } from "@/lib/llm/timeout";

const encoder = new TextEncoder();

/** 把 AI SDK 的文本增量封装成 SSE data 帧 */
function sseFrame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** POST /api/v1/personas/:id/chat — 与人格多轮对话（SSE 流式：逐字返回回答） */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/personas/[id]/chat">) {
  const { id } = await ctx.params;
  const persona = await prisma.persona.findUnique({
    where: { id },
    select: { id: true, name: true, systemPrompt: true },
  });
  if (!persona) return err(40401, "人格不存在", 404);

  let body: { message?: unknown; conversationId?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 5000) return err(40001, "message 必填（1~5000 字符）", 400);
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;

  let conversation;
  const isNewConversation = !conversationId;
  if (conversationId) {
    conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.personaId !== persona.id) {
      return err(40401, "会话不存在或不属于该人格", 404);
    }
  } else {
    conversation = await prisma.conversation.create({
      data: { personaId: persona.id, title: message.slice(0, 40) },
    });
  }

  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
  });

  const [providerRaw, baseUrl, keyCipher, modelRaw, timeoutRaw] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);
  const provider = normalizeProvider(providerRaw);
  const apiKey = keyCipher ? decrypt(keyCipher) : "";
  if (!apiKey) {
    return err(50201, "未配置有效的 API Key，请先在设置中填写", 502);
  }

  // 先落用户消息，保证会话存在且历史连续
  const userMsg = await prisma.message.create({
    data: { conversationId: conversation.id, role: "user", content: message },
  });

  try {
    const modelObj = buildModel(provider, apiKey, modelRaw ?? "", baseUrl || undefined);
    const result = streamText({
      model: modelObj,
      system: persona.systemPrompt,
      messages: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: message },
      ],
      abortSignal: AbortSignal.timeout(llmTimeoutMs(timeoutRaw)),
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let full = "";
        try {
          for await (const chunk of result.textStream) {
            full += chunk;
            controller.enqueue(sseFrame({ type: "delta", text: chunk }));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          controller.enqueue(sseFrame({ type: "error", message: `回答中断：${msg}` }));
          controller.close();
          return;
        }
        try {
          const saved = await prisma.message.create({
            data: { conversationId: conversation.id, role: "assistant", content: full.trim() || "（无回应）" },
          });
          // 触达 updatedAt 用于会话排序
          await prisma.conversation.update({ where: { id: conversation.id }, data: { title: conversation.title } });
          controller.enqueue(sseFrame({ type: "done", conversationId: conversation.id, messageId: saved.id }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          controller.enqueue(sseFrame({ type: "error", message: `保存失败：${msg}` }));
        }
        controller.close();
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
  } catch (e) {
    // 模型装配等前置失败：回滚本次用户消息与新建会话，避免孤立数据
    await prisma.message.delete({ where: { id: userMsg.id } }).catch(() => undefined);
    if (isNewConversation) {
      await prisma.conversation.delete({ where: { id: conversation.id } }).catch(() => undefined);
    }
    return err(50201, `LLM 调用失败：${e instanceof Error ? e.message : String(e)}`, 502);
  }
}
