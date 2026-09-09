"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "./avatar";
import { cn } from "@/lib/utils";

export interface MentionOption { id: string; name: string; detail?: string; }

export function useMentionNavigation(options: MentionOption[], open: boolean, onSelect: (option: MentionOption) => void, onClose: () => void) {
  const [selection, setSelection] = useState({ key: "", index: 0 });
  const key = open ? options.map((option) => option.id).join("|") : "";
  const activeIndex = selection.key === key ? Math.min(selection.index, Math.max(0, options.length - 1)) : 0;
  const activate = (index: number) => setSelection({ key, index });
  const close = () => { setSelection({ key: "", index: 0 }); onClose(); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === "Escape") { event.preventDefault(); close(); return true; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return false;
      event.preventDefault();
      activate((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      if (!options[activeIndex]) return false;
      event.preventDefault();
      onSelect(options[activeIndex]);
      return true;
    }
    return false;
  };
  return { activeIndex, activate, onKeyDown };
}

export function MentionList({ id, options, activeIndex, onActivate, onSelect }: {
  id: string; options: MentionOption[]; activeIndex: number;
  onActivate: (index: number) => void; onSelect: (option: MentionOption) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selectedRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);
  return <div className="overflow-hidden rounded-md border border-hairline bg-white shadow-float">
    <div id={id} role="listbox" aria-label="选择提及对象" className="max-h-60 overflow-y-auto overscroll-contain p-1">
      {!options.length && <p className="px-3 py-3 text-caption text-ink-48">没有匹配结果，试试其他名字</p>}
      {options.map((option, index) => <button key={option.id} id={`${id}-${index}`} type="button" role="option" aria-selected={index === activeIndex}
        ref={index === activeIndex ? selectedRef : undefined} onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => onActivate(index)} onClick={() => onSelect(option)}
        className={cn("flex min-h-10 w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-caption", index === activeIndex ? "bg-primary/10 text-primary" : "text-ink hover:bg-parchment")}>
        <Avatar name={option.name} size="sm" /><span className="min-w-0 flex-1 truncate">{option.name}</span>
        {option.detail && <span className="shrink-0 text-fine text-ink-48">{option.detail}</span>}
      </button>)}
    </div>
    <div className="border-t border-divider-soft px-3 py-1.5 text-fine text-ink-48">↑ ↓ 选择 · Enter 确认 · Esc 关闭</div>
  </div>;
}
