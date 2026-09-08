/**
 * Discussion 生命周期管理（见方案 §10.2）。
 * - archiveDiscussion 保留旧的可恢复归档语义；
 * - deleteDiscussion 是 DELETE API 使用的不可恢复硬删除：先阻断并终止 DSH Session，
 *   再清理 DSH 实际持久化文件、manifest、projection cache 与未被引用的 snapshot，最后删除 DB 行；
 * - purgeDiscussion 为历史归档的物理清理入口，复用同一套安全清理逻辑。
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { deleteManifest, readManifest } from "@/lib/dsh/manifest";
import { DiscussionArchivedError } from "@/lib/dsh/errors";
import { getDiscussionSessionManager } from "@/lib/runtime/singleton";
import { deleteDiscussionCapabilityGrants } from "./capability-grant";

/** 默认保留天数（配置可覆盖） */
const DEFAULT_TTL_DAYS = Number(process.env.DSH_RETENTION_DAYS ?? 30);

function retentionDays(): number {
  const v = Number(process.env.DSH_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL_DAYS;
}

const SAFE_DSH_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

function assertSafeDshSessionId(sessionId: string): void {
  if (!SAFE_DSH_SESSION_ID_RE.test(sessionId)) {
    throw new Error(`拒绝清理非法 DSH Session id：${sessionId}`);
  }
}

/** 与 DSH JSONL persistence 保持一致的单路径段编码。 */
function encodeDshSegment(raw: string): string {
  if (raw.length === 0) throw new Error("不能编码空 DSH Session id");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

/** 与 DSH JSONL persistence 保持一致的 project directory key。 */
function dshProjectKey(cwd: string): string {
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/, "") || "root";
  return `--${slug.slice(0, 251)}--`;
}

function isWithin(root: string, target: string): boolean {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  return targetAbs !== rootAbs && targetAbs.startsWith(`${rootAbs}${path.sep}`);
}

function isWithinOrEqual(root: string, target: string): boolean {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  return targetAbs === rootAbs || targetAbs.startsWith(`${rootAbs}${path.sep}`);
}

function lstatIfExists(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * 只允许删除固定 runtime root 下的精确目标，并拒绝通过父级 symlink 越界。
 * 目标本身如果是 symlink，只解除 symlink，不跟随到外部目录。
 */
function assertSafeDeletePath(root: string, target: string): string {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  if (!isWithin(rootAbs, targetAbs)) {
    throw new Error(`拒绝删除 runtime root 外的路径：${target}`);
  }

  const rootStat = lstatIfExists(rootAbs);
  if (!rootStat) return targetAbs;
  if (rootStat.isSymbolicLink()) {
    throw new Error(`拒绝删除 symlink runtime root：${root}`);
  }

  const targetStat = lstatIfExists(targetAbs);
  let boundaryCandidate = targetAbs;
  if (targetStat?.isSymbolicLink()) {
    boundaryCandidate = path.dirname(targetAbs);
  } else if (!targetStat) {
    while (boundaryCandidate !== rootAbs && !lstatIfExists(boundaryCandidate)) {
      boundaryCandidate = path.dirname(boundaryCandidate);
    }
  }

  const rootReal = fs.realpathSync(rootAbs);
  const candidateReal = fs.realpathSync(boundaryCandidate);
  if (!isWithinOrEqual(rootReal, candidateReal)) {
    throw new Error(`拒绝通过 symlink 越界删除路径：${target}`);
  }
  return targetAbs;
}

function removeContainedPath(root: string, target: string): void {
  const targetAbs = assertSafeDeletePath(root, target);
  const stat = lstatIfExists(targetAbs);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(targetAbs);
    return;
  }
  fs.rmSync(targetAbs, { recursive: true, force: false });
}

function dshHome(): string {
  return path.join(process.cwd(), "data", "dsh-home");
}

function dshStorageFileName(sessionId: string): string {
  assertSafeDshSessionId(sessionId);
  return `${sessionId}.json`;
}

/** 删除 DSH 实际 JSONL Session 目录及各 storage 的精确 projection 文件。 */
function removeDshSessionFiles(sessionId: string): void {
  assertSafeDshSessionId(sessionId);
  const home = dshHome();
  const sessionsRoot = path.join(home, "sessions");
  const sessionDir = path.join(sessionsRoot, dshProjectKey(process.cwd()), encodeDshSegment(sessionId));
  removeContainedPath(sessionsRoot, sessionDir);

  const storagesRoot = path.join(home, "storages");
  const storagesStat = lstatIfExists(storagesRoot);
  if (!storagesStat || !storagesStat.isDirectory()) return;
  for (const entry of fs.readdirSync(storagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sessionProjection = path.join(
      storagesRoot,
      entry.name,
      "sessions",
      dshStorageFileName(sessionId),
    );
    removeContainedPath(storagesRoot, sessionProjection);
  }
}

function manifestSnapshotRoot(sessionId: string): string | null {
  try {
    return readManifest(sessionId).persona?.snapshotRoot ?? null;
  } catch {
    // 损坏 manifest 仍然必须删除；无法安全解析出的 snapshot 不做猜测删除。
    return null;
  }
}

function manifestsReferenceSnapshot(snapshotRoot: string): boolean {
  const root = path.join(process.cwd(), "data", "dsh", "manifests");
  const stat = lstatIfExists(root);
  if (!stat || !stat.isDirectory()) return false;
  const wanted = path.resolve(snapshotRoot);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile()) return true;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(root, entry.name), "utf8")) as {
        persona?: { snapshotRoot?: unknown };
      };
      if (typeof raw.persona?.snapshotRoot === "string" && path.resolve(raw.persona.snapshotRoot) === wanted) {
        return true;
      }
    } catch {
      // 无法解析其它 manifest 时保守保留 snapshot，避免误删共享资料。
      return true;
    }
  }
  return false;
}

async function removeUnreferencedSnapshots(discussionId: string, roots: Set<string>): Promise<void> {
  if (roots.size === 0) return;
  const snapshotRoots = [...roots];
  const referenced = await prisma.discussionParticipant.findMany({
    where: {
      discussionId: { not: discussionId },
      personaSnapshotRoot: { in: snapshotRoots },
    },
    select: { personaSnapshotRoot: true },
  });
  const dbReferenced = new Set(
    referenced
      .map((row) => row.personaSnapshotRoot)
      .filter((root): root is string => typeof root === "string")
      .map((root) => path.resolve(root)),
  );
  const snapshotsRoot = path.join(process.cwd(), "data", "dsh", "snapshots");
  for (const snapshotRoot of snapshotRoots) {
    const normalized = path.resolve(snapshotRoot);
    if (dbReferenced.has(normalized) || manifestsReferenceSnapshot(normalized)) continue;
    removeContainedPath(snapshotsRoot, normalized);
  }
}

interface DiscussionSessionArtifacts {
  moderatorSessionId: string | null;
  participants: Array<{ dshSessionId: string; personaSnapshotRoot: string | null }>;
}

/** 清理一个 Discussion 关联的所有 runtime 物理资产；失败会抛出，调用方不得删除 DB 行。 */
async function cleanupDiscussionArtifacts(
  discussionId: string,
  discussion: DiscussionSessionArtifacts,
): Promise<void> {
  const sessionIds = new Set<string>([
    ...discussion.participants.map((participant) => participant.dshSessionId),
    ...(discussion.moderatorSessionId ? [discussion.moderatorSessionId] : []),
  ]);
  const snapshotRoots = new Set<string>(
    discussion.participants
      .map((participant) => participant.personaSnapshotRoot)
      .filter((root): root is string => Boolean(root)),
  );

  for (const sessionId of sessionIds) {
    const root = manifestSnapshotRoot(sessionId);
    if (root) snapshotRoots.add(root);
  }
  for (const sessionId of sessionIds) {
    removeDshSessionFiles(sessionId);
    deleteManifest(sessionId);
  }
  await removeUnreferencedSnapshots(discussionId, snapshotRoots);
}

/** 不可恢复硬删除：先阻断/终止 Session，再删除所有 runtime 物理数据与 DB 级联记录。 */
export async function deleteDiscussion(id: string): Promise<{ id: string; deleted: true }> {
  const d = await prisma.discussion.findUnique({
    where: { id },
    select: {
      id: true,
      moderatorSessionId: true,
      participants: { select: { dshSessionId: true, personaSnapshotRoot: true } },
    },
  });
  if (!d) {
    await getDiscussionSessionManager().closeDiscussion(id, { reason: "delete" });
    throw new Error("讨论不存在");
  }

  const now = new Date();
  // 临时写 archived，阻止并发 turn；若物理清理失败，purgeAt=now 允许后续重试。
  await prisma.discussion.update({
    where: { id },
    data: {
      status: "archived",
      ...(d.moderatorSessionId ? { moderatorStatus: "archived" } : {}),
      archivedAt: now,
      purgeAt: now,
    },
  });
  await getDiscussionSessionManager().closeDiscussion(id, { reason: "delete" });
  await prisma.discussionParticipant.updateMany({
    where: { discussionId: id },
    data: { status: "archived" },
  });

  await cleanupDiscussionArtifacts(id, d);
  await deleteDiscussionCapabilityGrants(id);
  await prisma.discussion.delete({ where: { id } });
  return { id, deleted: true };
}

/** 逻辑归档：先阻断新 turn，再关闭 DSH Session，最后标记关联 Session 元数据。 */
export async function archiveDiscussion(id: string): Promise<{ id: string; archivedAt: Date; purgeAt: Date }> {
  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) throw new Error("讨论不存在");
  const now = new Date();
  const purgeAt = new Date(now.getTime() + retentionDays() * 86400_000);
  await prisma.discussion.update({
    where: { id },
    data: {
      status: "archived",
      ...(d.moderatorSessionId ? { moderatorStatus: "archived" } : {}),
      archivedAt: now,
      purgeAt,
    },
  });
  await getDiscussionSessionManager().closeDiscussion(id, { reason: "archive" });
  await prisma.discussionParticipant.updateMany({
    where: { discussionId: id },
    data: { status: "archived" },
  });
  return { id, archivedAt: now, purgeAt };
}

/** 恢复归档讨论（可恢复语义：TTL 前均可） */
export async function restoreDiscussion(id: string): Promise<void> {
  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) throw new Error("讨论不存在");
  if (d.status !== "archived") throw new DiscussionArchivedError("讨论未归档，无需恢复");
  await prisma.discussion.update({
    where: { id },
    data: {
      status: "pending",
      ...(d.moderatorStatus === "archived" ? { moderatorStatus: "idle" } : {}),
      archivedAt: null,
      purgeAt: null,
    },
  });
  await prisma.discussionParticipant.updateMany({
    where: { discussionId: id, status: "archived" },
    data: { status: "pending" },
  });
}

/** 恢复到删除前的完整状态（status 置回 pending） */
export async function assertNotArchived(id: string): Promise<void> {
  const d = await prisma.discussion.findUnique({ where: { id }, select: { archivedAt: true } });
  if (d?.archivedAt) throw new DiscussionArchivedError("讨论已归档，不接受新的 turn");
}

/**
 * 清理一个讨论（purge 触发）：先逻辑删除 DSH 文件，再物理删除 DB 记录。可重试。
 * @returns 是否已完成（若仍有外部资源被占用则 false，供调用方重试）
 */
export async function purgeDiscussion(id: string): Promise<boolean> {
  // Stop the live process before removing the manifest/session files it may still read.
  await getDiscussionSessionManager().closeDiscussion(id, { reason: "delete" });
  const d = await prisma.discussion.findUnique({
    where: { id },
    select: {
      id: true,
      moderatorSessionId: true,
      participants: { select: { dshSessionId: true, personaSnapshotRoot: true } },
    },
  });
  if (!d) return true;

  // 运行中的 participant 在 Session close 后统一标记为 failed，保留清理审计信息。
  await prisma.discussionParticipant.updateMany({
    where: { discussionId: id, status: "running" },
    data: { status: "failed", lastError: "purged" },
  });

  await cleanupDiscussionArtifacts(id, d);

  // 物理删除 DB 记录（AgentEvent/DiscussionTurn/Message/Artifact 走 cascade）
  await deleteDiscussionCapabilityGrants(id);
  await prisma.discussion.delete({ where: { id } });
  return true;
}

/** 清理服务：查找 purgeAt<=now 的已归档讨论并清理 */
export async function runPurge(now = new Date()): Promise<{ purged: number }> {
  const due = await prisma.discussion.findMany({
    where: { status: "archived", purgeAt: { lte: now } },
    select: { id: true },
  });
  let purged = 0;
  for (const d of due) {
    try {
      if (await purgeDiscussion(d.id)) purged++;
    } catch {
      /* 单条失败不阻断；可重试 */
    }
  }
  return { purged };
}
