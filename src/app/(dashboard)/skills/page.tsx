"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Database } from "@phosphor-icons/react";
import { SkillCard, type SkillItem } from "@/components/skills/skill-card";
import { ImportDialog } from "@/components/skills/import-dialog";

const CATEGORIES = ["通用", "商业模式", "战略", "财务", "营销", "用户研究", "思维"];

export default function SkillsPage() {
  const router = useRouter();
  const [items, setItems] = useState<SkillItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (q = search, cat = category, pg = page) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q) params.set("search", q);
        if (cat) params.set("category", cat);
        params.set("page", String(pg));
        params.set("page_size", String(pageSize));
        const res = await fetch(`/api/v1/skills?${params.toString()}`);
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
    },
    [pageSize]
  );

  useEffect(() => {
    // 初始加载/筛选变化时拉取数据（异步，非同步 setState）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, category]);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      load(v, category, 1);
    }, 300);
  };

  const removeSkill = async (id: string) => {
    if (!window.confirm("确认删除该 skill？")) return;
    const res = await fetch(`/api/v1/skills/${id}`, { method: "DELETE" });
    const d = await res.json();
    if (d.code === 0) {
      load();
    } else {
      window.alert(d.message ?? "删除失败");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="px-6 py-10">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px]">Skill 库</h1>
          <p className="text-ink-48 text-[14px] mt-1">共 {total} 个技能 · 支持手动新增与 npx 命令导入</p>
        </div>
        <div className="flex gap-2">
          <Button variant="dark" onClick={() => setImportOpen(true)}>
            通过 npx 导入
          </Button>
          <Button onClick={() => router.push("/skills/new")}>+ 新增</Button>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <Input
          pill
          placeholder="搜索名称/描述…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-72"
        />
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
          className="bg-white border border-hairline rounded-full h-11 px-5 text-[14px] outline-none focus:border-primary"
        >
          <option value="">全部分类</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 bg-white border-l-[3px] border-error rounded-lg p-4 text-[14px] text-ink-80">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 bg-pearl border border-hairline rounded-lg animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Database}
          title="Skill 库还是空的"
          description="点击右上角「+ 新增」手动录入，或通过「npx 导入」从网络生态一键收录分析技能。"
          action={
            <Button variant="dark" onClick={() => setImportOpen(true)}>
              通过 npx 导入
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onEdit={(id) => router.push(`/skills/${id}/edit`)}
              onDelete={removeSkill}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span className="px-4 self-center text-[14px] text-ink-48">
            {page} / {totalPages}
          </span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      )}

      {importOpen && (
        <ImportDialog onClose={() => setImportOpen(false)} onImported={() => load()} />
      )}
    </div>
  );
}
