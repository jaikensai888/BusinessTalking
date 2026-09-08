"use client";

import { useState } from "react";
import { Check, ShieldWarning, SpinnerGap, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { PendingDiscussionApproval } from "@/lib/discussion/dsh-turn-projection";

interface DshApprovalPanelProps {
  discussionId: string;
  approval: PendingDiscussionApproval;
  toolInput?: unknown;
  onResolved?: (approvalId: string) => void;
}
function displayValue(value: unknown, max = 520): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return "[无法展示]";
  }
}

/** A successful retry is also safe to treat as resolved: the bridge is idempotent. */
export function isApprovalResolutionStatus(status: unknown): boolean {
  return status === "accepted" || status === "already-decided";
}

/** DSH-style takeover for a pending, discussion-scoped approval request. */
export function DshApprovalPanel({ discussionId, approval, toolInput, onResolved }: DshApprovalPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedApprovalId, setResolvedApprovalId] = useState<string | null>(null);

  const discussionScoped = approval.scope === "discussion" && approval.toolName === "web_search";

  const decide = async (outcome: "allowed-once" | "allowed-discussion" | "rejected-discussion") => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/discussions/${encodeURIComponent(discussionId)}/approvals/${encodeURIComponent(approval.approvalId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome }),
        },
      );
      let data: { status?: string; error?: string } = {};
      try { data = await response.json(); } catch { /* response body is optional */ }
      if (!response.ok || !isApprovalResolutionStatus(data.status)) {
        setError(data.error === "approval_already_decided" ? "该请求已经处理" : data.error ?? "审批请求处理失败");
        return;
      }
      setResolvedApprovalId(approval.approvalId);
      onResolved?.(approval.approvalId);
    } catch {
      setError("审批请求处理失败，请检查实时连接后重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (resolvedApprovalId === approval.approvalId) return null;

  return (
    <div className="mx-1 mb-2 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-3" role="dialog" aria-label="DSH 工具审批">
      <div className="flex items-start gap-2.5">
        <ShieldWarning size={20} weight="duotone" className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="text-caption font-semibold text-ink">需要你的批准</div>
          <div className="mt-0.5 text-fine text-ink-60">
            DSH 请求调用 <span className="font-semibold text-ink">{approval.toolName}</span>，当前讨论仍在等待。
            {discussionScoped ? "允许后，本次讨论中的所有 Persona Session 都可继续使用该工具。" : "仅放行当前工具调用。"}
          </div>
          {approval.reason && <div className="mt-1 text-fine leading-5 text-ink-60">原因：{approval.reason}</div>}
          {displayValue(toolInput) && (
            <div className="mt-2 rounded-sm bg-white/70 px-2.5 py-2 text-fine leading-4 text-ink-48">
              参数：<span className="break-words">{displayValue(toolInput)}</span>
            </div>
          )}
          {error && <div className="mt-2 text-fine text-error">{error}</div>}
          <div className="mt-2.5 flex items-center gap-2">
            {discussionScoped ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => void decide("rejected-discussion")} disabled={submitting}>
                  {submitting ? <SpinnerGap size={14} className="animate-spin" /> : <X size={14} />}
                  拒绝本次讨论
                </Button>
                <Button variant="primary" size="sm" onClick={() => void decide("allowed-discussion")} disabled={submitting}>
                  {submitting ? <SpinnerGap size={14} className="animate-spin" /> : <Check size={14} />}
                  允许本次讨论
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={() => void decide("allowed-once")} disabled={submitting}>
                {submitting ? <SpinnerGap size={14} className="animate-spin" /> : <Check size={14} />}
                仅允许本次调用
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
