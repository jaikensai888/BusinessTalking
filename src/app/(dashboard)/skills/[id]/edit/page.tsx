"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SkillForm } from "@/components/skills/skill-form";

export default function EditSkillPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/skills/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          setInitial({
            name: d.data.name,
            category: d.data.category,
            description: d.data.description ?? "",
            instructions: d.data.instructions,
            inputSchema: d.data.inputSchema ? JSON.stringify(d.data.inputSchema, null, 2) : "",
            outputSchema: d.data.outputSchema ? JSON.stringify(d.data.outputSchema, null, 2) : "",
            tags: Array.isArray(d.data.tags) ? d.data.tags.join(", ") : "",
            isBuiltin: d.data.isBuiltin,
          });
        } else {
          setError(d.message ?? "加载失败");
        }
      })
      .catch(() => setError("加载失败"));
  }, [id]);

  if (error) {
    return (
      <div className="px-6 py-10 text-[14px] text-error">
        {error}
        <button className="ml-4 text-primary underline" onClick={() => router.push("/skills")}>
          返回 Skill 库
        </button>
      </div>
    );
  }

  return (
    <div className="px-6 py-10">
      <h1 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px] mb-6">编辑 Skill</h1>
      {initial === null ? (
        <div className="h-40 bg-pearl border border-hairline rounded-lg animate-pulse" />
      ) : initial.isBuiltin ? (
        <div className="text-[14px] text-ink-48">内置 skill 不可编辑。</div>
      ) : (
        <SkillForm
          skillId={id}
          initial={{
            name: String(initial.name ?? ""),
            category: String(initial.category ?? "通用"),
            description: String(initial.description ?? ""),
            instructions: String(initial.instructions ?? ""),
            inputSchema: String(initial.inputSchema ?? ""),
            outputSchema: String(initial.outputSchema ?? ""),
            tags: String(initial.tags ?? ""),
          }}
        />
      )}
    </div>
  );
}
