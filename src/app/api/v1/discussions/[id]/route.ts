import fs from "node:fs";
import path from "node:path";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

/** GET /api/v1/discussions/:id — 讨论详情（消息流 + 产物列表） */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } }, artifacts: { orderBy: { createdAt: "desc" } } },
  });
  if (!d) return err(40401, "讨论不存在", 404);

  const personaIds = (d.personaIds as string[]) ?? [];
  const personas = await prisma.persona.findMany({
    where: { id: { in: personaIds } },
    select: { id: true, name: true, perspectiveType: true },
  });

  return ok({
    id: d.id,
    shortId: d.shortId,
    brief: d.brief,
    rounds: d.rounds,
    status: d.status,
    summaryBox: d.summaryBox,
    attachmentName: d.attachmentName,
    attachmentCharCount: d.attachmentCharCount,
    attachmentTruncated: d.attachmentTruncated,
    personas: personas.map((p) => ({ id: p.id, name: p.name, perspectiveType: p.perspectiveType })),
    messages: d.messages
      .filter((m) => m.role !== "skill") // 人格设定/参考资料为内部模型上下文，不随 GET 返回给前端
      .map((m) => ({
        id: m.id,
        sender: m.sender,
        role: m.role,
        turn: m.turn,
        content: m.content,
        createdAt: m.createdAt,
      })),
    artifacts: d.artifacts.map((a) => ({
      id: a.id,
      title: a.title,
      type: a.type,
      filePath: a.filePath,
      summary: a.summary,
      content: a.content,
      createdAt: a.createdAt,
    })),
  });
}

/** DELETE /api/v1/discussions/:id — 删除一场讨论（级联消息/产物，并清理产物的 md 文件） */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/v1/discussions/[id]">) {
  const { id } = await ctx.params;
  const d = await prisma.discussion.findUnique({
    where: { id },
    select: { id: true, artifacts: { select: { filePath: true } } },
  });
  if (!d) return err(40401, "讨论不存在", 404);

  // 尽力清理数据目录下的产物 md 文件（不阻断删除）
  for (const a of d.artifacts) {
    if (!a.filePath) continue;
    try {
      const full = path.resolve(process.cwd(), a.filePath);
      if (full.startsWith(path.resolve(process.cwd(), "data"))) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }

  await prisma.discussion.delete({ where: { id } });
  return ok({ deleted: true });
}
