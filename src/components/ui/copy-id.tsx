"use client";

import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** 短编号 + 点击复制（便于用户引用/排查会话） */
export function CopyId({ id, className }: { id?: string | null; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!id) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="点击复制编号"
      className={cn(
        "inline-flex items-center gap-1 text-[11px] text-ink-40 transition-colors hover:text-ink",
        className
      )}
    >
      {copied ? <Check size={12} className="text-[#1f7a43]" /> : <Copy size={12} />}
      <span>#{id}</span>
    </button>
  );
}
