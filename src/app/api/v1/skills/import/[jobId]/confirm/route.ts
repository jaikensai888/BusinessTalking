import { err, ok } from "@/lib/api";
import { getJob, refreshCandidates } from "@/lib/import/runner";
import { installSkillBundle, DshSkillError } from "@/lib/skills/installation";

/** POST /api/v1/skills/import/:jobId/confirm — 勾选候选入库（source=npx，不可变安装） */
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
    try {
      const { skillId } = await installSkillBundle({
        name: candidate.name,
        description: candidate.description ?? null,
        version: candidate.version ?? null,
        content: candidate.content,
        source: "npx",
        sourceRef: job.command,
        resources: candidate.resources,
        readResource: candidate.readResource,
      });
      imported.push({ id: skillId, name: candidate.name, source: "npx" });
    } catch (e) {
      if (e instanceof DshSkillError) {
        return err(42201, e.message, 422);
      }
      throw e;
    }
  }

  return ok({ imported });
}
