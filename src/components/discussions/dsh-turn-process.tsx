"use client";

import { useEffect, useRef, useState } from "react";
import {
  Brain,
  CaretDown,
  CaretRight,
  CheckCircle,
  Clock,
  ListChecks,
  SpinnerGap,
  WarningCircle,
  Wrench,
  XCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { DshTurnView } from "@/lib/discussion/dsh-turn-projection";
import { Avatar } from "@/components/ui/avatar";
import { Markdown } from "@/components/ui/markdown";
import { SearchSources } from "./search-sources";

interface DshTurnProcessProps {
  turn: DshTurnView;
  name?: string;
}

function displayValue(value: unknown, max = 720): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return "[无法展示]";
  }
}

function durationLabel(durationMs: number | null): string {
  if (durationMs === null) return "—";
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function resolveTurnExpanded(
  status: DshTurnView["status"],
  manualExpanded: boolean | null,
  _collapsed: boolean,
): boolean {
  void _collapsed; // Retain the public helper signature for callers using the old projection flag.
  return manualExpanded ?? status === "failed";
}

function ToolStatus({ status }: { status: DshTurnView["tools"][number]["status"] }) {
  if (status === "running") return <SpinnerGap size={14} className="animate-spin text-primary" aria-label="执行中" />;
  if (status === "ok") return <CheckCircle size={14} weight="fill" className="text-success" aria-label="已完成" />;
  if (status === "error") return <XCircle size={14} weight="fill" className="text-error" aria-label="失败" />;
  return <WarningCircle size={14} className="text-ink-40" aria-label="已停止" />;
}

/** A compact, collapsible transcript of one DSH turn. */
export function DshTurnProcess({ turn, name = "讨论主持人" }: DshTurnProcessProps) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (turn.status !== "running" || turn.startedAtMs === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [turn.status, turn.startedAtMs]);

  const expanded = resolveTurnExpanded(turn.status, manualExpanded, turn.collapsed);

  // 执行中内容流式增长时自动跟随到底部；用户向上翻阅则不抢滚动
  useEffect(() => {
    if (!expanded || turn.status !== "running") return;
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [expanded, turn.status, turn.reasoning, turn.tools, turn.steps, turn.liveAnswer]);

  const durationMs = turn.durationMs
    ?? (turn.startedAtMs === null ? null : Math.max(0, (turn.endedAtMs ?? now) - turn.startedAtMs));
  const detailCount = turn.reasoning.length + turn.tools.length + turn.steps.length;
  const title = turn.status === "running"
    ? turn.liveAnswer ? "正在回答" : turn.tools.some((tool) => tool.name === "web_search" && tool.status === "running") ? "正在查资料" : "正在思考"
    : turn.status === "completed" ? "处理完成" : "回答未完成";

  return (
    <section className="min-w-0" aria-label={`${name}的处理过程`}>
      <div className="mb-1 flex items-center gap-2 text-caption font-semibold text-ink"><Avatar name={name} size="sm" />{name}{turn.turnNumber !== undefined && <span className="text-fine font-normal text-ink-48">第 {turn.turnNumber} 轮</span>}</div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded(!expanded)}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-caption text-ink-60 transition-colors hover:bg-white"
      >
        {expanded ? <CaretDown size={14} className="shrink-0 text-ink-40" /> : <CaretRight size={14} className="shrink-0 text-ink-40" />}
        <span className="text-ink-48">{title}</span><span className="hidden text-fine text-ink-48 sm:inline">{turn.tools.length > 0 ? `· ${turn.tools.length} 项操作` : ""}</span>
        <span className="ml-auto flex items-center gap-1.5 text-ink-40">
          <Clock size={13} /> {durationLabel(durationMs)}
          {turn.status === "running" && <SpinnerGap size={13} className="animate-spin text-primary" />}
          {turn.status === "completed" && <Badge variant="success">完成</Badge>}
          {turn.status === "failed" && <Badge variant="error">失败</Badge>}
        </span>
      </button>

      {expanded && (
        <div
          ref={bodyRef}
          className="mt-2 max-h-80 overflow-y-auto overscroll-contain rounded-md border border-hairline bg-white px-3.5 pb-3 pt-2.5"
        >
          {turn.reasoning.map((item) => (
            <div key={item.id} className="flex gap-2.5 border-l border-primary/20 py-1.5 pl-2.5 text-fine leading-5 text-ink-60">
              <Brain size={15} weight="duotone" className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-fine text-ink-40">思考{item.streaming ? " · 进行中" : ""}</div>
                <div className="whitespace-pre-wrap break-words">{item.text}</div>
              </div>
            </div>
          ))}

          {turn.steps.map((step) => (
            <div key={step.id} className="flex items-center gap-2 border-l border-divider-soft py-1.5 pl-2.5 text-fine text-ink-48">
              <ListChecks size={15} className="shrink-0 text-ink-40" />
              <span>{step.status === "running" ? "处理步骤" : step.status === "completed" ? "步骤完成" : "步骤失败"}</span>
              {step.status === "running" && <SpinnerGap size={13} className="animate-spin text-primary" />}
            </div>
          ))}

          {turn.tools.map((tool) => (
            <div key={tool.callId} className="my-1.5 rounded-sm border border-divider-soft bg-parchment/45 px-2.5 py-2">
              <div className="flex items-center gap-2 text-fine text-ink-80">
                <Wrench size={14} className="shrink-0 text-ink-48" />
                <span className="truncate font-semibold">{tool.name}</span>
                <span className="ml-auto shrink-0"><ToolStatus status={tool.status} /></span>
              </div>
              {displayValue(tool.input) && (
                <div className="mt-1 whitespace-pre-wrap break-words text-fine leading-4 text-ink-48">输入：{displayValue(tool.input)}</div>
              )}
              {displayValue(tool.output) && (
                <div className={cn("mt-1 whitespace-pre-wrap break-words text-fine leading-4", tool.status === "error" ? "text-error" : "text-ink-48")}>
                  输出：{displayValue(tool.output)}
                </div>
              )}
            </div>
          ))}


          {turn.error && (
            <div className="mt-2 flex gap-2 rounded-sm bg-error/5 px-2.5 py-2 text-fine leading-5 text-error">
              <WarningCircle size={15} className="mt-0.5 shrink-0" />
              <span className="break-words">{turn.error}</span>
            </div>
          )}

          {detailCount === 0 && !turn.error && (
            <div className="text-fine text-ink-40">已连接 DSH 会话，等待过程事件…</div>
          )}
        </div>
      )}
      {!turn.hasFinalMessage && turn.liveAnswer && <div className="mt-1 w-fit max-w-full rounded-lg bg-white px-3.5 py-2 text-base leading-6"><Markdown>{turn.liveAnswer}</Markdown></div>}
      <SearchSources tools={turn.tools} />
    </section>
  );
}
