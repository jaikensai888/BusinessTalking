"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ListBullets } from "@phosphor-icons/react";
import { EmptyState } from "@/components/ui/empty-state";

interface HistoryItem {
  id: string;
  recipeName: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  ideaPreview: string;
  error: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "等待中", color: "text-ink-48" },
  running: { label: "执行中", color: "text-primary" },
  done: { label: "完成", color: "text-success" },
  failed: { label: "失败", color: "text-error" },
  cancelled: { label: "已取消", color: "text-ink-48" },
};

/** UX 4.9 运行历史筛选视图 */
export default function RunsHistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    try {
      const res = await fetch(`/api/v1/runs?${params.toString()}`);
      const d = await res.json();
      if (d.code === 0) setItems(d.data.items);
      else setError(d.message ?? "加载失败");
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="px-6 py-10 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px]">运行历史</h1>
          <p className="text-ink-48 text-[14px] mt-1">回看所有可行性分析记录</p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-white border border-hairline rounded-full h-11 px-5 text-[14px] outline-none focus:border-primary"
        >
          <option value="">全部状态</option>
          <option value="pending">等待中</option>
          <option value="running">执行中</option>
          <option value="done">完成</option>
          <option value="failed">失败</option>
        </select>
      </div>

      {error && <div className="mb-4 bg-white border-l-[3px] border-error rounded-lg p-4 text-[14px] text-ink-80">{error}</div>}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-pearl border border-hairline rounded-lg animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ListBullets}
          title="还没有运行记录"
          description="去工作台输入一个商业想法（@ 引用配方）开始第一次可行性分析。"
        />
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const meta = STATUS_LABEL[r.status] ?? STATUS_LABEL.pending;
            return (
              <button
                key={r.id}
                onClick={() => router.push(`/runs/${r.id}`)}
                className="w-full bg-white border border-hairline rounded-lg px-5 py-4 flex items-center gap-4 text-left hover:border-primary transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold">{r.recipeName}</span>
                    <span className={cn("text-[12px]", meta.color)}>{meta.label}</span>
                  </div>
                  <div className="text-[13px] text-ink-48 mt-0.5 line-clamp-1">
                    步骤 {Math.min(r.currentStep, r.totalSteps)}/{r.totalSteps} · {r.ideaPreview}
                  </div>
                </div>
                <span className="text-[12px] text-ink-48 shrink-0">{new Date(r.createdAt).toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
