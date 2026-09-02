import { generateText } from "ai";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { decrypt } from "@/lib/settings/encryption";
import { getSetting } from "@/lib/settings/store";

/** POST /api/v1/discussions/:id/summary — 基于共享纪要生成综合建议 */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/summary">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) return err(40401, "讨论不存在", 404);
  if (!d.summaryBox) return err(40001, "讨论尚未产生内容", 400);

  const [providerRaw, baseUrl, keyCipher, modelRaw, timeoutRaw] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);
  const provider = normalizeProvider(providerRaw);
  const apiKey = keyCipher ? decrypt(keyCipher) : "";
  if (!apiKey) return err(50201, "未配置有效的 API Key", 502);

  let content: string;
  try {
    const modelObj = buildModel(provider, apiKey, modelRaw ?? "", baseUrl || undefined);
    const { text } = await generateText({
      model: modelObj,
      system: "你是一位资深商业顾问。综合多位专家在讨论中提出的观点，给出一份可执行、有优先级、有分歧说明的综合建议。",
      prompt: `【讨论要点】\n${d.summaryBox}\n\n请给出综合建议。`,
      abortSignal: AbortSignal.timeout(Math.min(Number(timeoutRaw ?? 120) * 1000, 120000)),
    });
    content = text.trim() || "（未能生成建议）";
  } catch (e) {
    content = `（生成建议失败：${e instanceof Error ? e.message : String(e)}）`;
  }

  await prisma.discussionMessage.create({
    data: { discussionId: id, role: "summary", sender: "综合建议", turn: d.rounds + 1, content },
  });
  await prisma.discussion.update({ where: { id }, data: { status: "done" } });

  return ok({ content });
}
