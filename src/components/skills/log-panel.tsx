"use client";

import { cn } from "@/lib/utils";

/** UX 4.2.1 执行日志面板：等宽字体，错误行红色高亮 */
export function LogPanel({ logs, failed }: { logs: string[]; failed: boolean }) {
  if (logs.length === 0) {
    return (
      <div className="rounded-sm bg-tile-3 text-white/70 p-4 text-caption font-mono min-h-24">
        等待执行…
      </div>
    );
  }
  return (
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
  );
}
