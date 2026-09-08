"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CopyText } from "@/components/discussions/message-actions";

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
        <code key={key++} className="rounded bg-ink/10 px-1 py-0.5 text-[0.88em] font-semibold">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      out.push(
        <a key={key++} href={/^(https?:\/\/|\/|#)/i.test(lm[2]) && !lm[2].startsWith("//") ? lm[2] : undefined} target="_blank" rel="noreferrer" className={cn("underline underline-offset-2 break-words", "text-inherit")}>
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
  let ordered = false;

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
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={blocks.length} className={cn("my-2 space-y-1 pl-6 first:mt-0 last:mb-0", ordered ? "list-decimal" : "list-disc")}>{list}</List>);
      list = [];
      inList = false;
    }
  };

  const lines = children.split("\n");
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const t = raw.trim();
    if (t.startsWith("```")) {
      flushPara(); flushList();
      const language = t.slice(3).trim();
      const code: string[] = [];
      while (++index < lines.length && !lines[index].trim().startsWith("```")) code.push(lines[index]);
      const text = code.join("\n");
      blocks.push(<div key={blocks.length} className="my-3 overflow-hidden rounded-md border border-hairline bg-parchment text-ink">
        <div className="flex items-center justify-between px-3 text-fine text-ink-48"><span>{language || "代码"}</span><CopyText text={text} label="复制代码" /></div>
        <pre className="overflow-x-auto px-4 pb-4 text-caption"><code>{text}</code></pre>
      </div>);
      continue;
    }
    if (t.includes("|") && index + 1 < lines.length && cells(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      flushPara(); flushList();
      const headings = cells(t);
      const rows: string[][] = [];
      index++;
      while (index + 1 < lines.length && lines[index + 1].includes("|")) rows.push(cells(lines[++index]));
      blocks.push(<div key={blocks.length} className="my-3 max-w-full overflow-x-auto rounded-md border border-hairline"><table className="w-full border-collapse text-left text-caption">
        <thead><tr>{headings.map((cell, i) => <th key={i} scope="col" className="border-b border-hairline bg-ink/5 px-3 py-2 font-semibold">{inline(cell)}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{headings.map((_, j) => <td key={j} className="border-b border-hairline/50 px-3 py-2">{inline(row[j] ?? "")}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    if (/^[-*] /.test(t)) {
      flushPara();
      if (inList && ordered) flushList();
      ordered = false;
      inList = true;
      list.push(<li key={list.length}>{inline(t.slice(2), names)}</li>);
      continue;
    }
    if (/^\d+\. /.test(t)) {
      flushPara();
      if (inList && !ordered) flushList();
      ordered = true;
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
            "mb-2 mt-4 font-semibold first:mt-0",
            lvl === 1 ? "text-xl" : lvl === 2 ? "text-lg" : "text-base",
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

  return <div className={cn("min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]", className)}>{blocks}</div>;
}
