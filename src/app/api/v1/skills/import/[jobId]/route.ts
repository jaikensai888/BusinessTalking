import { err, ok } from "@/lib/api";
import { getJob, readLog, refreshCandidates } from "@/lib/import/runner";

/** GET /api/v1/skills/import/:jobId — 查询进度、日志与解析候选 */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/skills/import/[jobId]">) {
  const { jobId } = await ctx.params;
  const job = getJob(jobId);
  if (!job) return err(40401, "导入任务不存在", 404);

  const logs = readLog(job)
    .split("\n")
    .filter((l) => l.length > 0);

  const candidates = job.status === "done" ? refreshCandidates(job) : [];

  return ok({
    jobId: job.id,
    status: job.status,
    command: job.command,
    exitCode: job.exitCode,
    error: job.error,
    logs,
    candidates,
  });
}
