"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";

interface SkillOption {
  id: string;
  name: string;
  category: string;
  outputSchema: unknown;
}

interface PersonaOption {
  id: string;
  name: string;
  perspectiveType: string;
}

interface StepDraft {
  skillId: string;
  personaId: string;
}

interface RecipeDetail {
  id: string;
  name: string;
  description: string | null;
  version: string;
  steps: { id: string; position: number; skill: SkillOption; persona: PersonaOption | null }[];
}

/** UX 4.7 配方编辑器：步骤卡片 + skill/人格选择 + 顺序调整 */
export function RecipeEditor({ recipeId }: { recipeId?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!recipeId);

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/skills?page_size=100").then((r) => r.json()),
      fetch("/api/v1/personas?page_size=100").then((r) => r.json()),
    ]).then(([sk, pe]) => {
      if (sk.code === 0) setSkills(sk.data.items);
      if (pe.code === 0) setPersonas(pe.data.items);
    });

    if (recipeId) {
      fetch(`/api/v1/recipes/${recipeId}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.code === 0) {
            const r: RecipeDetail = d.data;
            setName(r.name);
            setDescription(r.description ?? "");
            setSteps(r.steps.map((s) => ({ skillId: s.skill.id, personaId: s.persona?.id ?? "" })));
          } else {
            setError(d.message ?? "加载失败");
          }
        })
        .finally(() => setLoaded(true));
    }
  }, [recipeId]);

  const addStep = () => setSteps((prev) => [...prev, { skillId: "", personaId: "" }]);
  const moveStep = (index: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const removeStep = (index: number) => {
    if (!window.confirm("确认删除该步骤？")) return;
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };
  const setStep = (index: number, key: keyof StepDraft, value: string) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [key]: value } : s)));

  const save = async (redirectToWorkspace = false): Promise<string | null> => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name,
        description: description || undefined,
        steps: steps.map((s) => ({
          skillId: s.skillId,
          personaId: s.personaId || undefined,
        })),
      };
      const res = await fetch(recipeId ? `/api/v1/recipes/${recipeId}` : "/api/v1/recipes", {
        method: recipeId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (d.code !== 0) {
        setError(d.message ?? "保存失败");
        return null;
      }
      const id = recipeId ?? d.data.id;
      if (redirectToWorkspace) {
        router.push(`/?recipe=${id}`);
      } else {
        router.push("/recipes");
      }
      return id;
    } catch {
      setError("保存失败");
      return null;
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <div className="h-64 bg-pearl border border-hairline rounded-lg animate-pulse" />;
  }

  return (
    <div className="bg-white border border-hairline rounded-lg p-8 max-w-3xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">配方名称 *</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：新项目可行性分析" />
        </div>
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">描述</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="配方用途" />
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <label className="text-[14px] font-semibold text-ink-80">步骤列表（{steps.length}）</label>
          <Button variant="pearl" onClick={addStep}>
            + 添加步骤
          </Button>
        </div>

        {steps.length === 0 ? (
          <div className="bg-pearl border border-hairline rounded-lg p-10 text-center text-ink-48 text-[14px]">
            还没有步骤。点击「+ 添加步骤」，选择 skill 开始编排。
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={i} className="bg-pearl border border-hairline rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-ink-80">
                    步骤 {i + 1}
                    {step.personaId && <span className="ml-2 text-primary text-[12px]">含人格视角</span>}
                  </span>
                  <div className="flex items-center gap-1">
                    <button className="px-2 py-1 text-[14px] hover:bg-parchment rounded" onClick={() => moveStep(i, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button
                      className="px-2 py-1 text-[14px] hover:bg-parchment rounded"
                      onClick={() => moveStep(i, 1)}
                      disabled={i === steps.length - 1}
                    >
                      ↓
                    </button>
                    <button className="px-2 py-1 text-[14px] text-error hover:bg-parchment rounded" onClick={() => removeStep(i)}>
                      删除
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1">
                    <label className="text-[12px] text-ink-48">Skill（必选）</label>
                    <select
                      value={step.skillId}
                      onChange={(e) => setStep(i, "skillId", e.target.value)}
                      className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[15px] outline-none focus:border-primary"
                    >
                      <option value="">选择 skill…</option>
                      {skills.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}（{s.category}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <label className="text-[12px] text-ink-48">人格视角（可选）</label>
                    <select
                      value={step.personaId}
                      onChange={(e) => setStep(i, "personaId", e.target.value)}
                      className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[15px] outline-none focus:border-primary"
                    >
                      <option value="">无</option>
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {step.skillId && (
                  <div className="text-[12px] text-ink-48">
                    输入：上一步输出 / 商业想法 · 输出：
                    {(() => {
                      const s = skills.find((x) => x.id === step.skillId);
                      return s?.outputSchema
                        ? Object.keys((s.outputSchema as { properties?: Record<string, unknown> }).properties ?? {}).join(", ") || "结构化结果"
                        : "结构化结果";
                    })()}
                  </div>
                )}
                {step.personaId && (
                  <div className="flex items-center gap-2 text-[12px] text-ink-48">
                    <Avatar name={personas.find((p) => p.id === step.personaId)?.name ?? ""} size="sm" />
                    本步骤将由该人格视角质询
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-[14px] text-error">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>
          取消
        </Button>
        <Button variant="dark" onClick={() => save(false)} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
        <Button onClick={() => save(true)} disabled={saving || steps.length === 0}>
          保存并运行
        </Button>
      </div>
    </div>
  );
}
