"use client";

import { useState } from "react";
import { ArrowUp, ChatCircleDots, DownloadSimple, Plus, SpinnerGap } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";

interface Message {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  /** 正在流式生成中的占位（用于结尾打字光标） */
  streaming?: boolean;
}
interface Conversation {
  id: string;
  title: string | null;
  messageCount: number;
  updatedAt: string;
}

/** 人格交流 Tab（优化版）：会话列表 + 对话流 + 输入一体化 */
export function ChatPanel({ personaId, personaName }: { personaId: string; personaName: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadConversations = async () => {
    const res = await fetch(`/api/v1/conversations?personaId=${personaId}`);
    const d = await res.json();
    if (d.code === 0) setConversations(d.data.items);
  };

  const ensureLoaded = async () => {
    if (!loaded) {
      await loadConversations();
      setLoaded(true);
    }
  };

  const openConversation = async (id: string) => {
    setActiveId(id);
    const res = await fetch(`/api/v1/conversations/${id}`);
    const d = await res.json();
    if (d.code === 0) setMessages(d.data.messages);
  };

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    // 乐观显示：用户提问 + 一个空的、流式中的助手占位，让用户立刻看到"正在回"
    const userMsg: Message = { role: "user", content: message, createdAt: new Date().toISOString() };
    const aiMsg: Message = { role: "assistant", content: "", createdAt: new Date().toISOString(), streaming: true };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput("");
    const convId = activeId;
    // 流式过程中用「最后一条」定位助手气泡（引用会被替换，不能靠 m === aiMsg）
    const patchLast = (fn: (m: Message) => Message) =>
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        next[next.length - 1] = fn(next[next.length - 1]);
        return next;
      });
    const removeLast = () => setMessages((prev) => prev.slice(0, Math.max(0, prev.length - 1)));
    try {
      const res = await fetch(`/api/v1/personas/${personaId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversationId: convId ?? undefined }),
      });
      const contentType = res.headers.get("content-type") ?? "";
      // 非流式响应（如校验/鉴权失败返回 JSON err）：常规报错并回滚两条乐观消息
      if (!contentType.includes("text/event-stream")) {
        let msgText = "发送失败";
        try {
          const d = await res.json();
          if (d.code !== 0) msgText = d.message ?? msgText;
        } catch {
          /* 忽略 */
        }
        setError(msgText);
        setMessages((prev) => prev.slice(0, Math.max(0, prev.length - 2)));
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 帧以空行分隔；用 \n\n 划分，保留尾部不完整帧
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          let evt: { type?: string; text?: string; conversationId?: string; message?: string };
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }
          if (evt.type === "delta") {
            full += evt.text ?? "";
            patchLast((m) => ({ ...m, content: full }));
          } else if (evt.type === "done") {
            setActiveId(evt.conversationId ?? convId);
            patchLast((m) => ({ ...m, content: full, streaming: false }));
          } else if (evt.type === "error") {
            setError(evt.message ?? "发送失败");
            removeLast();
          }
        }
      }
      loadConversations();
    } catch {
      setError("发送失败");
      removeLast();
    } finally {
      setSending(false);
    }
  };

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
    setError(null);
  };

  const exportNote = () => {
    if (messages.length === 0) return;
    const lines = [
      `# 与「${personaName}」的对话`,
      "",
      ...messages.map((m) => `**${m.role === "user" ? "我" : personaName}**：${m.content}`),
      "",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `与${personaName}的对话.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-[600px] gap-4">
      {/* 会话列表 */}
      <aside
        className="w-52 shrink-0 overflow-hidden rounded-2xl border border-hairline bg-white"
        onMouseEnter={ensureLoaded}
      >
        <div className="flex items-center justify-between border-b border-divider-soft px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-40">会话</span>
          <button
            onClick={newConversation}
            title="新建会话"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-60 transition-colors hover:bg-parchment hover:text-ink"
          >
            <Plus size={16} weight="bold" />
          </button>
        </div>
        <div className="h-[calc(100%-45px)] space-y-1 overflow-auto p-2">
          {conversations.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-ink-40">还没有会话</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left transition-colors",
                  activeId === c.id ? "bg-primary/10 text-primary" : "hover:bg-parchment"
                )}
              >
                <div className="truncate text-[13px] text-ink">{c.title || "未命名会话"}</div>
                <div className="text-[11px] text-ink-40">{c.messageCount} 条消息</div>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-divider-soft p-2">
          <button
            onClick={exportNote}
            disabled={messages.length === 0}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-ink-60 transition-colors hover:bg-parchment disabled:opacity-40"
          >
            <DownloadSimple size={15} /> 导出笔记
          </button>
        </div>
      </aside>

      {/* 对话区 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-hairline bg-white">
        <div className="flex items-center gap-3 border-b border-divider-soft px-5 py-3">
          <Avatar name={personaName} size="sm" />
          <div>
            <div className="text-[14px] font-semibold text-ink">{personaName}</div>
            <div className="text-[11px] text-ink-40">与你一对一交流</div>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-6" onMouseEnter={ensureLoaded}>
          {messages.length === 0 ? (
            <EmptyState
              icon={ChatCircleDots}
              title={`与「${personaName}」聊聊吧`}
              description="用一个问题开始，或让它用它的视角质询你的商业想法。"
            />
          ) : (
            messages.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div key={i} className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
                  <Avatar name={isUser ? "我" : personaName} size="sm" className="mt-0.5" />
                  <div className="max-w-[78%]">
                    <div className={cn("mb-1 text-[11px] text-ink-40", isUser && "text-right")}>
                      {isUser ? "我" : personaName}
                    </div>
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-2.5 text-[14px] leading-[1.65] whitespace-pre-wrap",
                        isUser
                          ? "bg-primary text-white rounded-tr-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                          : "bg-parchment text-ink rounded-tl-sm"
                      )}
                    >
                      {m.content}
                      {m.streaming && (
                        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-ink-60 align-middle" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {error && <div className="px-6 pb-1 text-[12px] text-error">{error}</div>}

        <div className="border-t border-divider-soft p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-hairline bg-white p-2 transition-colors focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !sending) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={`向「${personaName}」提问…（Enter 发送，Shift+Enter 换行）`}
              className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] text-ink outline-none placeholder:text-ink-40"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              aria-label="发送"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-all hover:bg-[#0077e6] active:scale-95 disabled:opacity-40"
            >
              {sending ? <SpinnerGap size={17} className="animate-spin" /> : <ArrowUp size={17} weight="bold" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
