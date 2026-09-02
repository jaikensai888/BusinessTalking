"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface SkillItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  source: string;
  sourceRef: string | null;
  isBuiltin: boolean;
  version: string;
  tags: unknown;
  createdAt: string;
  updatedAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  builtin: "内置",
  npx: "npx",
  manual: "自建",
};

/** UX 4.2 Skill 卡片（DESIGN.md store-utility-card：白底 hairline lg 圆角，无阴影） */
export function SkillCard({
  skill,
  onEdit,
  onDelete,
}: {
  skill: SkillItem;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const source = skill.source ?? "manual";
  const tags: string[] = Array.isArray(skill.tags) ? skill.tags.map(String) : [];

  return (
    <div className="bg-white border border-hairline rounded-lg p-6 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[17px] font-semibold leading-[1.24] tracking-[-0.374px]">{skill.name}</h3>
        <Badge variant={source === "npx" ? "primary" : "neutral"}>{SOURCE_LABEL[source] ?? source}</Badge>
      </div>

      {skill.description && (
        <p className="text-[14px] text-ink-48 leading-[1.43] line-clamp-2">{skill.description}</p>
      )}

      <div className="flex items-center gap-2 text-[12px] text-ink-48">
        <span className="bg-parchment rounded-[6px] px-2 py-0.5">{skill.category}</span>
        {tags.slice(0, 3).map((t) => (
          <span key={t} className="bg-parchment rounded-[6px] px-2 py-0.5">
            {t}
          </span>
        ))}
      </div>

      {!skill.isBuiltin && (
        <div className="mt-auto pt-2 flex gap-3">
          {onEdit && (
            <Button variant="ghost" onClick={() => onEdit(skill.id)}>
              编辑
            </Button>
          )}
          {onDelete && (
            <Button variant="danger" onClick={() => onDelete(skill.id)}>
              删除
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
