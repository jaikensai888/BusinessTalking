"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ChatCircleDots, FilePdf, FileText, PaperPlaneTilt, Plus, SpinnerGap, UsersThree, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { avatarColor, tint } from "@/lib/color";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyId } from "@/components/ui/copy-id";

interface PersonaOption { id: string; name: string; perspectiveType: string }
interface Msg { id: string; sender: string; role: string; turn: number; content: string; createdAt: string }
interface Artifact { id: string; title: string; type: string; filePath?: string | null; summary?: string | null; content: string; createdAt: string }
interface Discussion {
  id: string;
  brief: string;
  rounds: number;
  status: string;
  personas: PersonaOption[];
  messages: Msg[];
  artifacts?: Artifact[];
  attachmentName?: string | null;
  attachmentCharCount?: number | null;
  attachmentTruncated?: boolean | null;
  shortId?: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  investor: "投资人", entrepreneur: "创业者", economist: "经济学家", analyst: "分析师",
  customer: "客户", competitor: "竞对", custom: "自定义",
};

/** 高亮消息中的 @人物 提及（仅对在场的人格高亮） */
function renderContent(content: string, personaNames: Set<string>, accent = "font-medium text-primary"): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /@([\p{L}\p{N}\u4e00-\u9fff_\-·]+)/gu;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content))) {
    const name = m[1];
    if (last < m.index) parts.push(content.slice(last, m.index));
    if (personaNames.has(name)) {
      parts.push(
        <span key={key++} className={accent}>@{name}</span>
      );
    } else {
      parts.push(`@${name}`);
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts;
}

/** 多人讨论室（微信群聊式）：参与者列表 + 微信气泡流；可插话、综合建议 */
export default function DiscussionsPage() {
  const searchParams = useSearchParams();
  const viewId = searchParams.get("id");
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [brief, setBrief] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [rounds, setRounds] = useState(5);
  const [current, setCurrent] = useState<Discussion | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steer, setSteer] = useState("");
  const [sending, setSending] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const steerRef = useRef<HTMLInputElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [viewArtifact, setViewArtifact] = useState<Artifact | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachment, setAttachment] = useState<{ filename: string; charCount: number; truncated: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetch("/api/v1/personas?page_size=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) setPersonas(d.data.items);
      });
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 上传并读取引用文件（pdf/txt/md 等） */
  const onFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      setError("文件过大（上限 20MB）");
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
        setAttachment({ filename: d.data.filename, charCount: d.data.charCount, truncated: d.data.truncated });
      } else {
        setError(d.message ?? "读取文件失败");
      }
    } catch {
      setError("读取文件失败");
    } finally {
      setUploading(false);
    }
  };

  const onDropFile = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void onFile(file);
  };

  const start = async () => {
    if (!brief.trim()) return setError("请先输入要讨论的方案/问题");
    if (selected.length < 1) return setError("请至少选择 1 个人格参与讨论");
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/discussions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief,
          personaIds: selected,
          rounds,
          attachment: attachment
            ? { filename: attachment.filename, charCount: attachment.charCount, truncated: attachment.truncated }
            : null,
        }),
      });
      const d = await res.json();
      if (d.code !== 0) return setError(d.message ?? "创建失败");
      setBrief("");
      setAttachment(null);
      startPolling(d.data.id);
    } catch {
      setError("创建失败");
    } finally {
      setStarting(false);
    }
  };

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void load(id), 2500);
    void load(id);
  }

  const load = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/discussions/${id}`);
      const d = await res.json();
      if (d.code === 0) {
        setCurrent(d.data);
        // 单人讨论由用户提问即时驱动，无后台自动推进；加载后即可停止轮询
        if (d.data.status === "done" || d.data.status === "failed" || (d.data.personas?.length ?? 0) === 1) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [current?.messages.length]);

  // 从工作台会话空间卡片进入：加载已有讨论线程
  useEffect(() => {
    if (viewId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrent({ id: viewId, brief: "", rounds: 5, status: "pending", personas: [], messages: [] });
      startPolling(viewId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId]);

  const sendSteer = async () => {
    if (!current || !steer.trim() || sending) return;
    const question = steer;
    // 立即清空输入框，用户消息马上离开 input
    setSteer("");
    // 1 对 1：该请求要等专家即时作答（LLM 较慢），先乐观显示自己的提问，避免“发了没反应”
    if (isOne) {
      const optimistic: Msg = {
        id: `tmp-${Date.now()}`,
        sender: "我",
        role: "user",
        turn: 0,
        content: question,
        createdAt: new Date().toISOString(),
      };
      setCurrent((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/discussions/${current.id}/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      const d = await res.json();
      if (d.code === 0) {
        void load(current.id);
      } else setError(d.message ?? (isOne ? "发送失败" : "插话失败"));
    } finally {
      setSending(false);
    }
  };

  const summarize = async () => {
    if (!current) return;
    setSummarizing(true);
    const res = await fetch(`/api/v1/discussions/${current.id}/summary`, { method: "POST" });
    const d = await res.json();
    setSummarizing(false);
    if (d.code === 0) void load(current.id);
    else setError(d.message ?? "生成建议失败");
  };

  // @ 提及：输入时检测光标前的 "@",弹出成员选择
  const handleSteerChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSteer(val);
    const pos = e.target.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const atPos = before.lastIndexOf("@");
    const tail = before.slice(atPos + 1);
    if (atPos >= 0 && !tail.includes("@") && !tail.includes(" ") && !tail.includes("\n") && tail.length <= 12) {
      setMentionQuery(tail);
    } else {
      setMentionQuery(null);
    }
  };

  const mentionOptions =
    mentionQuery !== null
      ? (current?.personas ?? []).filter((p) => p.name.includes(mentionQuery))
      : [];

  const insertMention = (name: string) => {
    const input = steerRef.current;
    const pos = input?.selectionStart ?? steer.length;
    const before = steer.slice(0, pos);
    const atPos = before.lastIndexOf("@");
    const newVal = before.slice(0, atPos) + `@${name} ` + steer.slice(pos);
    setSteer(newVal);
    setMentionQuery(null);
    const nextPos = atPos + 1 + name.length + 1;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextPos, nextPos);
    });
  };

  const downloadArtifact = (a: Artifact) => {
    const blob = new Blob([a.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(a.title || "报告").replace(/[\\/:*?"<>|]/g, "-")}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const running = current && (current.status === "running" || current.status === "pending");
  const isOne = (current?.personas?.length ?? 0) === 1;
  const personaNames = new Set((current?.personas ?? []).map((p) => p.name));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ChatCircleDots size={22} weight="duotone" />
        </div>
        <div>
          <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.4px]">讨论</h1>
          <p className="text-[13px] text-ink-48">单人：你问我答的一对一交流；多人：多位专家互相交锋，给你建议</p>
        </div>
      </div>

      {/* 发起讨论（仅非查看模式） */}
      {!viewId && (
        <div
          className={cn(
            "mb-6 rounded-2xl border border-hairline bg-white p-6 transition-shadow",
            dragOver && "ring-4 ring-primary/40"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDropFile}
        >
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder="要讨论的方案/问题，例如：面向独立开发者的 AI 定价分析工具，订阅制月费 49 元，是否可行？"
            className="w-full resize-y rounded-xl border border-hairline p-3 text-[15px] leading-[1.6] text-ink outline-none focus:border-primary"
          />

          {/* 引用文件（上传资料） */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-[13px] text-ink-60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-primary/40 hover:text-ink"
            >
              {uploading ? <SpinnerGap size={14} className="animate-spin" /> : <Plus size={14} weight="bold" />}
              引用文件
            </button>
            {attachment && (
              <span className="flex items-center gap-2 rounded-lg bg-parchment px-3 py-1.5 text-[13px] text-ink-60">
                <FilePdf size={15} className="shrink-0 text-error" />
                <span className="max-w-[240px] truncate">{attachment.filename}</span>
                <span className="text-[11px] text-ink-40">
                  已读取 {attachment.charCount} 字{attachment.truncated ? "（截取）" : ""}
                </span>
                <button
                  type="button"
                  aria-label="移除引用文件"
                  onClick={() => setAttachment(null)}
                  className="shrink-0 text-ink-40 hover:text-ink"
                >
                  <X size={14} />
                </button>
              </span>
            )}
            <span className="text-[12px] text-ink-40">可拖拽或上传 PDF / TXT / MD</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {personas.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                    on ? "border-primary bg-primary/10 text-primary" : "border-hairline text-ink-60 hover:border-primary/40"
                  )}
                >
                  <Avatar name={p.name} size="sm" />
                  {p.name}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] text-ink-60">
              {selected.length === 1 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-primary">
                  <ChatCircleDots size={14} /> 一对一问答交流（你问我答）
                </span>
              ) : (
                <label className="flex items-center gap-2">
                  轮数
                  <select
                    value={rounds}
                    onChange={(e) => setRounds(Number(e.target.value))}
                    className="h-9 rounded-lg border border-hairline px-2 text-[14px] outline-none focus:border-primary"
                  >
                    {[2, 3, 5, 8, 10].map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <Button onClick={start} disabled={starting}>
              {starting ? "创建中…" : selected.length === 1 ? "开始交流" : "开始讨论"}
            </Button>
          </div>
          {error && <p className="mt-2 text-[13px] text-error">{error}</p>}
        </div>
      )}

      {!current ? (
        !viewId ? (
          <EmptyState
            icon={ChatCircleDots}
            title="发起一场专家讨论"
            description="输入方案、勾选 1 或多个人格：多人会互相交锋，单人则与你一对一深度交流。"
          />
        ) : (
          <div className="h-48 animate-pulse rounded-2xl bg-pearl" />
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          {/* 群标题 + 成员头像簇 */}
          <div className="flex items-center gap-3 border-b border-divider-soft px-6 py-4">
            <div className="flex -space-x-2">
              {(current.personas ?? []).map((p) => (
                <Avatar key={p.id} name={p.name} size="sm" className="ring-2 ring-white" />
              ))}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    isOne ? "bg-primary/10 text-primary" : "bg-parchment text-ink-60"
                  )}
                >
                  {isOne ? "1 对 1" : "多人"}
                </span>
                <div className="truncate text-[15px] font-semibold text-ink">
                  {isOne ? `${current.personas?.[0]?.name ?? "专家"}` : `讨论：${current.brief.slice(0, 30)}…`}
                </div>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-ink-48">
                <span>
                  {current.status === "done" && "已结束"}
                  {current.status === "failed" && "失败"}
                  {running && "讨论中…"}
                  {isOne && "一对一交流"}
                  {!isOne && ` · ${current.rounds} 轮`}
                </span>
                <CopyId id={current.shortId} />
              </div>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="dark" size="sm" onClick={summarize} disabled={summarizing || current.messages.length === 0}>
                {summarizing ? "总结中…" : "总结"}
              </Button>
            </div>
          </div>

          <div className="flex">
            {/* 消息流 */}
            <div className="min-w-0 flex-1 border-r border-divider-soft">
              <div ref={scrollRef} className="h-[52vh] space-y-4 overflow-auto bg-parchment/40 p-6">
                {current.messages.length === 0 ? (
                  <p className="py-10 text-center text-[13px] text-ink-40">
                    {isOne
                      ? `向 ${current.personas?.[0]?.name ?? "专家"} 提问，开始一对一交流`
                      : "专家们正在陆续登场…"}
                  </p>
                ) : (
                  current.messages.map((m) => {
                    if (m.role === "summary") {
                      return (
                        <div key={m.id} className="mx-auto max-w-[85%] rounded-xl bg-success/12 px-4 py-3 text-[13px] leading-[1.7] text-ink-80">
                          <div className="mb-1 text-[11px] font-semibold text-[#1f7a43]">📋 综合建议</div>
                          <div className="whitespace-pre-wrap">{m.content}</div>
                        </div>
                      );
                    }
                    const isUser = m.role === "user";
                    const color = isUser ? "#0066cc" : avatarColor(m.sender);
                    const time = new Date(m.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <div key={m.id} className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
                        <Avatar name={isUser ? "我" : m.sender} size="sm" />
                        <div className={cn("max-w-[76%]", isUser && "text-right")}>
                          <div className={cn("mb-1 flex items-baseline gap-1.5 text-[11px]", isUser && "justify-end")}>
                            <span className={isUser ? "text-ink-40" : undefined} style={isUser ? undefined : { color, fontWeight: 600 }}>
                              {isUser ? "我" : m.sender}
                            </span>
                            <span className="text-ink-40/70">{time}</span>
                          </div>
                          <div
                            className={cn(
                              "inline-block rounded-2xl px-3.5 py-2 text-left text-[14px] leading-[1.6] whitespace-pre-wrap",
                              isUser
                                ? "bg-primary text-white rounded-tr-sm shadow-[0_4px_12px_rgba(0,102,204,0.18)]"
                                : "rounded-tl-sm text-ink shadow-[0_2px_8px_rgba(0,0,0,0.05)]"
                            )}
                            style={isUser ? undefined : { backgroundColor: tint(color, 0.1), borderLeft: `2.5px solid ${color}` }}
                          >
                            {renderContent(m.content, personaNames, isUser ? "font-semibold underline decoration-2 underline-offset-2" : "font-semibold text-primary")}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {running && (
                  <div className="flex items-center gap-2 py-1 text-[12px] text-ink-40">
                    <PaperPlaneTilt size={14} className="animate-pulse" /> 专家们正在发言…
                  </div>
                )}
                {isOne && sending && (
                  <div className="flex items-center gap-2 py-1 text-[12px] text-ink-40">
                    <ChatCircleDots size={14} className="animate-pulse" /> {current.personas?.[0]?.name ?? "专家"} 正在回复…
                  </div>
                )}
              </div>

              {/* 输入 + 插话 */}
              <div className="border-t border-divider-soft p-3">
                <div className="relative flex items-center gap-2 rounded-2xl border border-hairline bg-white p-2 transition-colors focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
                  {!isOne && mentionQuery !== null && mentionOptions.length > 0 && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-hairline bg-white shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
                      <div className="border-b border-divider-soft px-3 py-1.5 text-[11px] text-ink-40">选择要 @ 的成员</div>
                      <div className="max-h-44 overflow-auto py-1">
                        {mentionOptions.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insertMention(p.name)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-parchment"
                          >
                            <Avatar name={p.name} size="sm" />
                            <div>
                              <div className="text-[13px] font-medium text-ink">{p.name}</div>
                              <div className="text-[11px] text-ink-40">{TYPE_LABEL[p.perspectiveType] ?? p.perspectiveType}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <input
                    ref={steerRef}
                    value={steer}
                    onChange={handleSteerChange}
                    placeholder={
                      isOne
                        ? `向 ${current.personas?.[0]?.name ?? "专家"} 提问…`
                        : "插一句，用 @ 点名：「@乔布斯 如果成本砍半呢？」"
                    }
                    onKeyDown={(e) => {
                      if (!isOne && mentionQuery !== null && mentionOptions.length > 0) {
                        if (e.key === "Escape") { setMentionQuery(null); e.preventDefault(); return; }
                        if (e.key === "Enter") { e.preventDefault(); insertMention(mentionOptions[0].name); return; }
                      } else if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendSteer();
                      }
                    }}
                    className="h-9 flex-1 bg-transparent px-2 text-[14px] text-ink outline-none placeholder:text-ink-40"
                  />
                  <Button size="sm" onClick={sendSteer} disabled={sending || !steer.trim()}>
                    {sending ? "发送中…" : isOne ? "发送" : "插话"}
                  </Button>
                </div>
              </div>
            </div>

            {/* 讨论成员列表 */}
            <aside className="w-56 shrink-0">
              <div className="flex items-center gap-2 px-5 py-4 text-[12px] font-semibold uppercase tracking-wide text-ink-40">
                <UsersThree size={14} /> {isOne ? "交流对象" : "讨论成员"}（{current.personas?.length ?? 0}）
              </div>
              <div className="space-y-1 px-2 pb-4">
                {(current.personas ?? []).map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-parchment">
                    <Avatar name={p.name} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-ink">{p.name}</div>
                      <div className="text-[11px] text-ink-40">{TYPE_LABEL[p.perspectiveType] ?? p.perspectiveType}</div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
                  <Avatar name="我" size="sm" />
                  <div>
                    <div className="text-[13px] font-medium text-ink">我</div>
                    <div className="text-[11px] text-ink-40">主持人 · {isOne ? "提问" : "可插话"}</div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* 引用的文件：本次讨论上传的资料 */}
      {current && current.attachmentName && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FilePdf size={16} weight="duotone" />
            </div>
            <h2 className="text-[16px] font-semibold tracking-[-0.3px]">引用文件</h2>
            <span className="text-[12px] text-ink-40">本次讨论引用的资料</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-hairline bg-white p-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FilePdf size={18} weight="duotone" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-ink">{current.attachmentName}</div>
              <div className="text-[12px] text-ink-48">
                已读取 {current.attachmentCharCount ?? 0} 字{current.attachmentTruncated ? "（已截取）" : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 产物列表：综合建议生成后汇总成 md 报告 */}
      {current && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText size={16} weight="duotone" />
            </div>
            <h2 className="text-[16px] font-semibold tracking-[-0.3px]">产物</h2>
            <span className="text-[12px] text-ink-40">汇总讨论，保存成可下载的 md 报告</span>
          </div>
          {current.artifacts && current.artifacts.length > 0 ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {current.artifacts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 rounded-xl border border-hairline bg-white p-3.5">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText size={18} weight="duotone" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-ink">{a.title}</div>
                    {a.summary && (
                      <div className="mt-0.5 line-clamp-2 text-[12px] leading-[1.5] text-ink-48">{a.summary}</div>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-[12px]">
                      <button onClick={() => setViewArtifact(a)} className="font-medium text-primary hover:underline">
                        查看
                      </button>
                      <button onClick={() => downloadArtifact(a)} className="text-ink-60 hover:text-primary">
                        下载 md
                      </button>
                      <span className="ml-auto text-ink-40">
                        {new Date(a.createdAt).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-hairline bg-parchment/50 px-4 py-5 text-[13px] text-ink-48">
              <FileText size={16} className="text-ink-40" />
              还没有产物。点击上方「总结」即可把讨论汇总成一份 md 报告。
            </div>
          )}
        </div>
      )}

      {/* 产物预览 */}
      {viewArtifact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setViewArtifact(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-divider-soft px-5 py-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText size={16} weight="duotone" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-ink">{viewArtifact.title}</div>
                <div className="text-[12px] text-ink-40">
                  Markdown 报告 · {new Date(viewArtifact.createdAt).toLocaleString("zh-CN", { hour12: false })}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => downloadArtifact(viewArtifact)}>
                下载 md
              </Button>
              <button
                onClick={() => setViewArtifact(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-48 hover:bg-parchment"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-parchment/30 p-5">
              <pre className="whitespace-pre-wrap text-[13px] leading-[1.7] text-ink">{viewArtifact.content}</pre>
            </div>
          </div>
        </div>
      )}

      {/* 隐藏文件输入（引用文件） */}
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
    </div>
  );
}
