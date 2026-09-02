"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

interface Message {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

interface Conversation {
  id: string;
  title: string | null;
  messageCount: number;
  updatedAt: string;
}

/** UX 3.4 / 4.5 对话组件：气泡、会话列表、新建会话、导出笔记 */
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
    try {
      const res = await fetch(`/api/v1/personas/${personaId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversationId: activeId ?? undefined }),
      });
      const d = await res.json();
      if (d.code !== 0) {
        setError(d.message ?? "发送失败");
        return;
      }
      setActiveId(d.data.conversationId);
      setMessages((prev) => [
        ...(activeId === d.data.conversationId ? prev : []),
        ...d.data.messages,
      ]);
      setInput("");
      loadConversations();
    } catch {
      setError("发送失败");
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
    <div className="flex gap-4 h-[560px]">
      {/* 会话列表 */}
      <aside className="w-52 shrink-0 bg-pearl border border-hairline rounded-lg p-3 flex flex-col gap-2" onMouseEnter={ensureLoaded}>
        <Button variant="pearl" onClick={newConversation} className="w-full">
          + 新建会话
        </Button>
        <div className="flex-1 overflow-auto space-y-1">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={cn(
                "w-full text-left rounded-[8px] px-3 py-2 text-[13px] leading-[1.4]",
                activeId === c.id ? "bg-primary text-white" : "hover:bg-parchment text-ink"
              )}
            >
              <div className="truncate">{c.title || "未命名会话"}</div>
              <div className={cn("text-[11px]", activeId === c.id ? "text-white/70" : "text-ink-48")}>
                {c.messageCount} 条消息
              </div>
            </button>
          ))}
        </div>
        <Button variant="dark" onClick={exportNote} disabled={messages.length === 0}>
          导出笔记
        </Button>
      </aside>

      {/* 对话区 */}
      <div className="flex-1 bg-white border border-hairline rounded-lg flex flex-col min-w-0">
        <div className="flex-1 overflow-auto p-6 space-y-4" onMouseEnter={ensureLoaded}>
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-ink-48 text-[14px]">
              与「{personaName}」聊聊你的想法吧
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
                <Avatar name={m.role === "user" ? "我" : personaName} size="sm" />
                <div
                  className={cn(
                    "max-w-[70%] rounded-lg px-4 py-3 text-[15px] leading-[1.5] whitespace-pre-wrap",
                    m.role === "user"
                      ? "bg-primary text-white rounded-tr-none"
                      : "bg-parchment text-ink rounded-tl-none"
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
        </div>

        {error && <div className="px-6 pb-2 text-[13px] text-error">{error}</div>}

        <div className="border-t border-hairline p-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`向「${personaName}」提问…`}
            className="flex-1 bg-white border border-hairline rounded-full h-11 px-5 text-[15px] outline-none focus:border-primary"
          />
          <Button onClick={send} disabled={sending || !input.trim()}>
            {sending ? "思考中…" : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}
