"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUp,
  CaretDown,
  DownloadSimple,
  FilePdf,
  Plus,
  SpinnerGap,
  TagSimple,
  type Icon,
} from "@phosphor-icons/react";
import { Avatar } from "@/components/ui/avatar";
import { SpacesCards } from "@/components/workspace/spaces-cards";
import { FloatingAction } from "@/components/workspace/floating-action";
import { cn } from "@/lib/utils";

interface RecipeOption {
  id: string;
  name: string;
  stepCount: number;
}
interface PersonaOption {
  id: string;
  name: string;
  perspectiveType: string;
}

function greet(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 12) return "早上好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 卡片形式 chips（参考工作台：图标 + 标签 + 可选下拉箭头） */
function Chip({
  icon: IconComponent,
  label,
  caret,
  onClick,
}: {
  icon: Icon;
  label: string;
  caret?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-2 text-[13px] text-ink-60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-primary/40 hover:text-ink"
    >
      <IconComponent size={15} weight="duotone" />
      {label}
      {caret && <CaretDown size={11} weight="bold" />}
    </button>
  );
}

/**
 * UX 4.1 工作台（活化·输入一体）：巨型输入控件内嵌属性 chips（卡片形式）与发送按钮，
 * 保持 Apple 克制风：单一 Action Blue / 无 emoji / 无紫色
 */
export default function WorkspacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [text, setText] = useState("");
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [recipeDropdown, setRecipeDropdown] = useState(false);
  const [personaDropdown, setPersonaDropdown] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachment, setAttachment] = useState<{ filename: string; text: string; charCount: number; truncated: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const MAX_UPLOAD_MB = 20;

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/recipes?page_size=100").then((r) => r.json()),
      fetch("/api/v1/personas?page_size=100").then((r) => r.json()),
    ]).then(([rc, pe]) => {
      if (rc.code === 0) setRecipes(rc.data.items);
      if (pe.code === 0) setPersonas(pe.data.items);
    });

    const recipeId = searchParams.get("recipe");
    if (recipeId) {
      fetch(`/api/v1/recipes/${recipeId}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.code === 0) {
            setSelectedRecipeId(d.data.id);
            setText(`@${d.data.name} `);
          }
        })
        .catch(() => undefined);
    }
  }, [searchParams]);

  const q = mentionQuery.trim();
  const filteredRecipes = q ? recipes.filter((r) => r.name.includes(q)) : recipes;
  const filteredPersonas = q ? personas.filter((p) => p.name.includes(q)) : personas;

  /**
   * 判断输入框当前是否正在输入 @提及，并提取查询词。
   * 基于文本末尾的 @token（无空格）而非光标位置——兼容中文 IME 组合输入（组合期间光标不可靠）。
   */
  const handleBeforeInput = (value: string) => {
    const m = value.match(/@([^\s@]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  };

  /** 仅替换文本末尾正在输入的 @token；若末尾无 @token 则追加。保留已在文本中的其他人格/配方 */
  const replaceActiveMention = (insert: string) => {
    const m = text.match(/@[^\s@]*$/);
    return m ? `${text.slice(0, m.index)}${insert}` : `${text} ${insert}`.trimStart();
  };

  const setPersona = (p: PersonaOption) => {
    setMentionOpen(false);
    setText(replaceActiveMention(`@${p.name} `));
    inputRef.current?.focus();
  };

  const setRecipe = (recipe: RecipeOption) => {
    setSelectedRecipeId(recipe.id);
    setRecipeDropdown(false);
    setMentionOpen(false);
    setText(replaceActiveMention(`@${recipe.name} `));
    inputRef.current?.focus();
  };

  /** 上传并读取文件文本（pdf/txt 等） */
  const onFile = async (file: File) => {
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`文件过大（上限 ${MAX_UPLOAD_MB}MB）`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/v1/extract", { method: "POST", body: fd });
      const d = await res.json();
      if (d.code === 0) {
        setAttachment({ filename: file.name, ...d.data });
      } else {
        setError(d.message ?? "读取文件失败");
      }
    } catch {
      setError("读取文件失败");
    } finally {
      setUploading(false);
    }
  };

  const onDropFile = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void onFile(file);
  };

  /** 提交给引擎的输入 = 输入想法 + 上传资料文本 */
  const buildIdeaInput = () => {
    const idea = text.replace(/@[^\s@]*/g, "").trim();
    if (!attachment) return idea;
    const note = attachment.truncated ? "（已截取前部分）" : "";
    return `${idea}\n\n【上传资料：${attachment.filename}】（已读取 ${attachment.charCount} 字${note}）\n${attachment.text}`;
  };

  const startRun = async (recipeId: string) => {
    setRunning(true);
    setError(null);
    try {
      const ideaInput = buildIdeaInput();
      if (!ideaInput.trim()) {
        setError("请先输入你的商业想法或上传资料");
        setRunning(false);
        return;
      }
      const res = await fetch("/api/v1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId, ideaInput }),
      });
      const d = await res.json();
      if (d.code === 0) {
        setText("");
        setSelectedRecipeId(null);
        setAttachment(null);
        setRefreshKey((k) => k + 1);
      } else {
        setError(d.message ?? "启动失败");
      }
    } catch {
      setError("启动失败");
    } finally {
      setRunning(false);
      setPickerOpen(false);
    }
  };

  /** 开启多人讨论（工作台 @ 多个人格） */
  const startDiscussion = async (personaIds: string[]) => {
    setRunning(true);
    setError(null);
    try {
      const brief = buildIdeaInput();
      if (!brief.trim()) {
        setError("请先输入讨论主题");
        setRunning(false);
        return;
      }
      const res = await fetch("/api/v1/discussions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, personaIds, rounds: 5 }),
      });
      const d = await res.json();
      if (d.code === 0) {
        setText("");
        setSelectedRecipeId(null);
        setAttachment(null);
        setRefreshKey((k) => k + 1);
      } else {
        setError(d.message ?? "创建讨论失败");
      }
    } catch {
      setError("创建讨论失败");
    } finally {
      setRunning(false);
      setPickerOpen(false);
    }
  };

  const submit = () => {
    const idea = text.replace(/@[^\s@]*/g, "").trim();
    const tokens = Array.from(text.matchAll(/@([^\s@]+)/g)).map((m) => m[1].trim()).filter(Boolean);
    const matchedPersonas = personas.filter((p) => tokens.some((t) => p.name.includes(t) || t.includes(p.name)));
    const matchedRecipe = recipes.find((r) => tokens.some((t) => r.name.includes(t) || t.includes(r.name)));
    if (!idea && !attachment) {
      setError("请先输入你的商业想法或上传资料");
      inputRef.current?.focus();
      return;
    }
    if (matchedPersonas.length >= 2) {
      startDiscussion(matchedPersonas.map((p) => p.id));
      return;
    }
    if (matchedRecipe) {
      startRun(matchedRecipe.id);
      return;
    }
    if (matchedPersonas.length === 1) {
      setError("讨论需要至少 2 个人格，再 @ 一位吧；或 @ 配方 开始分析");
      return;
    }
    if (selectedRecipeId) {
      startRun(selectedRecipeId);
      return;
    }
    setPickerOpen(true);
  };

  return (
    <div className="min-h-full">
      {/* hero：浅色统一（页面底色即画布，无深色卡片） */}
      <section className="mx-auto max-w-[1400px] px-6 pt-14 pb-2">
        <div className="fl-rise mx-auto flex max-w-2xl flex-col items-center gap-6">
          <div className="text-center">
            <p className="text-[13px] font-medium tracking-[0.02em] text-primary/80">BusinessTalking</p>
            <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-[-0.4px] text-ink md:text-[34px]">
              {greet()}，分析官！
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-[1.6] text-ink-48">
              描述你的商业想法，一键产出带多视角质询的可行性报告。
            </p>
          </div>

          {/* 输入一体控件：textarea + 内嵌 chips + 发送按钮（支持拖拽/上传文件） */}
          <div
            className="relative w-full"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDropFile}
          >
            <div
              className={cn(
                "rounded-2xl border border-hairline bg-white p-2 shadow-[0_8px_30px_rgba(0,0,0,0.05)] transition-all",
                dragOver && "ring-4 ring-primary/40"
              )}
            >
              <textarea
                ref={inputRef}
                value={text}
                rows={4}
                placeholder="输入你的商业想法，例如：面向独立开发者的 AI 定价分析工具，订阅制，月费 49 元…"
                onChange={(e) => {
                  setText(e.target.value);
                  handleBeforeInput(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setMentionOpen(false);
                    setRecipeDropdown(false);
                    setPersonaDropdown(false);
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                className="w-full resize-none rounded-t-xl bg-transparent px-3.5 pt-3 text-[16px] leading-[1.6] text-ink outline-none placeholder:text-ink-40"
              />

              {/* 附件指示条 */}
              {attachment && (
                <div className="mx-1.5 mt-1 flex items-center gap-2 rounded-lg bg-parchment px-3 py-1.5 text-[13px] text-ink-60">
                  <FilePdf size={15} className="shrink-0 text-error" />
                  <span className="truncate">{attachment.filename}</span>
                  <span className="shrink-0 text-[11px] text-ink-40">
                    已读取 {attachment.charCount} 字{attachment.truncated ? "（截取）" : ""}
                  </span>
                  <button onClick={() => setAttachment(null)} aria-label="移除资料" title="移除资料" className="ml-auto shrink-0 text-ink-40 transition-colors hover:text-ink">
                    ✕
                  </button>
                </div>
              )}

              <div className="mt-1 flex items-center gap-2 rounded-b-xl bg-parchment/70 px-2 py-2">
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  {/* 上传文件 = 加号 */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="上传文件"
                    title="上传文件"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-white text-ink-60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-primary/40 hover:text-ink"
                  >
                    {uploading ? <SpinnerGap size={16} className="animate-spin" /> : <Plus size={16} weight="bold" />}
                  </button>
                  <Chip icon={TagSimple} label="选配方" caret onClick={() => setRecipeDropdown((o) => !o)} />
                  <Chip icon={SpinnerGap} label="人格视角" caret onClick={() => setPersonaDropdown((o) => !o)} />
                  <Chip icon={DownloadSimple} label="导入 Skill" onClick={() => router.push("/skills")} />
                  <Chip icon={Plus} label="新建配方" onClick={() => router.push("/recipes/new")} />
                </div>
                {/* 发送按钮与输入控件一体 */}
                <button
                  onClick={submit}
                  disabled={running}
                  aria-label="开始分析"
                  title="开始分析"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-[0_4px_14px_rgba(0,0,0,0.22)] transition-all duration-150 hover:bg-[#0077e6] active:scale-95 disabled:opacity-45"
                >
                  {running ? <SpinnerGap size={20} className="animate-spin" /> : <ArrowUp size={20} weight="bold" />}
                </button>
              </div>
            </div>

            {/* @ 配方 联想（输入时） */}
            {mentionOpen && !recipeDropdown && (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-hairline bg-white text-ink shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
                <div className="max-h-60 overflow-auto py-1">
                  {filteredRecipes.length === 0 && filteredPersonas.length === 0 ? (
                    <div className="px-4 py-3 text-[13px] text-ink-48">没有匹配的配方或人格</div>
                  ) : (
                    <>
                      {filteredPersonas.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setPersona(p)}
                          className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] hover:bg-parchment"
                        >
                          <Avatar name={p.name} size="sm" />
                          <span>{p.name}</span>
                          <span className="ml-auto text-[12px] text-ink-40">人物 · 讨论</span>
                        </button>
                      ))}
                      {filteredRecipes.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setRecipe(r)}
                          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[14px] hover:bg-parchment"
                        >
                          <span className="flex items-center gap-2">
                            <TagSimple size={14} className="text-ink-40" />
                            {r.name}
                          </span>
                          <span className="text-[12px] text-ink-40">{r.stepCount} 步</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 选配方 下拉（chips 触发） */}
            {recipeDropdown && (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-hairline bg-white text-ink shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
                <div className="max-h-60 overflow-auto py-1">
                  {recipes.length === 0 ? (
                    <div className="px-4 py-3 text-[13px] text-ink-48">还没有配方，请先新建配方</div>
                  ) : (
                    recipes.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setRecipe(r)}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[14px] hover:bg-parchment"
                      >
                        <span>{r.name}</span>
                        <span className="text-[12px] text-ink-40">{r.stepCount} 步</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* 人格视角 下拉（chips 触发） */}
            {personaDropdown && (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-hairline bg-white text-ink shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
                <div className="max-h-60 overflow-auto py-1.5">
                  {personas.length === 0 ? (
                    <div className="px-4 py-3 text-[13px] text-ink-48">还没有人格，请先新增</div>
                  ) : (
                    personas.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPersonaDropdown(false);
                          router.push(`/personas/${p.id}`);
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] hover:bg-parchment"
                      >
                        <Avatar name={p.name} size="sm" />
                        <span>{p.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <p className="text-center text-[13px] text-ink-40">可拖拽或上传 PDF / TXT / MD，内容将作为分析资料</p>

          {error && <p className="text-[14px] text-error">{error}</p>}
        </div>
      </section>

      {/* 分析工作区：竖版卡片流（≥3 列） */}
      <section className="mx-auto max-w-[1440px] px-6 py-10">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[19px] font-semibold tracking-[-0.2px]">会话空间</h2>
          <button
            className="text-[13px] text-primary transition-colors hover:text-[#0077e6] hover:underline"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            全部空间 ›
          </button>
        </div>
        <SpacesCards refreshKey={refreshKey} onNew={submit} />
      </section>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
          <div className="fl-rise w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            <h3 className="mb-4 text-[18px] font-semibold tracking-[-0.2px]">选择分析配方</h3>
            <div className="mb-4 max-h-64 space-y-2 overflow-auto">
              {recipes.length === 0 ? (
                <p className="text-[14px] text-ink-48">还没有配方，请先在「配方」页创建。</p>
              ) : (
                recipes.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => startRun(r.id)}
                    className="flex w-full items-center justify-between rounded-xl border border-hairline bg-pearl px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-parchment"
                  >
                    <span className="text-[14px] font-medium">{r.name}</span>
                    <span className="text-[12px] text-ink-40">{r.stepCount} 个步骤</span>
                  </button>
                ))
              )}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setPickerOpen(false)}
                className="rounded-full border border-primary/50 px-5 py-2.5 text-[15px] text-primary transition-colors hover:bg-primary/5"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 隐藏文件输入（上传文件 chip 触发） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md,.markdown,.csv,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />

      <FloatingAction />
    </div>
  );
}
