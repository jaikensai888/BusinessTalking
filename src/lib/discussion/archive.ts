/**
 * 归档 / 清理（见方案 §10.2）。删除语义改为逻辑归档：DELETE 只写 archivedAt/purgeAt，
 * 不 cascade 删除消息/参与者/AgentEvent/DSH 文件；purgeAt 之后才物理清理。
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { deleteManifest } from "@/lib/dsh/manifest";
import { DiscussionArchivedError } from "@/lib/dsh/errors";

/** 默认保留天数（配置可覆盖） */
const DEFAULT_TTL_DAYS = Number(process.env.DSH_RETENTION_DAYS ?? 30);

function retentionDays(): number {
  const v = Number(process.env.DSH_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL_DAYS;
}

/** 逻辑归档：status=archived + archivedAt + purgeAt；不删任何数据 */
export async function archiveDiscussion(id: string): Promise<{ id: string; archivedAt: Date; purgeAt: Date }> {
  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) throw new Error("讨论不存在");
  const now = new Date();
  const purgeAt = new Date(now.getTime() + retentionDays() * 86400_000);
  await prisma.discussion.update({
    where: { id },
    data: { status: "archived", archivedAt: now, purgeAt },
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
    data: { status: "pending", archivedAt: null, purgeAt: null },
  });
}

/** 恢复到删除前的完整状态（status 置回 pending） */
export async function assertNotArchived(id: string): Promise<void> {
  const d = await prisma.discussion.findUnique({ where: { id }, select: { archivedAt: true } });
  if (d?.archivedAt) throw new DiscussionArchivedError("讨论已归档，不接受新的 turn");
}

/** 删除 DSH session 目录（JSONL、manifest、snapshot 由 manifest 指向） */
function removeDshSessionFiles(sessionId: string): void {
  // manifest（在 data/dsh/manifests/<sessionId>.json）
  deleteManifest(sessionId);
  // session JSONL（DSH 默认持久化在 data/dsh/sessions 下的 <sessionId>.jsonl）
  const sessionDir = path.join(process.cwd(), "data", "dsh", "sessions");
  if (fs.existsSync(sessionDir)) {
    for (const f of fs.readdirSync(sessionDir)) {
      if (f.includes(sessionId)) {
        try {
          fs.rmSync(path.join(sessionDir, f), { recursive: true, force: true });
        } catch {
          /* 可重试 */
        }
      }
    }
  }
}

/** 清理一个讨论（purge 触发）：先逻辑删除 DSH 文件，再物理删除 DB 记录。可重试。）
 * @returns 是否已完成（若仍有外部资源被占用则 false，供调用方重试）
 */
export async function purgeDiscussion(id: string): Promise<boolean> {
  const d = await prisma.discussion.findUnique({
    where: { id },
    select: { id: true, moderatorSessionId: true, participants: { select: { dshSessionId: true } } },
  });
  if (!d) return true;

  // 先停掉仍在运行的 participant（逻辑标记 failed；不物理 close Runtime）
  await prisma.discussionParticipant.updateMany({
    where: { discussionId: id, status: "running" },
    data: { status: "failed", lastError: "purged" },
  });

  // 清理 DSH session 文件
  for (const p of d.participants) removeDshSessionFiles(p.dshSessionId);
  if (d.moderatorSessionId) removeDshSessionFiles(d.moderatorSessionId);

  // 清理该讨论的 snapshot 目录（manifest 里的 snapshotRoot）
  const manifests = [
    ...d.participants.map((p) => p.dshSessionId),
    d.moderatorSessionId,
  ].filter(Boolean);
  for (const sid of manifests) {
    try {
      const mPath = path.join(process.cwd(), "data", "dsh", "manifests", `${sid}.json`);
      if (fs.existsSync(mPath)) {
        const m = JSON.parse(fs.readFileSync(mPath, "utf8"));
        if (m.persona?.snapshotRoot) {
          fs.rmSync(m.persona.snapshotRoot, { recursive: true, force: true });
        }
        fs.rmSync(mPath, { force: true });
      }
    } catch {
      /* 可重试 */
    }
  }

  // 物理删除 DB 记录（AgentEvent/DiscussionTurn/Message/Artifact 走 cascade）
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
