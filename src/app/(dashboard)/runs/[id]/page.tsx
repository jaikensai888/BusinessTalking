"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { downloadMarkdown } from "@/lib/export";

interface RunStep {
  stepIndex: number;
  skillName: string;
  personaName: string | null;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  input: unknown;
  output: unknown;
  error: string | null;
  durationMs: number | null;
}

interface RunDetail {
  id: string;
  recipeName: string;
  ideaInput: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  provider: string | null;
  model: string | null;
  error: string | null;
  finalReport: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: RunStep[];
}

const STEP_ICON: Record<string, string> = {
  pending: "·",
  running: "●",
  done: "✓",
  failed: "✗",
  skipped: "⏸",
};

/** UX 4.8 运行详情页：进度 + 步骤时间线 + 最终报告 */
export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/runs/${id}`);
        const d = await res.json();
        if (d.code === 0) {
          setRun(d.data);
          if (d.data.status === "running" || d.data.status === "pending") {
            if (!pollRef.current) pollRef.current = setInterval(load, 2500);
          } else if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } else {
          setError(d.message ?? "加载失败");
        }
      } catch {
        setError("加载失败");
      }
    };
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id]);

  const act = async (action: "retry" | "skip", stepIndex: number) => {
    const res = await fetch(`/api/v1/runs/${id}/steps/${stepIndex}/${action}`, { method: "POST" });
    const d = await res.json();
    if (d.code !== 0) window.alert(d.message ?? "操作失败");
    // 重新拉取（轮询会自动接管）
    const r = await fetch(`/api/v1/runs/${id}`);
    const dd = await r.json();
    if (dd.code === 0) setRun(dd.data);
  };

  if (error) {
    return (
      <div className="px-6 py-10 text-[14px] text-error">
        {error}
        <button className="ml-4 text-primary underline" onClick={() => router.push("/")}>
          返回工作台
        </button>
      </div>
    );
  }

  if (!run) {
    return <div className="px-6 py-10 h-64 bg-pearl border border-hairline rounded-lg animate-pulse" />;
  }

  const pct = run.totalSteps > 0 ? Math.round((run.currentStep / run.totalSteps) * 100) : 0;
  const isRunning = run.status === "running" || run.status === "pending";

  return (
    <div className="px-6 py-10 max-w-4xl">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-[1.2] tracking-[-0.374px]">{run.recipeName}</h1>
          <p className="text-[14px] text-ink-48 mt-1 line-clamp-2">{run.ideaInput}</p>
        </div>
        <Button
          variant="dark"
          onClick={() => downloadMarkdown(`可行性报告-${run.recipeName}.md`, run.finalReport ?? "")}
          disabled={!run.finalReport}
        >
          导出报告
        </Button>
      </div>

      <div className="bg-white border border-hairline rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span
            className={cn(
              "text-[14px] font-semibold",
              run.status === "done" && "text-success",
              run.status === "failed" && "text-error",
              isRunning && "text-primary"
            )}
          >
            {run.status === "done" && "✓ 已完成"}
            {run.status === "failed" && "✗ 失败"}
            {isRunning && "● 执行中"}
          </span>
          <span className="text-[13px] text-ink-48">
            步骤 {Math.min(run.currentStep, run.totalSteps)}/{run.totalSteps}
            {run.provider ? ` · ${run.provider}` : ""}
          </span>
        </div>
        <div className="h-2 bg-parchment rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", run.status === "failed" ? "bg-error" : "bg-primary")}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        {run.error && <p className="mt-3 text-[13px] text-error">{run.error}</p>}
      </div>

      <h2 className="text-[21px] font-semibold tracking-[0.231px] mb-3">步骤时间线</h2>
      <div className="space-y-2 mb-8">
        {run.steps.map((s) => {
          const isFailed = s.status === "failed";
          return (
            <div key={s.stepIndex} className="bg-white border border-hairline rounded-lg">
              <button
                className="w-full flex items-center gap-3 px-5 py-3 text-left"
                onClick={() => setExpanded(expanded === s.stepIndex ? null : s.stepIndex)}
              >
                <span
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-[13px] shrink-0",
                    s.status === "done" && "bg-success text-white",
                    s.status === "failed" && "bg-error text-white",
                    s.status === "running" && "bg-primary text-white animate-pulse",
                    s.status === "skipped" && "bg-warning text-white",
                    s.status === "pending" && "bg-parchment text-ink-48"
                  )}
                >
                  {STEP_ICON[s.status]}
                </span>
                <span className="text-[15px] font-semibold flex-1">
                  {s.stepIndex}. {s.skillName}
                  {s.personaName && <span className="ml-2 text-[12px] font-normal text-primary">@{s.personaName}</span>}
                </span>
                {s.durationMs !== null && (
                  <span className="text-[12px] text-ink-48">{(s.durationMs / 1000).toFixed(1)}s</span>
                )}
                <span className="text-[12px] text-ink-48">{expanded === s.stepIndex ? "收起" : "展开"}</span>
              </button>

              {expanded === s.stepIndex && (
                <div className="px-5 pb-4 space-y-3 border-t border-hairline pt-3">
                  {s.error && <p className="text-[13px] text-error">错误：{s.error}</p>}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[12px] text-ink-48 mb-1">输入</div>
                      <pre className="bg-parchment rounded-[8px] p-3 text-[12px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
                        {JSON.stringify(s.input, null, 2) ?? "—"}
                      </pre>
                    </div>
                    <div>
                      <div className="text-[12px] text-ink-48 mb-1">输出</div>
                      <pre className="bg-parchment rounded-[8px] p-3 text-[12px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
                        {typeof s.output === "string" ? s.output : JSON.stringify(s.output, null, 2) ?? "—"}
                      </pre>
                    </div>
                  </div>
                  {isFailed && (
                    <div className="flex gap-2">
                      <Button onClick={() => act("retry", s.stepIndex)}>重试该步骤</Button>
                      <Button variant="secondary" onClick={() => act("skip", s.stepIndex)}>
                        跳过该步骤
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {run.finalReport && (
        <>
          <h2 className="text-[21px] font-semibold tracking-[0.231px] mb-3">最终报告</h2>
          <div className="bg-white border border-hairline rounded-lg p-6 mb-6">
            <pre className="whitespace-pre-wrap break-all text-[15px] leading-[1.6] font-sans">{run.finalReport}</pre>
          </div>
        </>
      )}
    </div>
  );
}
