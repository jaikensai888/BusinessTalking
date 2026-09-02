"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Plus, Scroll, UsersThree, X } from "@phosphor-icons/react";

/** 悬浮快捷动作：+ 展开"新建配方 / 导入 Skill / 与人格对话" */
export function FloatingAction() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const items = [
    { label: "新建配方", icon: Scroll, href: "/recipes/new" },
    { label: "导入 Skill", icon: Database, href: "/skills" },
    { label: "与人格对话", icon: UsersThree, href: "/personas" },
  ];

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="fl-rise flex flex-col gap-1 rounded-2xl border border-hairline bg-white p-2 shadow-[0_16px_48px_rgba(0,0,0,0.18)]">
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => {
                setOpen(false);
                router.push(it.href);
              }}
              className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-[14px] text-ink transition-colors hover:bg-parchment"
            >
              <it.icon size={18} weight="duotone" />
              {it.label}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "关闭快捷操作" : "打开快捷操作"}
        title="快捷操作"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-[0_12px_32px_rgba(0,0,0,0.28)] transition-transform duration-200 hover:scale-105 active:scale-95"
      >
        {open ? <X size={22} weight="bold" /> : <Plus size={22} weight="bold" />}
      </button>
    </div>
  );
}
