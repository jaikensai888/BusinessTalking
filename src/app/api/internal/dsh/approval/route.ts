import { getDiscussionApprovalBridge, type ApprovalBridgeRequest } from "@/lib/discussion/approval-bridge";
import { getDshApprovalToken } from "@/lib/runtime/internal-endpoints";

export const dynamic = "force-dynamic";

const TOKEN_HEADER = "x-bt-internal-token";

function unauthorized() {
  return Response.json({ error: "forbidden" }, { status: 403 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

function tokenMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function parseApprovalBody(value: unknown): ApprovalBridgeRequest {
  if (!isRecord(value)) throw new Error("body 必须是对象");
  const allowed = new Set(["approvalId", "discussionId", "sessionId", "sessionKind", "toolName", "callId", "reason"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("body 含未允许字段");
  if (!validId(value.approvalId)) throw new Error("approvalId 非法");
  if (!validId(value.discussionId)) throw new Error("discussionId 非法");
  if (!validId(value.sessionId)) throw new Error("sessionId 非法");
  if (value.sessionKind !== "persona" && value.sessionKind !== "moderator") throw new Error("sessionKind 非法");
  if (!validId(value.toolName)) throw new Error("toolName 非法");
  if (value.callId !== undefined && !validId(value.callId)) throw new Error("callId 非法");
  if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 1000)) {
    throw new Error("reason 非法");
  }
  return {
    approvalId: value.approvalId,
    discussionId: value.discussionId,
    sessionId: value.sessionId,
    sessionKind: value.sessionKind,
    toolName: value.toolName,
    ...(value.callId === undefined ? {} : { callId: value.callId }),
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  };
}

export async function POST(request: Request) {
  if (!tokenMatches(request.headers.get(TOKEN_HEADER), getDshApprovalToken())) {
    return unauthorized();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  let approval: ApprovalBridgeRequest;
  try {
    approval = parseApprovalBody(body);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid_body" }, { status: 400 });
  }
  try {
    const outcome = await getDiscussionApprovalBridge().wait(approval, request.signal);
    return Response.json({ approvalId: approval.approvalId, outcome });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "approval_unavailable" }, { status: 400 });
  }
}
