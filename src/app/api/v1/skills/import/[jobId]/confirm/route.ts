import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getJob, refreshCandidates } from "@/lib/import/runner";

/** POST /api/v1/skills/import/:jobId/confirm — 勾选候选入库（source=npx） */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/skills/import/[jobId]/confirm">) {
  const { jobId } = await ctx.params;
  const job = getJob(jobId);
  if (!job) return err(40401, "导入任务不存在", 404);
  if (job.status !== "done") return err(40401, "导入任务未完成", 404);

  let body: { selectedFiles?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const candidates = refreshCandidates(job);
  const selectedFiles = Array.isArray(body.selectedFiles)
    ? body.selectedFiles.filter((f): f is string => typeof f === "string")
    : [];
  if (selectedFiles.length === 0) return err(40001, "selectedFiles 不能为空", 400);

  const byFile = new Map(candidates.map((c) => [c.file, c]));
  const imported: { id: string; name: string; source: string }[] = [];

  for (const file of selectedFiles) {
    const candidate = byFile.get(file);
    if (!candidate) return err(40001, `未知的候选文件：${file}`, 400);
    // 同名 skill 幂等：已存在则更新来源信息
    const created = await prisma.skill.upsert({
      where: { id: `npx-${Buffer.from(file).toString("base64url").slice(0, 40)}` },
      update: {
        description: candidate.description ?? undefined,
        instructions: candidate.instructions,
        source: "npx",
        sourceRef: job.command,
      },
      create: {
        id: `npx-${Buffer.from(file).toString("base64url").slice(0, 40)}`,
        name: candidate.name,
        description: candidate.description,
        instructions: candidate.instructions,
        source: "npx",
        sourceRef: job.command,
        isBuiltin: false,
      },
    });
    imported.push({ id: created.id, name: created.name, source: "npx" });
  }

  return ok({ imported });
}
