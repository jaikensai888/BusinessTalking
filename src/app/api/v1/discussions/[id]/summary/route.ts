import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { saveReport } from "@/lib/discussion/report";
import { parseDiscussionState } from "@/lib/discussion/state";

/** POST /api/v1/discussions/:id/summary — 用结构化 DiscussionState 生成综合建议报告投影。
 *  数据源：多人讨论由 Moderator 产出的 DiscussionState；无 state 时回退 summaryBox。
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/summary">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!d) return err(40401, "讨论不存在", 404);

  // 从结构化 state 投影；会话刚开始（无 summary）时退出
  const state = d.discussionState ? parseDiscussionState(d.discussionState) : null;
  const content = state?.summary?.trim() || d.summaryBox?.trim() || "";
  if (!content) return err(40001, "讨论尚未产生内容", 400);

  const personaIds = (d.personaIds as string[]) ?? [];
  const personas = await prisma.persona.findMany({
    where: { id: { in: personaIds } },
    select: { name: true, perspectiveType: true },
  });

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
  } catch {
    /* 报告落盘失败：记录但不断言建议生成失败 */
  }

  await prisma.discussionMessage.create({
    data: { discussionId: id, role: "summary", sender: "综合建议", turn: d.rounds + 1, content },
  });
  // 单人讨论保持"ready"继续问答；多人讨论才标记结束
  await prisma.discussion.update({
    where: { id },
    data: { status: personaIds.length === 1 ? "ready" : "done" },
  });

  return ok({ content, artifact, stateVersion: d.stateVersion });
}
