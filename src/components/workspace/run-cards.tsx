"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle, Clock, FileText, Play, WarningCircle, XCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

interface RunItem {
  id: string;
  recipeName: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  currentStep: number;
  totalSteps: number;
  stepStatuses: string[];
  ideaPreview: string;
  error: string | null;
  createdAt: string;
}

const STATUS_META: Record<string, { label: string; badge: BadgeVariant; icon: React.ElementType }> = {
  pending: { label: "等待中", badge: "neutral", icon: Clock },
  running: { label: "执行中", badge: "primary", icon: Play },
  done: { label: "已完成", badge: "success", icon: CheckCircle },
  failed: { label: "失败", badge: "error", icon: XCircle },
  cancelled: { label: "已取消", badge: "neutral", icon: WarningCircle },
};

/** UX 4.1 分析工作区卡片（DESIGN.md store-utility-card）：图标块 + 标题 + 状态/步骤 + 描述
 *  图标块改用规范暗色瓦片 tile-1 + 暗面专用蓝，取代原先按名称哈希生成的 8 色彩虹调色板
 *  （DESIGN.md Do's：单一强调色，不引入第二个品牌色） */
export function RunCards({ refreshKey, onInvite }: { refreshKey: number; onInvite?: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/v1/runs?page_size=24");
      const d = await res.json();
      if (d.code === 0) {
        setItems(d.data.items);
        const hasRunning = d.data.items.some((i: RunItem) => i.status === "running" || i.status === "pending");
        if (hasRunning) {
          if (!pollRef.current) {
            pollRef.current = setInterval(() => void load(), 3000);
          }
        } else if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      /* 忽略轮询失败 */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (loading && items.length === 0) {
    return (
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-lg bg-pearl" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <button
        onClick={onInvite}
        className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-hairline bg-pearl/40 px-8 py-20 text-center transition-colors hover:border-primary/40 hover:bg-pearl/70"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ArrowRight size={26} weight="bold" />
        </div>
        <p className="text-body font-semibold text-ink">进入分析</p>
        <p className="max-w-md text-caption leading-[1.6] text-ink-48">
          描述你的商业想法（@ 引用配方），产出带多视角质询的可行性报告，结果会以卡片展示在这里。
        </p>
      </button>
    );
  }

  return (
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
      {/* 运行状态变化对屏幕阅读器播报（轮询 3s 刷新，视觉用户可从徽章感知） */}
      <span className="sr-only" role="status" aria-live="polite">
        {items.some((r) => r.status === "running")
          ? "有分析正在执行中"
          : items.some((r) => r.status === "failed")
            ? "有分析执行失败"
            : items.length > 0
              ? "当前没有正在执行的分析"
              : ""}
      </span>
      {items.map((run, i) => {
        const meta = STATUS_META[run.status] ?? STATUS_META.pending;
        const IconComponent = meta.icon;
        return (
          <button
            key={run.id}
            onClick={() => router.push(`/runs/${run.id}`)}
            className={cn(
              "group flex flex-col gap-3 rounded-lg border border-hairline bg-white p-4 text-left",
              "transition-all duration-200 hover:border-primary/40 hover:bg-pearl/60",
              i < 6 && "fl-rise",
              i < 6 && `fl-rise-delay-${(i % 3) + 1}`
            )}
          >
            {/* 暗色瓦片图标块（规范 tile-1 + 暗面专用蓝，inline 图像用 rounded.sm） */}
            <div className="flex h-24 items-center justify-center rounded-sm bg-tile-1" aria-hidden>
              <FileText size={32} weight="bold" className="text-primary-on-dark" />
            </div>

            {/* 标题 */}
            <span className="line-clamp-1 text-caption font-semibold leading-[1.3] text-ink">{run.recipeName}</span>

            {/* 状态 + 步骤行 */}
            <div className="flex items-center gap-2">
              <Badge variant={meta.badge} className="shrink-0">
                <IconComponent size={12} weight="fill" />
                {meta.label}
              </Badge>
              {run.stepStatuses?.length > 0 && (
                <span className="flex items-center gap-1">
                  {run.stepStatuses.map((st, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        st === "done" && "bg-success",
                        st === "failed" && "bg-error",
                        st === "running" && "bg-primary animate-pulse",
                        st === "skipped" && "bg-warning",
                        (st === "pending" || st === "cancelled") && "bg-divider-soft"
                      )}
                    />
                  ))}
                  <span className="ml-1 text-fine tabular-nums text-ink-40">
                    {Math.min(run.currentStep, run.totalSteps)}/{run.totalSteps}
                  </span>
                </span>
              )}
            </div>

            {/* 描述 */}
            <p className="line-clamp-2 text-caption leading-[1.55] text-ink-48">{run.ideaPreview}</p>
            {run.status === "failed" && run.error && (
              <p className="line-clamp-1 text-fine text-error">{run.error}</p>
            )}

            <div className="mt-auto pt-1 text-fine text-ink-40">
              {new Date(run.createdAt).toLocaleString("zh-CN", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
