"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CATEGORIES = ["通用", "商业模式", "战略", "财务", "营销", "用户研究", "思维"];

export interface SkillFormData {
  name: string;
  category: string;
  description: string;
  instructions: string;
  inputSchema: string;
  outputSchema: string;
  tags: string;
}

/** UX 4.3 Skill 编辑表单 */
export function SkillForm({
  initial,
  skillId,
}: {
  initial?: Partial<SkillFormData> & { isBuiltin?: boolean };
  skillId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<SkillFormData>({
    name: initial?.name ?? "",
    category: initial?.category ?? "通用",
    description: initial?.description ?? "",
    instructions: initial?.instructions ?? "",
    inputSchema: initial?.inputSchema ?? "",
    outputSchema: initial?.outputSchema ?? "",
    tags: initial?.tags ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof SkillFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const parseJson = (s: string): unknown | undefined => {
    if (!s.trim()) return undefined;
    return JSON.parse(s); // 抛错由调用方捕获
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    let inputSchema: unknown = undefined;
    let outputSchema: unknown = undefined;
    try {
      inputSchema = parseJson(form.inputSchema);
      outputSchema = parseJson(form.outputSchema);
    } catch {
      setError("输入/输出 Schema 必须是合法 JSON");
      setSaving(false);
      return;
    }

    const payload = {
      name: form.name,
      category: form.category,
      description: form.description || undefined,
      instructions: form.instructions,
      inputSchema,
      outputSchema,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };

    try {
      const res = await fetch(skillId ? `/api/v1/skills/${skillId}` : "/api/v1/skills", {
        method: skillId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (d.code === 0) {
        router.push("/skills");
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
    <div className="bg-white border border-hairline rounded-lg p-8 max-w-3xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">名称 *</label>
          <Input value={form.name} onChange={set("name")} placeholder="如：商业模式诊断" />
        </div>
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">分类</label>
          <select
            value={form.category}
            onChange={set("category")}
            className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[17px] outline-none focus:border-primary"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
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
          placeholder="技能说明（列表展示用）"
          className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[17px] outline-none focus:border-primary resize-y"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-[14px] font-semibold text-ink-80">指令内容 *（将注入 LLM，支持 Markdown）</label>
        <textarea
          value={form.instructions}
          onChange={set("instructions")}
          rows={8}
          placeholder="完整指令…"
          className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[17px] font-mono outline-none focus:border-primary resize-y"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">输入 Schema（JSON，可空）</label>
          <textarea
            value={form.inputSchema}
            onChange={set("inputSchema")}
            rows={6}
            placeholder='{"type":"object","properties":{}}'
            className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[14px] font-mono outline-none focus:border-primary resize-y"
          />
        </div>
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">输出 Schema（JSON，可空）</label>
          <textarea
            value={form.outputSchema}
            onChange={set("outputSchema")}
            rows={6}
            placeholder='{"type":"object","properties":{}}'
            className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[14px] font-mono outline-none focus:border-primary resize-y"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <label className="text-[14px] font-semibold text-ink-80">标签（逗号分隔）</label>
        <Input value={form.tags} onChange={set("tags")} placeholder="财务, 测算" />
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
