import { prisma } from "@/lib/db";
import { getDiscussionApprovalBridge } from "@/lib/discussion/approval-bridge";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "permissionMode" && key !== "approvalPolicy")) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (body.permissionMode !== undefined && body.permissionMode !== "read-only") {
    return Response.json({ error: "permissionMode must be read-only" }, { status: 400 });
  }
  if (body.approvalPolicy !== undefined && body.approvalPolicy !== "ask" && body.approvalPolicy !== "never") {
    return Response.json({ error: "approvalPolicy must be ask or never" }, { status: 400 });
  }

  const discussion = await prisma.discussion.findUnique({
    where: { id },
    select: { id: true, permissionMode: true, approvalPolicy: true, archivedAt: true },
  });
  if (!discussion) return Response.json({ error: "discussion_not_found" }, { status: 404 });
  if (discussion.archivedAt) return Response.json({ error: "discussion_archived" }, { status: 409 });

  const activeTurns = await prisma.discussionTurn.count({ where: { discussionId: id, status: "running" } });
  if (activeTurns > 0 || getDiscussionApprovalBridge().listPending(id).length > 0) {
    return Response.json({ error: "discussion_busy" }, { status: 409 });
  }

  const permissionMode = body.permissionMode === undefined ? (discussion.permissionMode || "read-only") : body.permissionMode;
  const approvalPolicy = body.approvalPolicy === undefined ? (discussion.approvalPolicy || "ask") : body.approvalPolicy;
  if (permissionMode !== "read-only" || (approvalPolicy !== "ask" && approvalPolicy !== "never")) {
    return Response.json({ error: "stored permission policy invalid" }, { status: 409 });
  }
  const updated = await prisma.discussion.update({
    where: { id },
    data: { permissionMode, approvalPolicy },
    select: { id: true, permissionMode: true, approvalPolicy: true },
  });
  return Response.json(updated);
}
