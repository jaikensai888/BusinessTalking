import { generateText } from "ai";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { decrypt } from "@/lib/settings/encryption";
import { getSetting } from "@/lib/settings/store";
import { saveReport } from "@/lib/discussion/report";

/** POST /api/v1/discussions/:id/summary — 生成综合建议并汇总成一份报告（保存为 md 产物） */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/summary">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
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

  const personaIds = (d.personaIds as string[]) ?? [];
  const personas = await prisma.persona.findMany({
    where: { id: { in: personaIds } },
    select: { name: true, perspectiveType: true },
  });

  let content: string;
  try {
    const modelObj = buildModel(provider, apiKey, modelRaw ?? "", baseUrl || undefined);
    const { text } = await generateText({
      model: modelObj,
      system:
        "你是一位资深商业顾问。综合多位专家在讨论中提出的观点，给出一份可执行、有优先级、有分歧说明的综合建议。建议包含：核心结论、关键论据、分歧点、下一步建议。",
      prompt: `【讨论要点】\n${d.summaryBox}\n\n请给出综合建议。`,
      abortSignal: AbortSignal.timeout(Math.min(Number(timeoutRaw ?? 120) * 1000, 120000)),
    });
    content = text.trim() || "（未能生成建议）";
  } catch (e) {
    content = `（生成建议失败：${e instanceof Error ? e.message : String(e)}）`;
  }

  // 汇总成一份报告并保存为 md 产物（失败不阻断建议本身）
  let artifact: { id: string; filePath: string; title: string; summary: string } | null = null;
  try {
    artifact = await saveReport({
      id: d.id,
      brief: d.brief,
      rounds: d.rounds,
      personas: personas.map((p) => ({ name: p.name, perspectiveType: p.perspectiveType })),
      messages: d.messages.map((m) => ({ role: m.role, sender: m.sender, content: m.content, turn: m.turn })),
      summary: content,
    });
  } catch (e) {
    /* 报告落盘失败：记录但不断言建议生成失败 */
  }

  await prisma.discussionMessage.create({
    data: { discussionId: id, role: "summary", sender: "综合建议", turn: d.rounds + 1, content },
  });
  await prisma.discussion.update({ where: { id }, data: { status: "done" } });

  return ok({ content, artifact });
}
