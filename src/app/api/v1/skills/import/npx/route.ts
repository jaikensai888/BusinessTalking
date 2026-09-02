import { err, ok } from "@/lib/api";
import { runImport, validateCommand } from "@/lib/import/runner";

/** POST /api/v1/skills/import/npx — 启动 npx 导入任务 */
export async function POST(req: Request) {
  let body: { command?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }

  const command = typeof body.command === "string" ? body.command.trim() : "";
  const invalid = validateCommand(command);
  if (invalid) return err(40001, invalid, 400);

  const job = await runImport(command);
  return ok({ jobId: job.id, status: job.status, command: job.command });
}
