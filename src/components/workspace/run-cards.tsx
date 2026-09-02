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

/** 平铺纯色 app 图标色（类 Chrome Web Store 扩展图标，无渐变、避免"渐变绿丑"） */
const ICON_COLORS = ["#2f6fed", "#4f46e5", "#0ea5a6", "#b98a2f", "#e0567a", "#5b6b8c", "#7c5cd6", "#2e7d64"];

function iconFor(name: string): { initial: string; color: string } {
  const initial = name.trim().charAt(0) || "?";
  const hue = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return { initial, color: ICON_COLORS[hue % ICON_COLORS.length] };
}

/** UX 4.1 分析工作区卡片（Chrome Web Store 风格）：app 图标块 + 标题 + 状态/步骤 + 描述 */
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
          <div key={i} className="h-64 animate-pulse rounded-2xl bg-pearl" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <button
        onClick={onInvite}
        className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-hairline bg-pearl/40 px-8 py-20 text-center transition-colors hover:border-primary/40 hover:bg-pearl/70"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ArrowRight size={26} weight="bold" />
        </div>
        <p className="text-[16px] font-semibold text-ink">进入分析</p>
        <p className="max-w-md text-[13px] leading-[1.6] text-ink-48">
          描述你的商业想法（@ 引用配方），产出带多视角质询的可行性报告，结果会以卡片展示在这里。
        </p>
      </button>
    );
  }

  return (
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
      {items.map((run, i) => {
        const meta = STATUS_META[run.status] ?? STATUS_META.pending;
        const IconComponent = meta.icon;
        const icon = iconFor(run.recipeName);
        return (
          <button
            key={run.id}
            onClick={() => router.push(`/runs/${run.id}`)}
            className={cn(
              "group flex flex-col gap-3 rounded-2xl border border-hairline bg-white p-4 text-left",
              "transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_14px_44px_rgba(0,0,0,0.08)]",
              i < 6 && "fl-rise",
              i < 6 && `fl-rise-delay-${(i % 3) + 1}`
            )}
          >
            {/* app 图标块（平铺纯色，类扩展图标） */}
            <div className="flex h-24 items-center justify-center rounded-xl" style={{ backgroundColor: icon.color }} aria-hidden>
              <FileText size={40} weight="bold" className="text-white/90" />
            </div>

            {/* 标题 */}
            <span className="line-clamp-1 text-[15px] font-semibold leading-[1.3] text-ink">{run.recipeName}</span>

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
                  <span className="ml-1 text-[11px] tabular-nums text-ink-40">
                    {Math.min(run.currentStep, run.totalSteps)}/{run.totalSteps}
                  </span>
                </span>
              )}
            </div>

            {/* 描述 */}
            <p className="line-clamp-2 text-[13px] leading-[1.55] text-ink-48">{run.ideaPreview}</p>
            {run.status === "failed" && run.error && (
              <p className="line-clamp-1 text-[12px] text-error">{run.error}</p>
            )}

            <div className="mt-auto pt-1 text-[11px] text-ink-40">
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
