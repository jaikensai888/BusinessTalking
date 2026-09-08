import { getDiscussionApprovalBridge, type UserApprovalOutcome } from "@/lib/discussion/approval-bridge";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; approvalId: string }> },
) {
  const { id, approvalId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !/^[A-Za-z0-9_-]{1,200}$/.test(approvalId)) {
    return Response.json({ error: "invalid_path" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isRecord(body) || Object.keys(body).length !== 1 ||
    (body.outcome !== "allowed-once" && body.outcome !== "allowed-discussion" && body.outcome !== "rejected-discussion")) {
    return Response.json({ error: "outcome must be allowed-once, allowed-discussion, or rejected-discussion" }, { status: 400 });
  }
  const outcome = body.outcome as UserApprovalOutcome;
  const status = await getDiscussionApprovalBridge().decide(id, approvalId, outcome);
  if (status === "not-found") return Response.json({ error: "approval_not_found" }, { status: 404 });
  if (status === "conflict") return Response.json({ error: "approval_already_decided" }, { status: 409 });
  return Response.json({ status, approvalId, outcome });
}
