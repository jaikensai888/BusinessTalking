import { streamText } from "ai";
import { err } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { decrypt } from "@/lib/settings/encryption";
import { getSetting } from "@/lib/settings/store";
import { llmTimeoutMs } from "@/lib/llm/timeout";
import { loadSkill } from "@/lib/discussion/runner";

const encoder = new TextEncoder();
/** 把 AI SDK 文本增量封装成 SSE data 帧 */
function sseFrame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * POST /api/v1/discussions/:id/followup — 讨论结束后，请某个在讨论中的人格就整场讨论单独追问。
 *
 * 上下文 = 该人格自己的历史（它自己的发言 + 用户消息）+ 共享纪要 summaryBox + 讨论背景；
 * 用 streamText 逐字流式（SSE），最后把这次追问落库到该讨论。
 */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/followup">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) return err(40401, "讨论不存在", 404);

  let body: { personaId?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }
  const personaId = typeof body.personaId === "string" ? body.personaId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!personaId) return err(40001, "personaId 必填", 400);
  if (!message || message.length > 5000) return err(40001, "message 必填（1~5000 字符）", 400);

  const persona = await prisma.persona.findUnique({ where: { id: personaId } });
  if (!persona) return err(40401, "人格不存在", 404);
  const personaIds = (d.personaIds as string[]) ?? [];
  if (!personaIds.includes(personaId)) return err(40001, "该人格不在本次讨论中", 400);

  const [providerRaw, baseUrl, keyCipher, modelRaw, timeoutRaw] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);
  const provider = normalizeProvider(providerRaw);
  const apiKey = keyCipher ? decrypt(keyCipher) : "";
  if (!apiKey) return err(50201, "未配置有效的 API Key，请先在设置中填写", 502);

  // 先落用户追问，保证失败也保留问题
  const userMsg = await prisma.discussionMessage.create({
    data: { discussionId: id, role: "user", sender: "你", turn: 0, content: message },
  });

  try {
    // 该人格视角的历史：它自己的发言 + 用户消息（共享），按时间排序
    const all = await prisma.discussionMessage.findMany({
      where: { discussionId: id },
      orderBy: { createdAt: "asc" },
    });
    const history = all
      .filter((m) => m.role === "user" || (m.role === "persona" && m.personaId === personaId))
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }) as const);
    // 去掉刚写入的这条用户消息，最后再以 message 作为提问
    if (history.length && history[history.length - 1].role === "user" && history[history.length - 1].content === message) {
      history.pop();
    }

    const sys =
      loadSkill(persona.skillPath, persona.systemPrompt) +
      `\n\n【讨论背景】\n${d.brief}` +
      `\n\n【讨论要点/共识】\n${d.summaryBox ?? ""}` +
      `\n\n你现在是「${persona.name}」。用户就这次讨论向你单独追问。请以你的立场与风格直接回答，用第一人称，简洁、有观点、不绕弯。`;

    const modelObj = buildModel(provider, apiKey, modelRaw ?? "", baseUrl || undefined);
    const result = streamText({
      model: modelObj,
      system: sys,
      messages: [...history.slice(-12), { role: "user" as const, content: message }],
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
          await prisma.discussionMessage.create({
            data: { discussionId: id, personaId, sender: persona.name, role: "persona", turn: 0, content: full.trim() || "（无回应）" },
          });
          controller.enqueue(sseFrame({ type: "done" }));
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
    // 装配等前置失败：回滚本次用户消息
    await prisma.discussionMessage.delete({ where: { id: userMsg.id } }).catch(() => undefined);
    return err(50201, `LLM 调用失败：${e instanceof Error ? e.message : String(e)}`, 502);
  }
}
