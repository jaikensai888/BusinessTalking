"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLineDown, ChatCircleDots, PaperPlaneTilt } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";

interface PersonaOption { id: string; name: string; perspectiveType: string }
interface Msg { id: string; sender: string; role: string; turn: number; content: string; createdAt: string }
interface Discussion { id: string; brief: string; rounds: number; status: string; messages: Msg[] }

/** 多人讨论室：选 2+ 个人物关于方案讨论，可插话，可生成综合建议 */
export default function DiscussionsPage() {
  const router = useRouter();
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
  const [summarizing, setSummarizing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/v1/personas?page_size=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) setPersonas(d.data.items);
      });
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const start = async () => {
    if (!brief.trim()) return setError("请先输入要讨论的方案/问题");
    if (selected.length < 2) return setError("请至少选择 2 个人格参与讨论");
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/discussions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, personaIds: selected, rounds }),
      });
      const d = await res.json();
      if (d.code !== 0) return setError(d.message ?? "创建失败");
      setCurrent({ id: d.data.id, brief, rounds, status: "pending", messages: [] });
      setBrief("");
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
        if (d.data.status === "done" || d.data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      /* 忽略轮询失败 */
    }
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [current?.messages.length]);

  // 从工作台会话空间卡片进入：加载已有讨论线程
  useEffect(() => {
    if (viewId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrent({ id: viewId, brief: "", rounds: 5, status: "pending", messages: [] });
      startPolling(viewId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId]);

  const sendSteer = async () => {
    if (!current || !steer.trim()) return;
    const res = await fetch(`/api/v1/discussions/${current.id}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: steer }),
    });
    const d = await res.json();
    if (d.code === 0) {
      setSteer("");
      void load(current.id);
    } else setError(d.message ?? "插话失败");
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

  const running = current && (current.status === "running" || current.status === "pending");
  const senderType = (role: string) =>
    role === "persona" ? "persona" : role === "user" ? "user" : "summary";

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ChatCircleDots size={22} weight="duotone" />
        </div>
        <div>
          <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.4px]">多人讨论</h1>
          <p className="text-[13px] text-ink-48">让多位专家人格围绕一个方案展开讨论，给你建议</p>
        </div>
      </div>

      {/* 发起讨论（仅非查看模式） */}
      {!viewId && (
        <div className="mb-6 rounded-2xl border border-hairline bg-white p-6">
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder="要讨论的方案/问题，例如：面向独立开发者的 AI 定价分析工具，订阅制月费 49 元，是否可行？"
          className="w-full resize-y rounded-xl border border-hairline p-3 text-[15px] leading-[1.6] text-ink outline-none focus:border-primary"
        />
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
          <label className="flex items-center gap-2 text-[13px] text-ink-60">
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
          <Button onClick={start} disabled={starting}>
            {starting ? "创建中…" : "开始讨论"}
          </Button>
        </div>
        {error && <p className="mt-2 text-[13px] text-error">{error}</p>}
        </div>
      )}

      {/* 讨论流 */}
      {!current ? (
        <EmptyState
          icon={ChatCircleDots}
          title="发起一场专家讨论"
          description="输入方案、勾选至少 2 个人格，他们就会轮流发言并互相回应。"
        />
      ) : (
        <div className="rounded-2xl border border-hairline bg-white">
          <div className="border-b border-divider-soft px-6 py-4">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold">讨论：{current.brief.slice(0, 30)}…</span>
              <span className="text-[12px] text-ink-48">
                {current.status === "done" && "✓ 已结束"}
                {current.status === "failed" && "✗ 失败"}
                {running && "● 讨论中…"}
              </span>
            </div>
          </div>
          <div ref={scrollRef} className="max-h-[60vh] space-y-3 overflow-auto p-6">
            {current.messages.map((m) => (
              <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
                <Avatar name={m.role === "user" ? "我" : m.role === "summary" ? "综合" : m.sender} size="sm" />
                <div className="max-w-[78%]">
                  <div className={cn("mb-1 text-[11px] text-ink-40", m.role === "user" && "text-right")}>{m.sender}</div>
                  <div
                    className={cn(
                      "rounded-xl px-4 py-3 text-[14px] leading-[1.6] whitespace-pre-wrap",
                      m.role === "user"
                        ? "bg-primary text-white rounded-tr-none"
                        : m.role === "summary"
                          ? "bg-success/12 text-ink-80 rounded-tl-none"
                          : "bg-parchment text-ink rounded-tl-none"
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            ))}
            {running && (
              <div className="flex items-center gap-2 py-2 text-[13px] text-ink-40">
                <PaperPlaneTilt size={16} className="animate-pulse" /> 专家们正在发言…
              </div>
            )}
          </div>
          {!running && (
            <div className="flex items-center gap-2 border-t border-divider-soft p-4">
              <input
                value={steer}
                onChange={(e) => setSteer(e.target.value)}
                placeholder="插一句：『乔布斯，如果成本砍半呢？』"
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendSteer())}
                className="flex-1 h-10 rounded-full border border-hairline px-4 text-[14px] outline-none focus:border-primary"
              />
              <Button variant="secondary" onClick={sendSteer} disabled={!steer.trim()}>插话</Button>
              <Button variant="dark" onClick={summarize} disabled={summarizing || current.messages.length === 0}>
                {summarizing ? "总结中…" : "给综合建议"}
              </Button>
            </div>
          )}
          {!running && current.messages.some((m) => m.role === "summary") && (
            <div className="p-4 pt-0 text-center text-[12px] text-ink-40">
              <ArrowLineDown size={14} className="inline" /> 已生成综合建议，可继续插话或导出
            </div>
          )}
        </div>
      )}
    </div>
  );
}
