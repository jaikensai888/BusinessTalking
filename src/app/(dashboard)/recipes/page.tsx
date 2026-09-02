"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Scroll } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

interface RecipeItem {
  id: string;
  name: string;
  description: string | null;
  version: string;
  stepCount: number;
  runCount: number;
  updatedAt: string;
}

/** UX 配方列表页 */
export default function RecipesPage() {
  const router = useRouter();
  const [items, setItems] = useState<RecipeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/recipes?page_size=100");
      const d = await res.json();
      if (d.code === 0) {
        setItems(d.data.items);
        setTotal(d.data.pagination.total);
      } else {
        setError(d.message ?? "加载失败");
      }
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const duplicate = async (id: string) => {
    const res = await fetch(`/api/v1/recipes/${id}/duplicate`, { method: "POST" });
    const d = await res.json();
    if (d.code === 0) load();
    else window.alert(d.message ?? "复制失败");
  };

  const remove = async (id: string) => {
    if (!window.confirm("确认删除该配方？历史运行记录将保留（快照）。")) return;
    const res = await fetch(`/api/v1/recipes/${id}`, { method: "DELETE" });
    const d = await res.json();
    if (d.code === 0) load();
    else window.alert(d.message ?? "删除失败");
  };

  return (
    <div className="px-6 py-10 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px]">配方</h1>
          <p className="text-ink-48 text-[14px] mt-1">共 {total} 个配方 · 把 skill 与人格编排成可行性分析流程</p>
        </div>
        <Button onClick={() => router.push("/recipes/new")}>+ 新建配方</Button>
      </div>

      {error && <div className="mb-4 bg-white border-l-[3px] border-error rounded-lg p-4 text-[14px] text-ink-80">{error}</div>}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-pearl border border-hairline rounded-lg animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Scroll}
          title="还没有配方"
          description="把 skill 与人格编排成可行性分析流程，然后在工作台 @ 引用即可一键执行。"
          action={<Button onClick={() => router.push("/recipes/new")}>+ 新建配方</Button>}
        />
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <div key={r.id} className="bg-white border border-hairline rounded-lg p-6 flex items-center gap-4 hover:border-primary transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    className="text-[17px] font-semibold hover:text-primary transition-colors text-left"
                    onClick={() => router.push(`/recipes/${r.id}/edit`)}
                  >
                    {r.name}
                  </button>
                  <span className="text-[12px] text-ink-48">v{r.version}</span>
                </div>
                {r.description && <div className="text-[13px] text-ink-48 mt-1 line-clamp-1">{r.description}</div>}
                <div className="text-[12px] text-ink-48 mt-1">
                  {r.stepCount} 个步骤 · 已运行 {r.runCount} 次
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="ghost" onClick={() => router.push(`/recipes/${r.id}/edit`)}>
                  编辑
                </Button>
                <Button variant="ghost" onClick={() => duplicate(r.id)}>
                  复制
                </Button>
                <Button variant="danger" onClick={() => remove(r.id)}>
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
