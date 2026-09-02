"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CaretDown, FileText, Files, SpinnerGap } from "@phosphor-icons/react";
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
  avatarType: string;
  avatarValue: string | null;
  isBuiltin: boolean;
}
interface SkillInfo {
  skillMd: string | null;
  refs: { name: string; rel: string }[];
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

/** 人格详情页：头部 + 详情(SKILL.md + 参考资料) / 交流 双 Tab */
export default function PersonaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [tab, setTab] = useState<"详情" | "交流">("详情");
  const [error, setError] = useState<string | null>(null);
  const [skill, setSkill] = useState<SkillInfo | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [refContent, setRefContent] = useState<string | null>(null);
  const [loadingRef, setLoadingRef] = useState<string | null>(null);

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
        if (d.code === 0) setSkill({ skillMd: d.data.skillMd, refs: d.data.refs ?? [] });
      })
      .catch(() => undefined);
  }, [id]);

  const toggleRef = async (rel: string) => {
    if (openRef === rel) {
      setOpenRef(null);
      setRefContent(null);
      return;
    }
    setOpenRef(rel);
    setLoadingRef(rel);
    setRefContent(null);
    try {
      const res = await fetch(`/api/v1/personas/${id}/skill/content?p=${encodeURIComponent(rel)}`);
      const d = await res.json();
      setRefContent(d.code === 0 ? d.data.content : (d.message ?? "加载失败"));
    } catch {
      setRefContent("加载失败");
    } finally {
      setLoadingRef(null);
    }
  };

  if (error) {
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
    <div className="mx-auto max-w-4xl px-6 py-10">
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
        <div className="space-y-5">
          {/* 人物 Skill · SKILL.md */}
          <div className="rounded-2xl border border-hairline bg-white">
            <div className="flex items-center gap-2 border-b border-divider-soft px-6 py-3.5">
              <FileText size={16} className="text-primary" />
              <h2 className="text-[15px] font-semibold">人物 Skill（SKILL.md）</h2>
              <span className="ml-auto text-[11px] text-ink-40">{skill?.skillMd ? `${(skill.skillMd.length / 1000).toFixed(1)}k 字符` : "—"}</span>
            </div>
            <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words p-6 text-[13px] leading-[1.7] font-mono text-ink-80">
              {skill?.skillMd ?? persona.systemPrompt}
            </pre>
          </div>

          {/* 参考资料 */}
          <div className="rounded-2xl border border-hairline bg-white">
            <div className="flex items-center gap-2 border-b border-divider-soft px-6 py-3.5">
              <Files size={16} className="text-primary" />
              <h2 className="text-[15px] font-semibold">参考资料（references）</h2>
              <span className="ml-auto text-[11px] text-ink-40">{skill?.refs?.length ?? 0} 篇</span>
            </div>
            <div>
              {!skill || skill.refs.length === 0 ? (
                <p className="px-6 py-6 text-[13px] text-ink-48">该人物暂未附参考调研文档。</p>
              ) : (
                skill.refs.map((r) => (
                  <div key={r.rel} className="border-b border-divider-soft last:border-0">
                    <button
                      onClick={() => toggleRef(r.rel)}
                      className="flex w-full items-center gap-2 px-6 py-3 text-left text-[14px] hover:bg-parchment"
                    >
                      <CaretDown size={13} className={cn("text-ink-40 transition-transform", openRef === r.rel && "rotate-180")} />
                      <span className="font-medium">{r.rel}</span>
                    </button>
                    {openRef === r.rel && (
                      <div className="px-6 pb-4">
                        {loadingRef === r.rel ? (
                          <div className="flex items-center gap-2 py-4 text-[13px] text-ink-40">
                            <SpinnerGap size={15} className="animate-spin" /> 加载中…
                          </div>
                        ) : (
                          <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-parchment p-4 text-[12px] leading-[1.7] font-mono text-ink">
                            {refContent}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <ChatPanel personaId={persona.id} personaName={persona.name} />
      )}
    </div>
  );
}
