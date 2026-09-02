import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { scanSkillCandidates } from "./parser";

export type ImportJobStatus = "running" | "done" | "failed";

export interface ImportCandidate {
  file: string;
  name: string;
  description: string | null;
  instructions: string;
  sourceRef: string;
}

export interface ImportJob {
  id: string;
  command: string;
  status: ImportJobStatus;
  exitCode: number | null;
  error: string | null;
  dir: string;
  logPath: string;
  createdAt: number;
  doneAt: number | null;
  candidates: ImportCandidate[] | null;
}

const IMPORT_ROOT = path.join(process.cwd(), "data", "imports");
const DEFAULT_TIMEOUT_MS = 120_000;

/** 任务内存存储（单用户本地工具；服务重启丢失可接受） */
const jobs = new Map<string, ImportJob>();

/** 命令校验：必须以 npx 开头，拒绝危险 shell 符号 */
export function validateCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "命令不能为空";
  if (trimmed.length > 500) return "命令过长（最多 500 字符）";
  if (!/^npx(?:\s|$)/.test(trimmed)) return "命令必须以 npx 开头";
  if (/[|;&<>`$()\r\n]/.test(trimmed)) return "命令包含不允许的 shell 符号";
  return null;
}

function createJob(command: string): ImportJob {
  const id = crypto.randomUUID();
  const dir = path.join(IMPORT_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, "log.txt");
  fs.writeFileSync(logPath, `$ ${command}\n`, "utf8");
  const job: ImportJob = {
    id,
    command,
    status: "running",
    exitCode: null,
    error: null,
    dir,
    logPath,
    createdAt: Date.now(),
    doneAt: null,
    candidates: null,
  };
  jobs.set(id, job);
  return job;
}

function runShell(command: string, cwd: string, logPath: string, timeoutMs: number) {
  const isWin = process.platform === "win32";
  // 受限环境禁止 shell 重定向与管道捕获子进程输出，改用 stdio pipe 捕获后由本进程写入日志文件
  const child = isWin
    ? spawn("cmd", ["/c", command], { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    : spawn("sh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });

  const append = (chunk: Buffer) => {
    try {
      fs.appendFileSync(logPath, chunk.toString());
    } catch {
      // 忽略日志写入失败
    }
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const timer = setTimeout(() => {
    child.kill();
  }, timeoutMs);

  return new Promise<{ exitCode: number | null; timedOut: boolean }>((resolve) => {
    child.on("error", (e) => {
      clearTimeout(timer);
      append(Buffer.from(`错误：${(e as Error).message}\n`));
      resolve({ exitCode: 1, timedOut: false });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut: false });
    });
  });
}

/** 启动并执行导入（异步推进，调用方无需 await 完成） */
export async function runImport(command: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ImportJob> {
  const job = createJob(command);
  // 不阻塞调用方：异步执行并在完成后填充结果
  void (async () => {
    try {
      const { exitCode } = await runShell(command, job.dir, job.logPath, timeoutMs);
      job.exitCode = exitCode;
      job.status = exitCode === 0 ? "done" : "failed";
      if (job.status === "failed") job.error = `命令退出码 ${exitCode}，详见日志`;
      if (job.status === "done") {
        job.candidates = scanSkillCandidates(job.dir);
      }
    } catch (e) {
      job.status = "failed";
      job.error = e instanceof Error ? e.message : String(e);
    } finally {
      job.doneAt = Date.now();
    }
  })();
  return job;
}

export function getJob(id: string): ImportJob | undefined {
  return jobs.get(id);
}

export function readLog(job: ImportJob): string {
  try {
    return fs.readFileSync(job.logPath, "utf8");
  } catch {
    return "";
  }
}

export function refreshCandidates(job: ImportJob): ImportCandidate[] {
  // 每次查询实时重扫（任务目录可能在完成后被补充文件，如测试夹具）
  job.candidates = scanSkillCandidates(job.dir);
  return job.candidates;
}
