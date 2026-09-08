import type { Prisma } from "@prisma/client";
import { err, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { streamOneOnOneDsh } from "@/lib/discussion/oneonone-dsh";
import {
  DiscussionStateSchema,
  type DiscussionState,
  type UserSteer,
} from "@/lib/discussion/state";

/** 多人讨论：把插话追加进 discussionState.userSteers（乐观锁 CAS + 短重试）。
 * 运行中的讨论可能与 Orchestrator 的状态提交并发，冲突时重读重试。 */
async function appendUserSteer(discussionId: string, steer: UserSteer): Promise<{ ok: boolean; reason?: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await prisma.discussion.findUnique({
      where: { id: discussionId },
      select: { brief: true, discussionState: true, stateVersion: true },
    });
    if (!cur) return { ok: false, reason: "讨论不存在" };
    const parsed = DiscussionStateSchema.safeParse(cur.discussionState);
    if (!parsed.success) return { ok: false, reason: "讨论状态损坏，无法记录插话" };
    const state: DiscussionState = parsed.data;
    const nextState: DiscussionState = { ...state, userSteers: [...state.userSteers, steer] };
    const updated = await prisma.discussion.updateMany({
      where: { id: discussionId, stateVersion: cur.stateVersion },
      data: { discussionState: nextState as unknown as Prisma.InputJsonValue },
    });
    if (updated.count === 1) return { ok: true };
  }
  return { ok: false, reason: "讨论状态更新冲突，请稍后重试" };
}

/** POST /api/v1/discussions/:id/steer — 用户插话/提问 */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/discussions/[id]/steer">) {
  const { id } = await ctx.params;
  let body: { message?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(40001, "请求体必须是合法 JSON", 400);
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 5000) return err(40001, "message 必填（1~5000 字符）", 400);

  const d = await prisma.discussion.findUnique({ where: { id } });
  if (!d) return err(40401, "讨论不存在", 404);
  if (d.archivedAt) return err(40901, "讨论已归档，不能再插话", 409);

  const personaIds = (d.personaIds as string[]) ?? [];

  // 单人（1 对 1）讨论：你问我答——用户每发一条，该人设立即流式作答（SSE）。
  if (personaIds.length === 1) {
    await prisma.discussionMessage.create({
      data: { discussionId: id, role: "user", sender: "你", turn: 0, content: message },
    });
    return streamOneOnOneDsh(id, personaIds[0], message);
  }

  // 多人讨论：记录消息并写入共享状态 userSteers，由 Orchestrator 在下一轮 prompt 消费
  const m = await prisma.discussionMessage.create({
    data: { discussionId: id, role: "user", sender: "你", turn: 0, content: message },
  });
  const steer: UserSteer = {
    id: m.id,
    content: message,
    targetParticipantIds: [], // 空 = 广播给全部参与者
    createdAt: new Date().toISOString(),
  };
  const appended = await appendUserSteer(id, steer);
  if (!appended.ok) return err(40902, appended.reason ?? "插话写入失败", 409);
  return ok({ id: m.id });
}
