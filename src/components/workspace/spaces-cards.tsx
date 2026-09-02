"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChatCircleDots, CheckCircle, Clock, FilePdf, Play, XCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

interface Space {
  id: string;
  type: "discussion" | "run";
  title: string;
  preview: string;
  status: "pending" | "running" | "ready" | "done" | "failed" | "cancelled";
  meta: string;
  attachmentName?: string | null;
  createdAt: string;
}

const STATUS_META: Record<string, { label: string; badge: BadgeVariant; icon: React.ElementType }> = {
  pending: { label: "等待中", badge: "neutral", icon: Clock },
  running: { label: "进行中", badge: "primary", icon: Play },
  ready: { label: "待提问", badge: "primary", icon: ChatCircleDots },
  done: { label: "已结束", badge: "success", icon: CheckCircle },
  failed: { label: "失败", badge: "error", icon: XCircle },
  cancelled: { label: "已取消", badge: "neutral", icon: Clock },
};

/** 会话空间卡片：合并讨论 + 分析运行，按最新排序 */
export function SpacesCards({ refreshKey, onNew }: { refreshKey: number; onNew?: () => void }) {
  const router = useRouter();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      const [disc, runs] = await Promise.all([
        fetch("/api/v1/discussions").then((r) => r.json()),
        fetch("/api/v1/runs?page_size=24").then((r) => r.json()),
      ]);

      const dSpaces: Space[] = disc.code === 0 ? disc.data.items.map((i: { id: string; brief: string; status: string; personaCount?: number; attachmentName?: string | null; createdAt: string }) => ({
        id: i.id,
        type: "discussion",
        title: i.brief.slice(0, 24),
        preview: i.brief.slice(0, 60),
        status: i.status,
        meta: i.personaCount === 1 ? "1 对 1" : "讨论",
        attachmentName: i.attachmentName,
        createdAt: i.createdAt,
      })) : [];

      const rSpaces: Space[] = runs.code === 0 ? runs.data.items.map((i: { id: string; recipeName: string; status: string; ideaPreview: string; createdAt: string }) => ({
        id: i.id,
        type: "run",
        title: i.recipeName,
        preview: i.ideaPreview,
        status: i.status,
        meta: "分析",
        createdAt: i.createdAt,
      })) : [];

      const all = [...dSpaces, ...rSpaces].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      setSpaces(all.slice(0, 24));

      const hasRunning = all.some((s) => s.status === "running" || s.status === "pending");
      if (hasRunning) {
        if (!pollRef.current) pollRef.current = setInterval(() => void load(), 3000);
      } else if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (loading && spaces.length === 0) {
    return (
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl bg-pearl" />
        ))}
      </div>
    );
  }

  if (spaces.length === 0) {
    return (
      <button
        onClick={onNew}
        className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-hairline bg-pearl/40 px-8 py-16 text-center transition-colors hover:border-primary/40 hover:bg-pearl/70"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ArrowRight size={26} weight="bold" />
        </div>
        <p className="text-[16px] font-semibold text-ink">开启一个会话空间</p>
        <p className="max-w-md text-[13px] leading-[1.6] text-ink-48">
          输入一个商业想法，@ 引用配方做分析，或 @ 多位人格开启一场讨论。
        </p>
      </button>
    );
  }

  return (
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
      {spaces.map((s, i) => {
        const meta = STATUS_META[s.status] ?? STATUS_META.pending;
        const IconComponent = meta.icon;
        const isDisc = s.type === "discussion";
        return (
          <button
            key={`${s.type}-${s.id}`}
            onClick={() => router.push(isDisc ? `/discussions?id=${s.id}` : `/runs/${s.id}`)}
            className={cn(
              "group flex flex-col gap-3 rounded-2xl border border-hairline bg-white p-4 text-left transition-all duration-200",
              "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_14px_44px_rgba(0,0,0,0.08)]",
              i < 6 && "fl-rise",
              i < 6 && `fl-rise-delay-${(i % 3) + 1}`
            )}
          >
            <div className="flex items-center justify-between">
              <Badge variant={isDisc ? "primary" : "neutral"}>
                {isDisc ? <ChatCircleDots size={12} weight="fill" /> : null}
                {s.meta}
              </Badge>
              <Badge variant={meta.badge}>
                <IconComponent size={12} weight="fill" />
                {meta.label}
              </Badge>
            </div>
            <span className="line-clamp-1 text-[15px] font-semibold leading-[1.3] text-ink">{s.title}</span>
            <p className="line-clamp-2 text-[13px] leading-[1.55] text-ink-48">{s.preview}</p>
            {s.attachmentName && (
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-40">
                <FilePdf size={12} className="shrink-0 text-error" />
                <span className="truncate">{s.attachmentName}</span>
              </div>
            )}
            <div className="mt-auto pt-1 text-[11px] text-ink-40">
              {new Date(s.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
