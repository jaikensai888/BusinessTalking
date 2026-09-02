"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";

const PERSPECTIVES = [
  { value: "investor", label: "风险投资人" },
  { value: "customer", label: "挑剔客户" },
  { value: "competitor", label: "竞争对手" },
  { value: "economist", label: "奥派经济学家" },
  { value: "entrepreneur", label: "连续创业者" },
  { value: "analyst", label: "行业分析师" },
  { value: "custom", label: "自定义" },
];

export interface PersonaFormData {
  name: string;
  description: string;
  systemPrompt: string;
  perspectiveType: string;
  tags: string;
}

/** UX 4.6 人格编辑表单 */
export function PersonaForm({
  initial,
  personaId,
}: {
  initial?: Partial<PersonaFormData> & { isBuiltin?: boolean };
  personaId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<PersonaFormData>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    systemPrompt: initial?.systemPrompt ?? "",
    perspectiveType: initial?.perspectiveType ?? "custom",
    tags: initial?.tags ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof PersonaFormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(personaId ? `/api/v1/personas/${personaId}` : "/api/v1/personas", {
        method: personaId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          systemPrompt: form.systemPrompt,
          perspectiveType: form.perspectiveType,
          tags: form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const d = await res.json();
      if (d.code === 0) {
        router.push(personaId ? `/personas/${personaId}` : "/personas");
      } else {
        setError(d.message ?? "保存失败");
      }
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-hairline rounded-lg p-8 max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Avatar name={form.name || "?"} size="lg" />
        <p className="text-[12px] text-ink-48">头像按名称自动生成（DESIGN.md 7.6）</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">名称 *</label>
          <Input value={form.name} onChange={set("name")} placeholder="如：风险投资人" />
        </div>
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">视角类型</label>
          <select
            value={form.perspectiveType}
            onChange={set("perspectiveType")}
            className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[17px] outline-none focus:border-primary"
          >
            {PERSPECTIVES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-2">
        <label className="text-[14px] font-semibold text-ink-80">描述</label>
        <textarea
          value={form.description}
          onChange={set("description")}
          rows={2}
          className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[17px] outline-none focus:border-primary resize-y"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-[14px] font-semibold text-ink-80">系统提示词 *（人格蒸馏产物，用于交流与质询）</label>
        <textarea
          value={form.systemPrompt}
          onChange={set("systemPrompt")}
          rows={8}
          className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[17px] leading-[1.5] outline-none focus:border-primary resize-y"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-[14px] font-semibold text-ink-80">标签（逗号分隔）</label>
        <Input value={form.tags} onChange={set("tags")} placeholder="质询, 尖锐" />
      </div>

      {error && <p className="text-[14px] text-error">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>
          取消
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}
