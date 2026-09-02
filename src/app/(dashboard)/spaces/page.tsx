"use client";

import { useState } from "react";
import { ChatCircleDots, Trash, X } from "@phosphor-icons/react";
import { SpacesCards } from "@/components/workspace/spaces-cards";

/** 会话空间：所有讨论 + 分析运行都在这里，支持单删与批量删除 */
export default function SpacesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const deleteOne = async (type: "discussion" | "run", id: string) => {
    if (!window.confirm("确定删除这个会话吗？删除后不可恢复。")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/${type === "discussion" ? "discussions" : "runs"}/${id}`, { method: "DELETE" });
      const d = await res.json();
      if (d.code !== 0) setError(d.message ?? "删除失败");
      else setRefreshKey((k) => k + 1);
    } catch {
      setError("删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const deleteMany = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selected.size} 个会话吗？删除后不可恢复。`)) return;
    setDeleting(true);
    setError(null);
    for (const key of selected) {
      const sep = key.indexOf(":");
      const type = key.slice(0, sep);
      const id = key.slice(sep + 1);
      if (!id) continue;
      try {
        await fetch(`/api/v1/${type === "discussion" ? "discussions" : "runs"}/${id}`, { method: "DELETE" });
      } catch {
        /* ignore individual failures */
      }
    }
    setSelected(new Set());
    setSelectionMode(false);
    setRefreshKey((k) => k + 1);
    setDeleting(false);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ChatCircleDots size={22} weight="duotone" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.4px]">会话空间</h1>
          <p className="text-[13px] text-ink-48">所有讨论与分析运行都在这里，可删除或批量清理</p>
        </div>
        {selectionMode ? (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ink-60">已选 {selected.size} 项</span>
            <button
              onClick={() => {
                setSelected(new Set());
                setSelectionMode(false);
              }}
              className="flex items-center gap-1 rounded-full border border-hairline px-3.5 py-2 text-[13px] text-ink-60 transition-colors hover:border-primary/40 hover:text-ink"
            >
              <X size={14} /> 取消
            </button>
            <button
              onClick={deleteMany}
              disabled={selected.size === 0 || deleting}
              className="flex items-center gap-1 rounded-full bg-error px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#e02e24] disabled:opacity-45"
            >
              <Trash size={14} /> 删除选中（{selected.size}）
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSelectionMode(true)}
            className="flex items-center gap-1.5 rounded-full border border-primary/50 px-4 py-2 text-[13px] text-primary transition-colors hover:bg-primary/5"
          >
            <Trash size={14} /> 批量删除
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-[14px] text-error">{error}</p>}

      <SpacesCards
        refreshKey={refreshKey}
        onDelete={selectionMode ? undefined : deleteOne}
        maxItems={100}
        selectionMode={selectionMode}
        selectedKeys={selected}
        onToggleSelect={selectionMode ? toggleSelect : undefined}
      />

      {deleting && <p className="mt-4 text-center text-[13px] text-ink-40">正在删除…</p>}
    </div>
  );
}
