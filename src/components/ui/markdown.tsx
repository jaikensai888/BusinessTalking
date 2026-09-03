"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

function inline(text: string, names?: Set<string>, seed = 0): ReactNode[] {
  const out: ReactNode[] = [];
  // 依次处理 **bold**、*italic*、`code`、[link](url)、@人名
  const regex =
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|@([\p{L}\p{N}\u4e00-\u9fff_\-·]+))/gu;
  let last = 0;
  let key = seed;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    if (last < m.index) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(
        <strong key={key++} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={key++} className="rounded bg-ink/10 px-1 py-0.5 text-[0.88em] font-medium">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      out.push(
        <a key={key++} href={lm[2]} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
          {lm[1]}
        </a>
      );
    } else if (tok.startsWith("@")) {
      if (names?.has(m[2] ?? "")) out.push(<span key={key++} className="font-semibold text-primary">@{m[2]}</span>);
      else out.push(tok);
    } else {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * 轻量 Markdown 渲染（用于聊天气泡）：段落、bold/italic/code/链接、@提及、
 * 1~3 级标题、> 引用、--- 分隔线、- / 1. 列表。tone=dark 用于深色气泡（用户）。
 */
export function Markdown({
  children,
  names,
  tone = "light",
  className,
}: {
  children: string;
  names?: Set<string>;
  tone?: "light" | "dark";
  className?: string;
}) {
  const blocks: ReactNode[] = [];
  let para: ReactNode[] = [];
  let list: ReactNode[] = [];
  let inList = false;

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={blocks.length} className="my-1 first:mt-0 last:mb-0 leading-[1.7]">
          {para}
        </p>
      );
      para = [];
    }
  };
  const flushList = () => {
    if (inList) {
      blocks.push(
        <ul key={blocks.length} className="my-1 list-disc space-y-0.5 pl-4 first:mt-0 last:mb-0">
          {list}
        </ul>
      );
      list = [];
      inList = false;
    }
  };

  for (const raw of children.split("\n")) {
    const t = raw.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    if (/^[-*] /.test(t)) {
      flushPara();
      inList = true;
      list.push(<li key={list.length}>{inline(t.slice(2), names)}</li>);
      continue;
    }
    if (/^\d+\. /.test(t)) {
      flushPara();
      inList = true;
      list.push(<li key={list.length}>{inline(t.replace(/^\d+\.\s*/, ""), names)}</li>);
      continue;
    }
    flushList();
    if (/^---+\s*$/.test(t)) {
      flushPara();
      blocks.push(<hr key={blocks.length} className="my-3 border-t border-divider-soft" />);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      const lvl = h[1].length;
      blocks.push(
        <div
          key={blocks.length}
          className={cn(
            "py-0.5 font-semibold",
            lvl === 1 ? "text-[15px]" : lvl === 2 ? "text-[14px]" : "text-[13px]",
            tone === "dark" ? "text-white" : "text-ink"
          )}
        >
          {inline(h[2], names)}
        </div>
      );
      continue;
    }
    if (/^>\s?/.test(t)) {
      flushPara();
      blocks.push(
        <blockquote
          key={blocks.length}
          className={cn(
            "my-1.5 border-l-2 pl-2.5 text-[0.95em] first:mt-0 last:mb-0",
            tone === "dark" ? "border-white/40 text-white/90" : "border-primary/35 text-ink-80"
          )}
        >
          {inline(t.replace(/^>\s?/, ""), names)}
        </blockquote>
      );
      continue;
    }
    para.push(...inline(raw, names, para.length));
    para.push(<br key={para.length} />);
  }
  flushPara();
  flushList();

  return <div className={cn("whitespace-normal", className)}>{blocks}</div>;
}
