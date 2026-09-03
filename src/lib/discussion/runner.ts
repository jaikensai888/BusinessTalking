import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { buildModel } from "@/lib/llm/providers";
import { normalizeProvider } from "@/lib/llm/constants";
import { decrypt } from "@/lib/settings/encryption";
import { getSetting } from "@/lib/settings/store";
import { searchWeb } from "@/lib/search/web";
import { publish } from "./broadcast";

/** 联网检索工具（keyless）：供人设查证竞品/参数/市场事实 */
const webSearchTool = tool({
  description:
    "联网搜索最新的产品、竞品、参数、市场数据。当你需要具体事实、竞品名称、公司/产品规格时调用；用中文或英文都能搜。",
  parameters: z.object({
    query: z.string().describe("要搜索的查询词，尽量具体，例如：‘Loona AI桌宠 功能 价格’"),
  }),
  execute: async ({ query }) => await searchWeb(query),
});

const SUMMARY_LIMIT = 1800;

/** 提取消息中的 @人名 提及（支持中英文姓名） */
function parseMentions(content: string): string[] {
  const regex = /@([\p{L}\p{N}\u4e00-\u9fff_\-·]+)/gu;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content))) out.push(m[1]);
  return out;
}

/** 名称宽松匹配：提及与当前人格名/其部分一致即视为点名 */
function mentionsName(mentions: string[], personaName: string): boolean {
  return mentions.some((n) => n === personaName || n.includes(personaName) || personaName.includes(n));
}

/**
 * 将用户插话拆成两类：
 * - direct：@点名当前人格的（下一回合由该人格正面回应）
 * - general：未点名的通用插话（所有在场人格都能看到）
 */
function splitSteers(steers: { content: string }[], personaName: string): { general: string; direct: string } {
  const general: string[] = [];
  const direct: string[] = [];
  for (const s of steers) {
    const mentions = parseMentions(s.content);
    if (mentions.length === 0) {
      general.push(`【你】：${s.content}`);
    } else if (mentionsName(mentions, personaName)) {
      direct.push(`【你】：${s.content}`);
    }
    // 点别人的名：对本格不注入，避免抢答
  }
  return { general: general.join("\n"), direct: direct.join("\n") };
}

/** 读取人物 skill（SKILL.md）作为完整人设；缺失则回退 systemPrompt */
export function loadSkill(skillPath: string | null | undefined, fallback: string): string {
  if (skillPath) {
    try {
      return fs.readFileSync(path.join(process.cwd(), skillPath), "utf8");
    } catch {
      /* fall back */
    }
  }
  return fallback;
}

/**
 * 多人讨论主循环（异步推进）：
 * 每人格独立上下文（各自历史）+ 共享纪要（summaryBox，浓缩跨人格要点），避免整段 transcript 传递
 */
export async function runDiscussion(id: string) {
  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) return;
  const personaIds = (d.personaIds as string[]) ?? [];
  const personas = await prisma.persona.findMany({ where: { id: { in: personaIds } } });
  if (personas.length < 1) {
    await prisma.discussion.update({ where: { id }, data: { status: "failed" } });
    return;
  }

  const [providerRaw, baseUrl, keyCipher, modelRaw, timeoutRaw] = await Promise.all([
    getSetting("llm.provider"),
    getSetting("llm.baseUrl"),
    getSetting("llm.apiKey"),
    getSetting("llm.defaultModel"),
    getSetting("llm.timeoutSeconds"),
  ]);
  const provider = normalizeProvider(providerRaw);
  const apiKey = keyCipher ? decrypt(keyCipher) : "";
  const model = modelRaw ?? "";
  if (!apiKey) {
    await prisma.discussion.update({ where: { id }, data: { status: "failed" } });
    return;
  }

  await prisma.discussion.update({ where: { id }, data: { status: "running" } });
  publish(id, { type: "change" });

  const buffers = new Map<string, { role: string; content: string }[]>();
  let summaryBox = d.summaryBox ?? d.brief;

  try {
    for (let round = 1; round <= d.rounds; round++) {
      for (const persona of personas) {
        const steers = await prisma.discussionMessage.findMany({
          where: { discussionId: id, role: "user" },
          orderBy: { createdAt: "asc" },
        });
        const { general, direct } = splitSteers(steers, persona.name);

        const sys =
          loadSkill(persona.skillPath, persona.systemPrompt) +
          `\n\n【讨论背景】\n${d.brief}` +
          `\n\n【当前共识/要点】\n${summaryBox}` +
          (general ? `\n\n【用户此刻插话】\n${general}` : "") +
          (direct ? `\n\n【用户直接点名你，请先正面回应这个问题】\n${direct}` : "") +
          `\n\n你现在是「${persona.name}」，轮到你发言。请用你的立场与风格，针对方案和其他人观点给出观点；简洁、有观点、不要重复别人。用第一人称。` +
          `\n\n你有联网检索工具 web_search：凡需要具体事实、竞品名、规格、市场数据、算账依据时，先搜索查证（可多次搜索）再作答；不要凭空编造竞品或数字。`;

        const history = buffers.get(persona.id) ?? [];
        let content: string;
        try {
          const modelObj = buildModel(provider, apiKey, model, baseUrl || undefined);
          const { text } = await generateText({
            model: modelObj,
            system: sys,
            messages: [
              ...history.slice(-4).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
              { role: "user" as const, content: history.length === 0 ? "开始讨论。" : "继续。" },
            ],
            tools: { web_search: webSearchTool },
            stopWhen: isStepCount(6),
            abortSignal: AbortSignal.timeout(Math.min(Number(timeoutRaw ?? 120) * 1000, 120000)),
          });
          content = text.trim() || "（无回应）";
        } catch (e) {
          content = `（该轮发言失败：${e instanceof Error ? e.message : String(e)}）`;
        }

        await prisma.discussionMessage.create({
          data: { discussionId: id, personaId: persona.id, sender: persona.name, role: "persona", turn: round, content },
        });
        publish(id, { type: "change" });
        buffers.set(persona.id, [...history, { role: "assistant", content }]);
        summaryBox = (summaryBox + `\n- ${persona.name}：${content.slice(0, 120)}`).slice(-SUMMARY_LIMIT);
        await prisma.discussion.update({ where: { id }, data: { summaryBox } });
      }
    }
    await prisma.discussion.update({ where: { id }, data: { status: "done" } });
    publish(id, { type: "change" });
  } catch (e) {
    await prisma.discussion.update({ where: { id }, data: { status: "failed" } });
    publish(id, { type: "change" });
  }
}
