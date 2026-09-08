"use client";

import { useState } from "react";
import { LockKey, SpinnerGap } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface DiscussionPermissionControlProps {
  discussionId: string;
  permissionMode?: string;
  approvalPolicy?: string;
  busy?: boolean;
  onUpdated?: (value: { permissionMode: string; approvalPolicy: string }) => void;
}
/** Discussion-level permission switch; read-only is intentionally immutable in P0. */
export function DiscussionPermissionControl({
  discussionId,
  permissionMode = "read-only",
  approvalPolicy = "ask",
  busy = false,
  onUpdated,
}: DiscussionPermissionControlProps) {
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const updatePolicy = async (next: "ask" | "never") => {
    if (saving || busy || next === approvalPolicy) return;
    setSaving(true);
    setLocalError(null);
    try {
      const response = await fetch(`/api/v1/discussions/${encodeURIComponent(discussionId)}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalPolicy: next }),
      });
      const data = await response.json().catch(() => ({})) as { permissionMode?: string; approvalPolicy?: string; error?: string };
      if (!response.ok || data.permissionMode !== "read-only" || (data.approvalPolicy !== "ask" && data.approvalPolicy !== "never")) {
        setLocalError(data.error === "discussion_busy" ? "回合运行中，下一回合再修改" : data.error ?? "权限设置保存失败");
        return;
      }
      onUpdated?.({ permissionMode: data.permissionMode, approvalPolicy: data.approvalPolicy });
    } catch {
      setLocalError("权限设置保存失败");
    } finally {
      setSaving(false);
    }
  };

  const disabled = busy || saving;
  return (
    <div className="flex flex-wrap items-center gap-2 text-fine text-ink-48" aria-label="讨论权限">
      <span className="inline-flex items-center gap-1 rounded-full bg-parchment px-2.5 py-1" title="工具仅可读取资料，不可修改文件">
        <LockKey size={13} /> {permissionMode === "read-only" ? "只读" : permissionMode}
      </span>
      <span className="text-ink-40">审批</span>
      <div className="inline-flex rounded-sm border border-hairline bg-white p-0.5" role="group" aria-label="审批策略">
        <button
          type="button"
          aria-pressed={approvalPolicy === "ask"}
          disabled={disabled}
          onClick={() => void updatePolicy("ask")}
          className={cn("rounded-sm px-2 py-1 transition-colors", approvalPolicy === "ask" ? "bg-primary/10 font-semibold text-primary" : "text-ink-48 hover:text-ink")}
        >
          询问
        </button>
        <button
          type="button"
          aria-pressed={approvalPolicy === "never"}
          disabled={disabled}
          onClick={() => void updatePolicy("never")}
          className={cn("rounded-sm px-2 py-1 transition-colors", approvalPolicy === "never" ? "bg-parchment font-semibold text-ink-80" : "text-ink-48 hover:text-ink")}
        >
          自动拒绝
        </button>
      </div>
      {saving && <SpinnerGap size={13} className="animate-spin text-primary" aria-label="保存中" />}
      {busy && !saving && <span className="text-ink-48">当前回合结束后可修改</span>}
      {localError && <span className="text-error">{localError}</span>}
    </div>
  );
}
