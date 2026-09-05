import { streamText, tool, isStepCount } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { decrypt } from "@/lib/settings/encryption";
import { getSetting } from "@/lib/settings/store";
import { llmTimeoutMs } from "@/lib/llm/timeout";
import { ensureSkillLoaded, findSkillMessage, toSkillMessage } from "./runner";
import { publish } from "./broadcast";
import { searchWeb } from "@/lib/search/web";

const textEncoder = new TextEncoder();
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;
/** 把 JSON 封装成 SSE data 帧 */
function sseFrame(payload: Record<string, unknown>): Uint8Array {
  return textEncoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}
/** 仅推一个错误帧的 SSE 响应 */
function sseError(message: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sseFrame({ type: "error", message }));
      controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

/** 联网检索工具（keyless）：供人设查证竞品/参数/市场事实 */
const webSearchTool = tool({
  description:
    "联网搜索最新的产品、竞品、参数、市场数据。当你需要具体事实、竞品名称、公司/产品规格时调用；用中文或英文都能搜。",
  parameters: z.object({
    query: z.string().describe("要搜索的查询词，尽量具体，例如：‘Loona AI桌宠 功能 价格’"),
  }),
  execute: async ({ query }) => await searchWeb(query),
});

/**
 * 单人（1 对 1）讨论的流式作答（SSE 逐字）：
 * 用户每发一条消息，该人设立刻针对这条消息回应（你问我答），不做多轮自动讨论。
 * 上下文取自本讨论的历史消息，保证连续追问时人设记得前文。
 * 用 streamText 逐字推送 {type:"delta"}，结束 {type:"done"}，失败 {type:"error"}；完整答案随后落库。
 * 可选 init：创建讨论首条消息时传，首帧推 {type:"init", id, shortId}，供调用方拿到 id。
 */
export async function streamOneOnOne(
  discussionId: string,
  personaId: string,
  question: string,
  init?: { id: string; shortId: string | null }
): Promise<Response> {
  const d = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!d) return sseError("讨论不存在");
  const persona = await prisma.persona.findUnique({ where: { id: personaId } });
  if (!persona) return sseError("人格不存在");

  // 首轮加载：把完整设定（SKILL.md + references）作为一条消息写入讨论，之后靠历史承载；
  // 系统提示只用精简的"人格身份 + 背景 + 指令 + 工具"，不再每轮把大 references 塞进 system。
  await ensureSkillLoaded(discussionId, persona);
  const skillMsg = await findSkillMessage(discussionId, personaId);

  const [providerRaw, baseUrl, keyCipher, modelRaw, timeoutRaw] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);
  const provider = normalizeProvider(providerRaw);
  const apiKey = keyCipher ? decrypt(keyCipher) : "";
  if (!apiKey) return sseError("未配置有效的 API Key，请先在设置中填写");
  const model = modelRaw ?? "";

  const all = await prisma.discussionMessage.findMany({
    where: { discussionId },
    orderBy: { createdAt: "asc" },
  });
  const convo = all
    .filter((m) => m.role === "persona" || m.role === "user")
    .map((m) => ({ role: m.role === "persona" ? "assistant" : "user", content: m.content }) as const);
  // 控制器刚写入的这条用户消息会在 all 里，去掉以避免重复作为末条；再以 question 作为最终提问。
  if (convo.length && convo[convo.length - 1].role === "user" && convo[convo.length - 1].content === question) {
    convo.pop();
  }
  const history = convo.slice(-12);

  const sys =
    persona.systemPrompt +
    `\n\n【讨论背景】\n${d.brief}` +
    `\n\n你现在是「${persona.name}」。请以你的立场与风格，直接回答用户刚刚提出的问题。用第一人称，简洁、有观点、不绕弯。` +
    `\n\n你有联网检索工具 web_search：凡需要具体事实、竞品名、规格、市场数据、算账依据时，先搜索查证（可多次搜索）再作答；不要凭空编造竞品或数字。`;

  try {
    const modelObj = buildModel(provider, apiKey, model, baseUrl || undefined);
    const result = streamText({
      model: modelObj,
      system: sys,
      messages: [
        ...(skillMsg ? [toSkillMessage(skillMsg)] : []),
        ...history,
        { role: "user" as const, content: question },
      ],
      tools: { web_search: webSearchTool },
      stopWhen: isStepCount(6),
      abortSignal: AbortSignal.timeout(llmTimeoutMs(timeoutRaw)),
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (init) controller.enqueue(sseFrame({ type: "init", id: init.id, shortId: init.shortId }));
        let full = "";
        try {
          for await (const chunk of result.textStream) {
            full += chunk;
            controller.enqueue(sseFrame({ type: "delta", text: chunk }));
          }
        } catch (e) {
          controller.enqueue(sseFrame({ type: "error", message: `回答中断：${e instanceof Error ? e.message : String(e)}` }));
          controller.close();
          return;
        }
        try {
          await prisma.discussionMessage.create({
            data: { discussionId, personaId, sender: persona.name, role: "persona", turn: 0, content: full.trim() || "（无回应）" },
          });
          publish(discussionId, { type: "change" }); // 通知其它订阅了 /stream 的标签页回源拉取
          controller.enqueue(sseFrame({ type: "done" }));
        } catch (e) {
          controller.enqueue(sseFrame({ type: "error", message: `保存失败：${e instanceof Error ? e.message : String(e)}` }));
        }
        controller.close();
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (e) {
    return sseError(`调用失败：${e instanceof Error ? e.message : String(e)}`);
  }
}
