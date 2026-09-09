"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** UX 4.2.1 执行日志面板：等宽字体，错误行红色高亮，支持一键复制日志 */
export function LogPanel({ logs, failed }: { logs: string[]; failed: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logs.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  if (logs.length === 0) {
    return (
      <div className="rounded-sm bg-tile-3 text-white/70 p-4 text-caption font-mono min-h-24">
        等待执行…
      </div>
    );
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 z-10 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-fine text-white/70 hover:text-white hover:bg-black/60 transition-colors"
      >
        {copied ? "已复制 ✓" : "复制日志"}
      </button>
      <div
        className={cn(
          "rounded-sm bg-tile-3 text-caption font-mono p-4 max-h-56 overflow-auto whitespace-pre-wrap break-all",
          failed ? "text-error" : "text-white/85"
        )}
      >
        {logs.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
