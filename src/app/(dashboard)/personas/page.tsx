"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UsersThree } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";

const PERSPECTIVES: { value: string; label: string }[] = [
  { value: "", label: "全部视角" },
  { value: "investor", label: "风险投资人" },
  { value: "customer", label: "挑剔客户" },
  { value: "competitor", label: "竞争对手" },
  { value: "economist", label: "奥派经济学家" },
  { value: "entrepreneur", label: "连续创业者" },
  { value: "analyst", label: "行业分析师" },
  { value: "custom", label: "自定义" },
];

const TYPE_LABEL: Record<string, string> = {
  investor: "风险投资人",
  customer: "挑剔客户",
  competitor: "竞争对手",
  economist: "奥派经济学家",
  entrepreneur: "连续创业者",
  analyst: "行业分析师",
  custom: "自定义",
};

interface PersonaItem {
  id: string;
  name: string;
  description: string | null;
  perspectiveType: string;
  avatarType: string;
  avatarValue: string | null;
  isBuiltin: boolean;
}

/** UX 4.4 人格库：头像卡片网格 + 视角筛选 */
export default function PersonasPage() {
  const router = useRouter();
  const [items, setItems] = useState<PersonaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [perspectiveType, setPerspectiveType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [search, setSearch] = useState("");

  const load = async (q = search, pt = perspectiveType) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      if (pt) params.set("perspectiveType", pt);
      const res = await fetch(`/api/v1/personas?${params.toString()}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perspectiveType]);

  const onSearch = (v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(v, perspectiveType), 300);
  };

  return (
    <div className="px-6 py-10">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px]">人格库</h1>
          <p className="text-ink-48 text-[14px] mt-1">
            共 {total} 个人格 · 点击卡片可与人格一对一交流，获得多视角启发
          </p>
        </div>
        <Button onClick={() => router.push("/personas/new")}>+ 新增人格</Button>
      </div>

      <div className="flex gap-3 mb-6">
        <Input pill placeholder="搜索人格…" value={search} onChange={(e) => onSearch(e.target.value)} className="w-72" />
        <select
          value={perspectiveType}
          onChange={(e) => setPerspectiveType(e.target.value)}
          className="bg-white border border-hairline rounded-full h-11 px-5 text-[14px] outline-none focus:border-primary"
        >
          {PERSPECTIVES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 bg-white border-l-[3px] border-error rounded-lg p-4 text-[14px] text-ink-80">{error}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-44 bg-pearl border border-hairline rounded-lg animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={UsersThree}
          title="人格库还是空的"
          description="点击右上角「+ 新增人格」，录入人格蒸馏产物，用于质询视角与一对一交流。"
        />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/personas/${p.id}`)}
              className="bg-white border border-hairline rounded-lg p-6 flex flex-col items-center gap-3 text-left hover:border-primary transition-colors cursor-pointer"
            >
              <Avatar name={p.name} size="lg" />
              <div className="text-center">
                <div className="text-[17px] font-semibold leading-[1.24]">{p.name}</div>
                <div className="text-[12px] text-primary mt-0.5">{TYPE_LABEL[p.perspectiveType] ?? p.perspectiveType}</div>
              </div>
              {p.description && (
                <div className="text-[12px] text-ink-48 leading-[1.43] line-clamp-2 text-center">{p.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
