"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

const TYPE_LABEL: Record<string, string> = {
  investor: "风险投资人",
  customer: "挑剔客户",
  competitor: "竞争对手",
  economist: "奥派经济学家",
  entrepreneur: "连续创业者",
  analyst: "行业分析师",
  custom: "自定义",
};

/** UX 4.5 人格详情/交流页（双 Tab） */
export default function PersonaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [tab, setTab] = useState<"详情" | "交流">("详情");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/personas/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) setPersona(d.data);
        else setError(d.message ?? "加载失败");
      })
      .catch(() => setError("加载失败"));
  }, [id]);

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
    return <div className="px-6 py-10 h-40 bg-pearl border border-hairline rounded-lg animate-pulse" />;
  }

  return (
    <div className="px-6 py-10 max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <Avatar name={persona.name} size="xl" />
        <div className="flex-1">
          <h1 className="text-[34px] font-semibold leading-[1.2] tracking-[-0.374px]">{persona.name}</h1>
          <div className="text-[14px] text-primary mt-1">
            {TYPE_LABEL[persona.perspectiveType] ?? persona.perspectiveType}
            {persona.isBuiltin && <span className="ml-2 text-ink-48">· 内置人格</span>}
          </div>
          {persona.description && <div className="text-[14px] text-ink-48 mt-1">{persona.description}</div>}
        </div>
        {!persona.isBuiltin && (
          <Button variant="secondary" onClick={() => router.push(`/personas/${persona.id}/edit`)}>
            编辑
          </Button>
        )}
      </div>

      <div className="flex gap-1 mb-4">
        {(["详情", "交流"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-5 py-2 text-[14px] transition-colors",
              tab === t ? "bg-ink text-white" : "text-ink-48 hover:text-ink"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "详情" ? (
        <div className="bg-white border border-hairline rounded-lg p-8">
          <h2 className="text-[14px] font-semibold text-ink-80 mb-3">系统提示词（人格蒸馏产物）</h2>
          <p className="text-[15px] leading-[1.6] whitespace-pre-wrap bg-parchment rounded-[8px] p-4">{persona.systemPrompt}</p>
        </div>
      ) : (
        <ChatPanel personaId={persona.id} personaName={persona.name} />
      )}
    </div>
  );
}
