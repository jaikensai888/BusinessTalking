"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChatCircleDots, Check, CheckCircle, Clock, FilePdf, FileText, Play, Trash, XCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { CopyId } from "@/components/ui/copy-id";

interface Space {
  id: string;
  type: "discussion" | "run";
  title: string;
  preview: string;
  status: "pending" | "running" | "ready" | "done" | "failed" | "cancelled";
  meta: string;
  attachmentName?: string | null;
  artifactCount?: number;
  hasReport?: boolean;
  shortId?: string | null;
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

/**
 * 会话空间卡片：合并讨论 + 分析运行，按最新排序。
 * - onDelete 传入时单卡显示删除按钮。
 * - selectionMode + selectedKeys + onToggleSelect 时进入批量选择（点卡片切换选中）。
 */
export function SpacesCards({
  refreshKey,
  onNew,
  onDelete,
  maxItems = 24,
  selectionMode = false,
  selectedKeys,
  onToggleSelect,
  query = "",
}: {
  refreshKey: number;
  onNew?: () => void;
  onDelete?: (type: "discussion" | "run", id: string) => void;
  maxItems?: number;
  selectionMode?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (key: string) => void;
  query?: string;
}) {
  const router = useRouter();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchLimit = Math.min(100, maxItems);

  async function load() {
    try {
      const [disc, runs] = await Promise.all([
        fetch("/api/v1/discussions?page_size=100").then((r) => r.json()),
        fetch(`/api/v1/runs?page_size=${fetchLimit}`).then((r) => r.json()),
      ]);

      const dSpaces: Space[] = disc.code === 0 ? disc.data.items.map((i: { id: string; brief: string; status: string; personaCount?: number; attachmentName?: string | null; artifactCount?: number; shortId?: string | null; createdAt: string }) => ({
        id: i.id,
        type: "discussion",
        title: i.brief.slice(0, 24),
        preview: i.brief.slice(0, 60),
        status: i.status,
        meta: i.personaCount === 1 ? "1 对 1" : "讨论",
        attachmentName: i.attachmentName,
        artifactCount: i.artifactCount ?? 0,
        shortId: i.shortId,
        createdAt: i.createdAt,
      })) : [];

      const rSpaces: Space[] = runs.code === 0 ? runs.data.items.map((i: { id: string; recipeName: string; status: string; ideaPreview: string; hasReport?: boolean; createdAt: string }) => ({
        id: i.id,
        type: "run",
        title: i.recipeName,
        preview: i.ideaPreview,
        status: i.status,
        meta: "分析",
        hasReport: i.hasReport,
        createdAt: i.createdAt,
      })) : [];

      const all = [...dSpaces, ...rSpaces].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      setSpaces(all);

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
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // 客户端搜索过滤：匹配标题/摘要/类型/状态/附件/编号
  const q = query.trim().toLowerCase();
  const shown = q
    ? spaces.filter((s) => {
        const statusLabel = STATUS_META[s.status]?.label ?? "";
        const typeLabel = s.type === "discussion" ? "讨论" : "分析";
        return [s.title, s.preview, s.meta, s.attachmentName ?? "", s.shortId ?? "", statusLabel, typeLabel, s.status]
          .some((v) => v && String(v).toLowerCase().includes(q));
      })
    : spaces;
  const viewItems = shown.slice(0, maxItems);

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

  if (viewItems.length === 0) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-hairline bg-pearl/40 px-8 py-14 text-center">
        <p className="text-[15px] font-medium text-ink">没有匹配的会话</p>
        <p className="text-[13px] text-ink-48">换个关键词，或清除搜索条件试试。</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
      {viewItems.map((s, i) => {
        const meta = STATUS_META[s.status] ?? STATUS_META.pending;
        const IconComponent = meta.icon;
        const isDisc = s.type === "discussion";
        const href = isDisc ? `/discussions?id=${s.id}` : `/runs/${s.id}`;
        const key = `${s.type}:${s.id}`;
        const isSelected = selectedKeys?.has(key) ?? false;
        const hasProduct = isDisc ? (s.artifactCount ?? 0) > 0 : Boolean(s.hasReport);
        const open = () => router.push(href);
        return (
          <div
            key={key}
            role={selectionMode ? "checkbox" : "button"}
            aria-checked={selectionMode ? isSelected : undefined}
            tabIndex={0}
            onClick={() => (selectionMode && onToggleSelect ? onToggleSelect(key) : open())}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (selectionMode && onToggleSelect) onToggleSelect(key);
                else open();
              }
            }}
            className={cn(
              "group flex cursor-pointer flex-col gap-3 rounded-2xl border bg-white p-4 text-left transition-all duration-200 outline-none",
              "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_14px_44px_rgba(0,0,0,0.08)]",
              selectionMode && isSelected ? "border-primary ring-2 ring-primary/30" : "border-hairline",
              i < 6 && "fl-rise",
              i < 6 && `fl-rise-delay-${(i % 3) + 1}`
            )}
          >
            <div className="flex items-center gap-2">
              {selectionMode && (
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                    isSelected ? "border-primary bg-primary text-white" : "border-hairline bg-white"
                  )}
                >
                  {isSelected && <Check size={11} weight="bold" />}
                </span>
              )}
              <Badge variant={isDisc ? "primary" : "neutral"}>
                {isDisc ? <ChatCircleDots size={12} weight="fill" /> : null}
                {s.meta}
              </Badge>
              <div className="ml-auto flex items-center gap-1.5">
                <Badge variant={meta.badge}>
                  <IconComponent size={12} weight="fill" />
                  {meta.label}
                </Badge>
                {!selectionMode && onDelete && (
                  <button
                    type="button"
                    aria-label="删除会话"
                    title="删除会话"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(s.type, s.id);
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-40 transition-colors hover:bg-error/10 hover:text-error"
                  >
                    <Trash size={14} />
                  </button>
                )}
              </div>
            </div>

            <span className="line-clamp-1 text-[15px] font-semibold leading-[1.3] text-ink">{s.title}</span>
            <p className="line-clamp-2 text-[13px] leading-[1.55] text-ink-48">{s.preview}</p>

            <div className="mt-auto flex items-center gap-2 border-t border-divider-soft pt-2.5">
              {s.attachmentName && (
                <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-pearl px-2 py-1 text-[11px] text-ink-60">
                  <FilePdf size={12} className="shrink-0 text-error" />
                  <span className="truncate">{s.attachmentName}</span>
                </span>
              )}
              {hasProduct && (
                <span className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                  <FileText size={12} />
                  {isDisc ? `产物 ${s.artifactCount} 份` : "已出报告"}
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-ink-40">
                <CopyId id={s.shortId} />
                {new Date(s.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
