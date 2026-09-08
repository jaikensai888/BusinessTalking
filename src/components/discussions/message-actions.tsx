"use client";

import { useState } from "react";

export function CopyText({ text, label = "复制" }: { text: string; label?: string }) {
  const [status, setStatus] = useState("");
  return <button type="button" className="min-h-11 rounded-sm px-2 text-fine text-ink-48 hover:bg-parchment hover:text-primary" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setStatus("已复制"); }
    catch { setStatus("复制失败，请手动选择"); }
  }} aria-label={label}><span role="status">{status || label}</span></button>;
}
