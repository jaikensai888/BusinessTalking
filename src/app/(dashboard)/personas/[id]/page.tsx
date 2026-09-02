"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileText, Files, FloppyDisk, SpinnerGap } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/personas/chat-panel";

interface PersonaDetail {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  perspectiveType: string;
  isBuiltin: boolean;
}
interface TocItem {
  key: string; // 'skill' 或 相对路径
  label: string;
  icon: React.ElementType;
}

const TYPE_LABEL: Record<string, string> = {
  investor: "风险投资人",
  customer: "挑剔客户",
  competitor: "竞争对手",
  economist: "奥派经济学家",
  entrepreneur: "连续创业者",
  analyst: "行业分析师",
  custom: "自定义",
};

/** 人格详情页：左内容编辑器 + 右目录（可查看/修改 skill 与参考文档），交流 Tab */
export default function PersonaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [tab, setTab] = useState<"详情" | "交流">("详情");
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [active, setActive] = useState<string>("skill");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const loadDoc = async (key: string) => {
    setActive(key);
    setLoadingDoc(true);
    setDirty(false);
    try {
      if (key === "skill") {
        const res = await fetch(`/api/v1/personas/${id}/skill`);
        const d = await res.json();
        setContent(d.code === 0 ? (d.data.skillMd ?? persona?.systemPrompt ?? "") : (d.message ?? "加载失败"));
      } else {
        const res = await fetch(`/api/v1/personas/${id}/skill/content?p=${encodeURIComponent(key)}`);
        const d = await res.json();
        setContent(d.code === 0 ? d.data.content : (d.message ?? "加载失败"));
      }
    } catch {
      setContent("加载失败");
    } finally {
      setLoadingDoc(false);
    }
  };

  useEffect(() => {
    fetch(`/api/v1/personas/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) setPersona(d.data);
        else setError(d.message ?? "加载失败");
      })
      .catch(() => setError("加载失败"));

    fetch(`/api/v1/personas/${id}/skill`)
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          const items: TocItem[] = [
            { key: "skill", label: "SKILL.md", icon: FileText },
            ...(d.data.refs ?? []).map((r: { rel: string }) => ({ key: r.rel, label: r.rel, icon: Files })),
          ];
          setToc(items);
          void loadDoc("skill");
        } else {
          setToc([{ key: "skill", label: "SKILL.md", icon: FileText }]);
          void loadDoc("skill");
        }
      })
      .catch(() => {
        setToc([{ key: "skill", label: "SKILL.md", icon: FileText }]);
        void loadDoc("skill");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, savedTick]);

  const saveDoc = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/personas/${id}/skill/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: active === "skill" ? "skill" : active, content }),
      });
      const d = await res.json();
      if (d.code === 0) {
        setDirty(false);
        setSavedTick((t) => t + 1);
      } else {
        setError(d.message ?? "保存失败");
      }
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const activeLabel = active === "skill" ? "SKILL.md" : active;
  const isSkill = active === "skill";

  if (error && !persona) {
    return (
      <div className="px-6 py-10 text-[14px] text-error">
        {error}
        <button className="ml-4 text-primary underline" onClick={() => router.push("/personas")}>
          返回人格库
        </button>
      </div>
    );
  }

  if (!persona) {
    return <div className="px-6 py-10 h-40 animate-pulse rounded-lg bg-pearl" />;
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* 头部 */}
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={persona.name} size="xl" />
        <div className="flex-1">
          <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.4px]">{persona.name}</h1>
          <div className="text-[14px] text-primary mt-1">
            {TYPE_LABEL[persona.perspectiveType] ?? persona.perspectiveType}
            {persona.isBuiltin && <span className="ml-2 text-ink-48">· 内置人物</span>}
          </div>
          {persona.description && <div className="text-[13px] text-ink-48 mt-1">{persona.description}</div>}
        </div>
        {!persona.isBuiltin && (
          <Button variant="secondary" onClick={() => router.push(`/personas/${persona.id}/edit`)}>
            编辑
          </Button>
        )}
      </div>

      {/* Tab */}
      <div className="mb-4 flex gap-1">
        {(["详情", "交流"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("rounded-full px-5 py-2 text-[14px] transition-colors", tab === t ? "bg-ink text-white" : "text-ink-48 hover:text-ink")}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "详情" ? (
        <div className="grid h-[600px] grid-cols-[240px_1fr] gap-4">
          {/* 右侧目录 */}
          <aside className="overflow-hidden rounded-2xl border border-hairline bg-white">
            <div className="border-b border-divider-soft px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-40">
              目录 · skill 结构
            </div>
            <nav className="h-[calc(100%-45px)] overflow-auto p-2">
              {toc.map((item) => {
                const on = active === item.key;
                const IconComponent = item.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => void loadDoc(item.key)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                      on ? "bg-primary/10 font-medium text-primary" : "text-ink-60 hover:bg-parchment"
                    )}
                    title={item.label}
                  >
                    <IconComponent size={14} className="shrink-0 text-ink-40" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* 左侧编辑器 */}
          <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-white">
            <div className="flex items-center gap-2 border-b border-divider-soft px-4 py-3">
              <FileText size={15} className="text-primary" />
              <span className="truncate text-[14px] font-semibold">{activeLabel}</span>
              <span className={cn("ml-auto text-[11px]", dirty ? "text-warning" : "text-ink-40")}>
                {dirty ? "已修改" : "只读浏览"}
              </span>
              <Button size="sm" variant="dark" onClick={saveDoc} disabled={saving || !dirty}>
                {saving ? <SpinnerGap size={13} className="animate-spin" /> : <FloppyDisk size={13} />} 保存
              </Button>
            </div>
            <textarea
              ref={editorRef}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              className="h-full min-h-0 w-full flex-1 resize-none p-4 text-[13px] leading-[1.7] font-mono text-ink outline-none focus:bg-pearl/40 focus:ring-4 focus:ring-primary/10"
            />
          </div>
        </div>
      ) : (
        <ChatPanel personaId={persona.id} personaName={persona.name} />
      )}

      {error && persona && <p className="mt-3 text-[13px] text-error">{error}</p>}
    </div>
  );
}
