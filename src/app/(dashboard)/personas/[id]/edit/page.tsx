"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PersonaForm } from "@/components/personas/persona-form";

export default function EditPersonaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/personas/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          setInitial({
            name: d.data.name,
            description: d.data.description ?? "",
            systemPrompt: d.data.systemPrompt,
            perspectiveType: d.data.perspectiveType,
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
        <button className="ml-4 text-primary underline" onClick={() => router.push("/personas")}>
          返回人格库
        </button>
      </div>
    );
  }

  return (
    <div className="px-6 py-10">
      <h1 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px] mb-6">编辑人格</h1>
      {initial === null ? (
        <div className="h-40 bg-pearl border border-hairline rounded-lg animate-pulse" />
      ) : initial.isBuiltin ? (
        <div className="text-[14px] text-ink-48">内置人格不可编辑。</div>
      ) : (
        <PersonaForm
          personaId={id}
          initial={{
            name: String(initial.name ?? ""),
            description: String(initial.description ?? ""),
            systemPrompt: String(initial.systemPrompt ?? ""),
            perspectiveType: String(initial.perspectiveType ?? "custom"),
            tags: String(initial.tags ?? ""),
          }}
        />
      )}
    </div>
  );
}
