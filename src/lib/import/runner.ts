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
  version: string | null;
  content: string; // 完整 SKILL.md 正文
  resources: string[]; // references/、examples/ 下相对路径
  sourceRef: string;
  readResource?: (rel: string) => string | null;
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

/** ANSI 转义序列（颜色/光标控制等），degit 等 CLI 在管道下仍会输出 */
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function runShell(command: string, cwd: string, logPath: string, timeoutMs: number) {
  const isWin = process.platform === "win32";
  // 受限环境禁止 shell 重定向与管道捕获子进程输出，改用 stdio pipe 捕获后由本进程写入日志文件
  const child = isWin
    ? spawn("cmd", ["/c", command], { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    : spawn("sh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });

  const append = (chunk: Buffer) => {
    try {
      fs.appendFileSync(logPath, stripAnsi(chunk.toString()));
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

/**
 * 把 `npx skills add <github 源>` 自动转写为等效的 degit 下载命令。
 * 原因：skills CLI 是本机安装器（装到 ~/.claude/skills 等 agent 目录，且需要交互
 * 选择目标 agent），在本导入器（stdin 关闭、要求产物释放到任务目录）中永远失败。
 * degit 是纯下载器，产物落在任务目录，与本导入器的「释放 → 扫描 → confirm」模型匹配。
 * 仅转换 GitHub 仓库形态的源；npm 包名等其他形态原样执行并在日志中说明。
 */
export function normalizeImportCommand(command: string): { command: string; note?: string } {
  const trimmed = command.trim();
  const m = trimmed.match(/^npx\s+(?:(?:--yes|-y)\s+)*skills\s+add\s+(\S+)/);
  if (!m) return { command: trimmed };

  const source = m[1];
  let repo = source;
  let ref = "";
  const hashIdx = source.indexOf("#");
  if (hashIdx !== -1) {
    ref = source.slice(hashIdx); // #tag / #branch
    repo = source.slice(0, hashIdx);
  }
  // 完整 GitHub URL → owner/repo
  const urlMatch = repo.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (urlMatch) repo = `${urlMatch[1]}/${urlMatch[2]}`;

  // 只处理 owner/repo 形态；npm 包名、本地路径等不转化
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) || repo.split("/").some((p) => p === "." || p === "..")) {
    return {
      command: trimmed,
      note: `skills add 的源「${source}」不是 GitHub owner/repo 形态，无法自动转换，原样执行（预期会因需要交互而失败）`,
    };
  }

  const dir = repo.split("/")[1].replace(/\.git$/, "").replace(/[^A-Za-z0-9._-]/g, "") || "skill";
  return {
    command: `npx --yes degit ${repo}${ref} ${dir}`,
    note: `已把「${trimmed}」转换为等效的 degit 下载：skills CLI 需要交互选择安装目标，无法在导入器中运行；degit 直接把仓库内容下载到任务目录，效果等同`,
  };
}

/** 启动并执行导入（异步推进，调用方无需 await 完成） */
export async function runImport(command: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ImportJob> {
  const norm = normalizeImportCommand(command);
  const job = createJob(norm.command);
  if (norm.note) {
    fs.appendFileSync(job.logPath, `注：${norm.note}\n\n`, "utf8");
  }
  // 不阻塞调用方：异步执行并在完成后填充结果
  void (async () => {
    try {
      const { exitCode } = await runShell(norm.command, job.dir, job.logPath, timeoutMs);
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
