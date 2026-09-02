"use client";

import { useState } from "react";
import { ChatCircleDots } from "@phosphor-icons/react";
import { SpacesCards } from "@/components/workspace/spaces-cards";

/** 会话空间：所有讨论 + 分析运行都在这里，支持删除 */
export default function SpacesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (type: "discussion" | "run", id: string) => {
    if (!window.confirm("确定删除这个会话吗？删除后不可恢复。")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/${type === "discussion" ? "discussions" : "runs"}/${id}`, { method: "DELETE" });
      const d = await res.json();
      if (d.code === 0) setRefreshKey((k) => k + 1);
      else setError(d.message ?? "删除失败");
    } catch {
      setError("删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ChatCircleDots size={22} weight="duotone" />
        </div>
        <div>
          <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.4px]">会话空间</h1>
          <p className="text-[13px] text-ink-48">所有讨论与分析运行都在这里，可随时删除</p>
        </div>
      </div>

      {error && <p className="mb-4 text-[14px] text-error">{error}</p>}

      <SpacesCards refreshKey={refreshKey} onDelete={handleDelete} maxItems={100} />

      {deleting && <p className="mt-4 text-center text-[13px] text-ink-40">正在删除…</p>}
    </div>
  );
}
