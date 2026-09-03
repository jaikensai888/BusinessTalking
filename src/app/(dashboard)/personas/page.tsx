"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, UsersThree } from "@phosphor-icons/react";
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

const PERSONA_AVATARS: Record<string, string> = {
  查理·芒格: "/personas/avatars/charlie-munger.png",
  纳瓦尔·拉维坎特: "/personas/avatars/naval-ravikant.png",
  保罗·格雷厄姆: "/personas/avatars/paul-graham.png",
  史蒂夫·乔布斯: "/personas/avatars/steve-jobs.png",
  埃隆·马斯克: "/personas/avatars/elon-musk.png",
  纳西姆·塔勒布: "/personas/avatars/nassim-taleb.png",
  安德烈·卡帕西: "/personas/avatars/andrej-karpathy.png",
  理查德·费曼: "/personas/avatars/richard-feynman.png",
  伊利亚·苏茨克维: "/personas/avatars/ilya-sutskever.png",
  MrBeast: "/personas/avatars/mrbeast.png",
  孙宇晨: "/personas/avatars/justin-sun.png",
  唐纳德·特朗普: "/personas/avatars/donald-trump.png",
  张一鸣: "/personas/avatars/zhang-yiming.png",
  张雪峰: "/personas/avatars/zhang-xuefeng.png",
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
            共 {total} 个人格。点击卡片，与人格一对一交流，获得多视角启发
          </p>
        </div>
        <Button onClick={() => router.push("/personas/new")} className="shrink-0">+ 新增人格</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-7">
        <Input pill placeholder="搜索人格…" value={search} onChange={(e) => onSearch(e.target.value)} className="w-full sm:w-72" />
        <select
          value={perspectiveType}
          onChange={(e) => setPerspectiveType(e.target.value)}
          className="h-11 w-full sm:w-auto bg-white border border-hairline rounded-full px-5 text-[14px] outline-none transition-colors hover:border-ink-48/60 focus:border-primary focus:ring-[3px] focus:ring-primary/15"
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-hairline bg-white p-3">
              <div className="flex gap-3">
                <div className="h-20 w-20 shrink-0 rounded-2xl bg-pearl animate-pulse" />
                <div className="min-w-0 flex-1 space-y-2 py-1">
                  <div className="h-5 w-4/5 rounded bg-pearl animate-pulse" />
                  <div className="h-3 w-2/5 rounded bg-pearl animate-pulse" />
                  <div className="h-3 w-full rounded bg-pearl animate-pulse" />
                  <div className="h-3 w-4/5 rounded bg-pearl animate-pulse" />
                </div>
              </div>
              <div className="mt-3 h-8 border-t border-divider-soft pt-3">
                <div className="h-3 w-1/3 rounded bg-pearl animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={UsersThree}
          title="人格库还是空的"
          description="点击右上角「+ 新增人格」，录入人格蒸馏产物，用于质询视角与一对一交流。"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {items.map((p, index) => (
            <button
              key={p.id}
              onClick={() => router.push(`/personas/${p.id}`)}
              aria-label={`与${p.name}交流`}
              className={`group overflow-hidden bg-white border border-hairline rounded-2xl p-3 flex flex-col text-left cursor-pointer transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_12px_28px_rgba(29,29,31,0.10)] focus-visible:ring-2 focus-visible:ring-primary/30 ${
                index < 4 ? "fl-rise" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 overflow-hidden rounded-2xl bg-canvas">
                  <Avatar
                    src={p.avatarValue ?? PERSONA_AVATARS[p.name]}
                    name={p.name}
                    size="xl"
                    className="h-20 w-20 rounded-2xl ring-0 shadow-none object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                </div>

                <div className="min-w-0 flex-1 py-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-[17px] font-semibold leading-[1.24]">{p.name}</div>
                      <div className="mt-1 text-[12px] font-medium text-primary">
                        {TYPE_LABEL[p.perspectiveType] ?? p.perspectiveType}
                      </div>
                    </div>
                    <ArrowRight
                      size={16}
                      weight="bold"
                      className="mt-0.5 shrink-0 text-ink-40 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </div>
                  {p.description && (
                    <div className="pt-2 text-[13px] text-ink-48 leading-[1.45] line-clamp-3">{p.description}</div>
                  )}
                </div>
              </div>

              <div className="mt-4 border-t border-divider-soft px-1 pt-3 pb-1 text-[13px] font-medium text-primary">
                与 TA 交流
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
