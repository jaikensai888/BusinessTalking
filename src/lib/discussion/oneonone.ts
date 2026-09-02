import { generateText } from "ai";
import { prisma } from "@/lib/db";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { decrypt } from "@/lib/settings/encryption";
import { getSetting } from "@/lib/settings/store";
import { loadSkill } from "./runner";

/**
 * 单人（1 对 1）讨论的即时作答：
 * 用户每发一条消息，该人设立刻针对这条消息回应（你问我答），不做多轮自动讨论。
 * 上下文取自本讨论的历史消息，保证连续追问时人设记得前文。
 */
export async function replyOneOnOne(
  discussionId: string,
  personaId: string,
  question: string
): Promise<string> {
  const d = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!d) return "（讨论不存在）";
  const persona = await prisma.persona.findUnique({ where: { id: personaId } });
  if (!persona) return "（人格不存在）";

  const [providerRaw, baseUrl, keyCipher, modelRaw, timeoutRaw] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);
  const provider = normalizeProvider(providerRaw);
  const apiKey = keyCipher ? decrypt(keyCipher) : "";
  if (!apiKey) return "（未配置有效的 API Key）";
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
    loadSkill(persona.skillPath, persona.systemPrompt) +
    `\n\n【讨论背景】\n${d.brief}` +
    `\n\n你现在是「${persona.name}」。请以你的立场与风格，直接回答用户刚刚提出的问题。用第一人称，简洁、有观点、不绕弯。`;

  try {
    const modelObj = buildModel(provider, apiKey, model, baseUrl || undefined);
    const { text } = await generateText({
      model: modelObj,
      system: sys,
      messages: [...history, { role: "user" as const, content: question }],
      abortSignal: AbortSignal.timeout(Math.min(Number(timeoutRaw ?? 120) * 1000, 120000)),
    });
    return text.trim() || "（无回应）";
  } catch (e) {
    return `（回答失败：${e instanceof Error ? e.message : String(e)}）`;
  }
}
