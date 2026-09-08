"use client";

import { Fragment, Suspense, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUp, ChatCircleDots, FilePdf, FileText, PaperPlaneTilt, Plus, SpinnerGap, UsersThree, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getOneOnOneFailure, hasNewPersonaReply, isOneOnOneReplyPending } from "@/lib/discussion/live-state";
import { useDiscussionEvents } from "@/hooks/use-discussion-events";
import type { DshToolView } from "@/lib/discussion/dsh-turn-projection";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { CopyId } from "@/components/ui/copy-id";
import { Markdown } from "@/components/ui/markdown";
import { DshApprovalPanel } from "@/components/discussions/dsh-approval-panel";
import { DshTurnProcess } from "@/components/discussions/dsh-turn-process";
import { DiscussionPermissionControl } from "@/components/discussions/discussion-permission-control";

interface PersonaOption { id: string; name: string; perspectiveType: string }
interface Msg { id: string; sender: string; role: string; turn: number; content: string; createdAt: string; sessionId?: string | null; streaming?: boolean }
interface Artifact { id: string; title: string; type: string; filePath?: string | null; summary?: string | null; content: string; createdAt: string }
interface ParticipantState { id: string; personaId: string; status: string; lastError?: string | null }
interface Discussion {
  id: string;
  brief: string;
  rounds: number;
  status: string;
  permissionMode?: string;
  approvalPolicy?: string;
  eventCursor?: number;
  personas: PersonaOption[];
  participants?: ParticipantState[];
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

/** 消息日期标签（用于按天分隔）：今天 / 昨天 / 9月2日 */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const s = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((s(now) - s(d)) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 多人讨论室（微信群聊式）：参与者列表 + 微信气泡流；可插话、综合建议 */
function DiscussionsContent() {
  const searchParams = useSearchParams();
  const viewId = searchParams.get("id");
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [skills, setSkills] = useState<{ id: string; name: string; version: string }[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
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
  const replyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const steerStreamingRef = useRef(false); // 1v1 / 追问 流式期间为 true，避免 /stream 的 change 覆盖乐观气泡
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const steerRef = useRef<HTMLInputElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [viewArtifact, setViewArtifact] = useState<Artifact | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachment, setAttachment] = useState<{ filename: string; charCount: number; truncated: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [followUp, setFollowUp] = useState<{ personaId: string; name: string } | null>(null);
  /** ≤1024px 时右侧「参与人 / 产物」面板浮为抽屉，默认收起 */
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    fetch("/api/v1/personas?page_size=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) setPersonas(d.data.items);
      });
    // 已安装 Skill revision（讨论可勾选为普通技能，作为 DSH allowlist）
    fetch("/api/v1/skills?page_size=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) return;
        const revs: { id: string; name: string; version: string }[] = [];
        for (const s of d.data.items as { name?: string; revisions?: { id?: string; version?: string; hasPackage?: boolean }[] }[]) {
          for (const r of s.revisions ?? []) {
            if (r.id && r.hasPackage) revs.push({ id: r.id, name: s.name ?? "skill", version: r.version ?? "" });
          }
        }
        setSkills(revs);
      });
  }, []);

  const toggleSkill = (id: string) =>
    setSelectedSkills((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
          skillRevisionIds: selectedSkills,
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

  // 停止所有实时通道（SSE + 轮询兜底）
  function stopLive() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (replyPollRef.current) {
      clearInterval(replyPollRef.current);
      replyPollRef.current = null;
    }
  }

  const load = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/discussions/${id}`, { cache: "no-store" });
      const d = await res.json();
      if (d.code === 0) {
        setCurrent(d.data);
        const oneOnOne = (d.data.personas?.length ?? 0) === 1;
        const failure = getOneOnOneFailure(d.data);
        if (failure) {
          setError(failure);
          setSending(false);
          stopLive();
          return;
        }
        const oneOnOnePending = isOneOnOneReplyPending(d.data);
        // 1v1 生成期间 status 仍可能是 ready，必须根据最后一条消息决定是否继续同步。
        const active = d.data.status === "pending" || d.data.status === "running" || oneOnOnePending;
        if (oneOnOnePending || (oneOnOne && d.data.status === "running")) {
          setSending(true);
          // SSE 只是加速通知；pending 的 1v1 同时保留数据库轮询，避免浏览器丢事件。
          if (!pollRef.current) startPolling(id);
        } else if (oneOnOne) {
          setSending(false);
          setError(null);
        }
        if (!active) stopLive();
      }
    } catch {
      /* ignore */
    }
  };

  // 轮询兜底：若 SSE 意外断开则退回 2.5s 轮询
  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void load(id), 2500);
    void load(id);
  }

  // 1v1/追问：轮询数据库直到「人格回复出现」再停止。这是不依赖 SSE 的兜底，
  // 因为回复一定已落库（后端先持久化再返回流），所以无论浏览器/时序怎样都能显示。
  function startReplyPoll(id: string, previousReplyCount: number) {
    if (replyPollRef.current) clearInterval(replyPollRef.current);
    const started = Date.now();
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/v1/discussions/${id}`, { cache: "no-store" });
        const d = await res.json();
        if (d.code !== 0) return;
        setCurrent(d.data);
        const failure = getOneOnOneFailure(d.data);
        if (failure) {
          setError(failure);
          setSending(false);
          stopLive();
          return;
        }
        // 不能检查“是否存在 persona 回复”，因为历史回合本来就有 persona 回复。
        const hasReply = hasNewPersonaReply(d.data.messages ?? [], previousReplyCount);
        // 出现本轮人格回复，或超时（90s）→ 停止并结束“正在思考”
        if (hasReply || Date.now() - started > 90_000) {
          if (replyPollRef.current) clearInterval(replyPollRef.current);
          replyPollRef.current = null;
          setSending(false);
        }
      } catch {
        /* ignore，继续轮询 */
      } finally {
        inFlight = false;
      }
    };
    void poll();
    replyPollRef.current = setInterval(async () => {
      await poll();
    }, 2000);
  }

  const eventStream = useDiscussionEvents(viewId ?? current?.id ?? null, (frame) => {
    if (frame.event === "change" && !steerStreamingRef.current) {
      const id = viewId ?? current?.id;
      if (id) void load(id);
    }
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [current?.messages.length, eventStream.process.turns.length, eventStream.process.cursor]);

  // 从工作台会话空间卡片进入：加载已有讨论线程，并实时订阅进展
  useEffect(() => {
    if (viewId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrent({ id: viewId, brief: "", rounds: 5, status: "pending", personas: [], messages: [] });
      void load(viewId);
    }
    return () => stopLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId]);

  const sendSteer = async () => {
    if (!current || !steer.trim() || sending) return;
    const question = steer;
    const discussionId = current.id;
    const previousReplyCount = current.messages.filter(
      (message) => message.role === "persona" && (message.content ?? "").trim().length > 0
    ).length;
    setSteer("");

    // 讨论结束后的单独追问：向某人格带上下文提问，SSE 逐字流式
    if (followUp) {
      const optimistic: Msg = {
        id: `tmp-${Date.now()}`,
        sender: "我",
        role: "user",
        turn: 0,
        content: question,
        createdAt: new Date().toISOString(),
      };
      setCurrent((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));
      setSending(true);
      setError(null);
      steerStreamingRef.current = true;
      const removeOptimistic = () =>
        setCurrent((prev) =>
          prev ? { ...prev, messages: prev.messages.slice(0, Math.max(0, prev.messages.length - 1)) } : prev
        );
      try {
        const res = await fetch(`/api/v1/discussions/${discussionId}/followup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId: followUp.personaId, message: question }),
        });
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("text/event-stream")) {
          let msgText = "追问失败";
          try {
            const dj = await res.json();
            if (dj.code !== 0) msgText = dj.message ?? msgText;
          } catch {
            /* 忽略 */
          }
          setError(msgText);
          removeOptimistic();
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let evt: { type?: string; text?: string; message?: string };
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }
            if (evt.type === "error") {
              setError(evt.message ?? "追问失败");
              removeOptimistic();
            }
          }
        }
        setFollowUp(null);
        // 与库同步，拿到带真实 id 的消息（覆盖刚才的临时乐观消息，无重复）
        void load(discussionId);
      } catch {
        setError("追问失败");
        void load(discussionId);
      } finally {
        steerStreamingRef.current = false;
        startReplyPoll(discussionId, previousReplyCount); // 追问也等到本轮回复出现
      }
      return;
    }

    // 原有路径：1 对 1（SSE 逐字流式） / 多人插话（记录后由引擎在下一轮消费）
    setSending(true);
    setError(null);
    if (isOne) {
      // 1 对 1：消费 /steer 的完成流；可见过程与最终回复统一来自 DSH 事件账本。
      const optimistic: Msg = {
        id: `tmp-${Date.now()}`,
        sender: "我",
        role: "user",
        turn: 0,
        content: question,
        createdAt: new Date().toISOString(),
      };
      setCurrent((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));
      const removeOptimistic = () =>
        setCurrent((prev) =>
          prev ? { ...prev, messages: prev.messages.slice(0, Math.max(0, prev.messages.length - 1)) } : prev
        );
      steerStreamingRef.current = true;
      try {
        const res = await fetch(`/api/v1/discussions/${discussionId}/steer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question }),
        });
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("text/event-stream")) {
          let msgText = "发送失败";
          try {
            const dj = await res.json();
            if (dj.code !== 0) msgText = dj.message ?? msgText;
          } catch {
            /* 忽略 */
          }
          setError(msgText);
          removeOptimistic();
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let evt: { type?: string; text?: string; message?: string };
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }
            if (evt.type === "error") {
              setError(evt.message ?? "发送失败");
              removeOptimistic();
            }
          }
        }
      } catch {
        // SSE/网络中断：保留用户问题，交给回源同步判断后端是否已生成回复。
        setError("发送中断，正在同步…");
      } finally {
        steerStreamingRef.current = false;
        void load(discussionId);
        startReplyPoll(discussionId, previousReplyCount);
      }
      return;
    }
    // 多人插话：仅记录，由运行引擎在下一轮消费
    try {
      const res = await fetch(`/api/v1/discussions/${discussionId}/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      const d = await res.json();
      if (d.code === 0) void load(discussionId);
      else setError(d.message ?? "插话失败");
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

  const running = Boolean(current && (current.status === "running" || current.status === "pending"));
  const isOne = (current?.personas?.length ?? 0) === 1;
  // 讨论未在进行中时，才能向某个人格「追问」（避免被实时推送的 load 覆盖流式气泡）
  const canFollowUp = !!current && !running && (current.status === "done" || current.status === "failed");
  const personaNames = new Set((current?.personas ?? []).map((p) => p.name));
  // 隐藏"人格设定/参考资料"（role=skill）这类内部消息，不占用聊天气泡
  const visibleMessages = current?.messages.filter((m) => m.role !== "skill") ?? [];
  const processTurns = eventStream.process.turns;
  const pendingApproval = eventStream.process.pendingApprovals[0];
  const approvalToolInput = pendingApproval?.callId
    ? processTurns
      .flatMap((turn) => turn.tools)
      .find((tool: DshToolView) => tool.callId === pendingApproval.callId)?.input
    : undefined;
  const renderedTurnKeys = new Set<string>();

  const processTurnForMessage = (message: Msg) => {
    if (message.role === "user" || message.role === "summary") return undefined;
    const bySession = message.sessionId
      ? processTurns.filter((turn) => turn.sessionId === message.sessionId)
      : processTurns;
    return bySession.find((turn) => turn.turnNumber === message.turn && !renderedTurnKeys.has(turn.key))
      ?? bySession.find((turn) => turn.hasFinalMessage && !renderedTurnKeys.has(turn.key));
  };

  return (
    <div className="mx-auto h-[calc(100vh-44px)] max-w-[1500px] px-4 sm:px-6">
      {/* 发起讨论（仅非查看模式） */}
      {!viewId && (
        <div
          className={cn(
            "mb-6 rounded-lg border border-hairline bg-white p-6 transition-shadow",
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
            className="w-full resize-y rounded-lg border border-hairline p-3 text-caption leading-[1.6] text-ink outline-none focus:border-primary"
          />

          {/* 引用文件（上传资料） */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-sm border border-hairline bg-white px-3 py-1.5 text-caption text-ink-60 transition-colors hover:border-primary/40 hover:text-ink"
            >
              {uploading ? <SpinnerGap size={14} className="animate-spin" /> : <Plus size={14} weight="bold" />}
              引用文件
            </button>
            {attachment && (
              <span className="flex items-center gap-2 rounded-sm bg-parchment px-3 py-1.5 text-caption text-ink-60">
                <FilePdf size={15} className="shrink-0 text-error" />
                <span className="max-w-[240px] truncate">{attachment.filename}</span>
                <span className="text-fine text-ink-40">
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
            <span className="text-fine text-ink-40">可拖拽或上传 PDF / TXT / MD</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {personas.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-caption transition-colors",
                    on ? "border-primary bg-primary/10 text-primary" : "border-hairline text-ink-60 hover:border-primary/40"
                  )}
                >
                  <Avatar name={p.name} size="sm" />
                  {p.name}
                </button>
              );
            })}
          </div>

          {/* 普通技能（可选，作为 DSH allowlist） */}
          {skills.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-fine font-semibold text-ink-48">可选技能（运行时按需加载，作为当前讨论的 allowlist）</div>
              <div className="flex flex-wrap gap-2">
                {skills.map((s) => {
                  const on = selectedSkills.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleSkill(s.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-fine transition-colors",
                        on ? "border-primary bg-primary/10 text-primary" : "border-hairline text-ink-60 hover:border-primary/40"
                      )}
                    >
                      {s.name} <span className="opacity-60">· {s.version}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-caption text-ink-60">
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
                    className="h-9 rounded-sm border border-hairline px-2 text-caption outline-none focus:border-primary"
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
          {error && !current && <p className="mt-2 text-caption text-error">{error}</p>}
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
          <div className="h-48 animate-pulse rounded-lg bg-pearl" />
        )
      ) : (
          <div className="relative flex h-full">
            {/* 左列：聊天（无顶部标题栏） */}
            <div className="flex min-w-0 flex-1 flex-col">
              {error && (
                <div role="alert" className="mx-4 mt-3 rounded-lg border border-error/20 bg-error/5 px-4 py-3 text-caption text-error">
                  <div className="font-semibold">本次回答未完成</div>
                  <div className="mt-1 break-words text-fine leading-5">{error}</div>
                </div>
              )}
              {eventStream.streamError && (
                <div role="status" className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 text-fine text-ink-60">
                  <SpinnerGap size={14} className="animate-spin text-warning" />
                  {eventStream.streamError}
                </div>
              )}
              <div
                ref={scrollRef}
                className="flex-1 space-y-6 overflow-y-auto bg-parchment px-6 py-6"
              >
                {visibleMessages.length === 0 && processTurns.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ChatCircleDots size={22} weight="duotone" />
                    </div>
                    <p className="text-caption text-ink-48">
                      {isOne ? `向 ${current.personas?.[0]?.name ?? "专家"} 提问，开始一对一交流` : "专家们正在陆续登场…"}
                    </p>
                  </div>
                ) : (
                  visibleMessages.map((m, idx) => {
                    if (m.role === "summary") {
                      return (
                        <div key={m.id} className="mx-auto max-w-[85%] rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-caption text-ink-80">
                          <div className="mb-1.5 flex items-center gap-1.5 text-fine font-semibold text-success-ink">
                            <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-success-ink/15">📋</span> 总结
                          </div>
                          <Markdown>{m.content}</Markdown>
                        </div>
                      );
                    }
                    const processTurn = processTurnForMessage(m);
                    if (processTurn) renderedTurnKeys.add(processTurn.key);
                    const isUser = m.role === "user";
                    const time = new Date(m.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
                    const prev = visibleMessages[idx - 1];
                    const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
                    return (
                      <Fragment key={m.id}>
                        {processTurn && <DshTurnProcess turn={processTurn} />}
                        {newDay && (
                          <div className="flex items-center gap-3 py-2">
                            <div className="h-px flex-1 bg-hairline/70" />
                            <span className="text-fine font-semibold tracking-wide text-ink-40">
                              {dayLabel(m.createdAt)} {time}
                            </span>
                            <div className="h-px flex-1 bg-hairline/70" />
                          </div>
                        )}
                        <div className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}>
                          <Avatar name={isUser ? "我" : m.sender} size="sm" className="mt-1" />
                          <div className={cn("max-w-[76%]", isUser && "text-right")}>
                            <div className={cn("mb-1 flex items-baseline gap-1.5 text-fine text-ink-40", isUser && "justify-end")}>
                              <span className="font-semibold">{isUser ? "我" : m.sender}</span>
                              <span className="text-ink-40/60">{time}</span>
                            </div>
                            <div
                              className={cn(
                                "inline-block rounded-lg px-4 py-2.5 text-left text-caption",
                                isUser
                                  ? "bg-primary text-white rounded-lg rounded-tr-sm"
                                  : "bg-white text-ink rounded-lg rounded-tl-sm"
                              )}
                            >
                              <Markdown names={personaNames} tone={isUser ? "dark" : "light"}>
                                {m.content}
                              </Markdown>
                              {m.streaming && (
                                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-ink-60 align-middle" />
                              )}
                            </div>
                          </div>
                        </div>
                      </Fragment>
                    );
                  })
                )}
                {processTurns.filter((turn) => !renderedTurnKeys.has(turn.key)).map((turn) => (
                  <DshTurnProcess key={turn.key} turn={turn} />
                ))}
                {running && processTurns.length === 0 && (
                  <div className="flex items-center gap-2 py-1 text-fine text-ink-40">
                    <PaperPlaneTilt size={14} className="animate-pulse" />
                    {isOne ? "正在启动 DSH 会话…" : "讨论正在启动…"}
                  </div>
                )}
              </div>

              {/* 底部输入条（独立一层）：圆角卡片，左右留白 */}
              <div className="bg-parchment px-4 pb-3.5 pt-2">
                {pendingApproval && (
                  <DshApprovalPanel
                    discussionId={current.id}
                    approval={pendingApproval}
                    toolInput={approvalToolInput}
                  />
                )}
                <div className="rounded-lg border border-hairline bg-white transition-[border-color,box-shadow] focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/10">
                  <div className="relative flex items-end gap-2 p-2">
                    {!isOne && mentionQuery !== null && mentionOptions.length > 0 && (
                      <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-lg border border-hairline bg-white shadow-float">
                        <div className="border-b border-divider-soft px-3 py-1.5 text-fine text-ink-40">选择要 @ 的成员</div>
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
                                <div className="text-caption font-semibold text-ink">{p.name}</div>
                                <div className="text-fine text-ink-40">{TYPE_LABEL[p.perspectiveType] ?? p.perspectiveType}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <input
                      ref={steerRef}
                      value={steer}
                      disabled={Boolean(pendingApproval)}
                      onChange={handleSteerChange}
                      placeholder={
                        followUp
                          ? `向 ${followUp.name} 追问（带上这场讨论）…`
                          : isOne
                          ? `向 ${current.personas?.[0]?.name ?? "专家"} 提问…`
                          : "插一句，用 @ 点名：「@乔布斯 如果成本砍半呢？」"
                      }
                      onKeyDown={(e) => {
                        if (followUp) {
                          if (e.key === "Escape") { setFollowUp(null); e.preventDefault(); return; }
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendSteer(); }
                          return;
                        }
                        if (!isOne && mentionQuery !== null && mentionOptions.length > 0) {
                          if (e.key === "Escape") { setMentionQuery(null); e.preventDefault(); return; }
                          if (e.key === "Enter") { e.preventDefault(); insertMention(mentionOptions[0].name); return; }
                        } else if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendSteer();
                        }
                      }}
                      className="h-10 flex-1 bg-transparent px-1 text-caption text-ink outline-none placeholder:text-ink-40 focus-visible:outline-none focus-visible:ring-0"
                    />
                    <button
                      type="button"
                      onClick={sendSteer}
                      disabled={sending || Boolean(pendingApproval) || !steer.trim()}
                      aria-label={isOne ? "发送" : "插话"}
                      title={isOne ? "发送" : "插话"}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-all duration-150 hover:bg-primary-focus active:scale-95 disabled:opacity-45"
                    >
                      {sending ? <SpinnerGap size={17} weight="bold" className="animate-spin" /> : <ArrowUp size={17} weight="bold" />}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-divider-soft px-3 py-1.5 text-fine text-ink-40">
                    <div className="flex min-w-0 items-center gap-3">
                      <span>Enter 发送 · Shift+Enter 换行</span>
                      <DiscussionPermissionControl
                        discussionId={current.id}
                        permissionMode={current.permissionMode}
                        approvalPolicy={current.approvalPolicy}
                        busy={running || Boolean(pendingApproval)}
                        onUpdated={(value) => setCurrent((prev) => (prev ? { ...prev, ...value } : prev))}
                      />
                      <button
                        type="button"
                        onClick={() => setPanelOpen((o) => !o)}
                        aria-expanded={panelOpen}
                        aria-controls="discussion-side-panel"
                        className="flex items-center gap-1 text-primary transition-colors hover:text-primary-hover lg:hidden"
                      >
                        <UsersThree size={13} />
                        {panelOpen ? "收起面板" : "参与人 / 产物"}
                      </button>
                    </div>
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" /> 专家在线
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 右侧：标题 + 参与人 + 产物/引用。≤1024px 浮为抽屉，由底部输入条的按钮开合 */}
            <aside
              id="discussion-side-panel"
              className={cn(
                "flex w-[320px] max-w-[85vw] shrink-0 flex-col border-l border-hairline bg-white",
                "max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:shadow-overlay",
                panelOpen ? "max-lg:flex" : "max-lg:hidden"
              )}
            >
              {/* 上：标题 + id + 总结 */}
              <div className="border-b border-divider-soft bg-white px-4 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-fine font-semibold",
                      isOne ? "bg-primary/10 text-primary" : "bg-parchment text-ink-60"
                    )}
                  >
                    {isOne ? "1 对 1" : "多人"}
                  </span>
                  <div className="truncate text-caption font-semibold tracking-[-0.2px] text-ink">
                    {isOne ? `${current.personas?.[0]?.name ?? "专家"}` : `讨论：${current.brief.slice(0, 30)}…`}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-fine text-ink-48">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          current.status === "running" || running ? "bg-success" : current.status === "done" ? "bg-primary/50" : "bg-ink-40"
                        )}
                      />
                      {current.status === "done" && "已结束"}
                      {current.status === "failed" && "失败"}
                      {running && !isOne && "讨论中"}
                      {isOne && (running ? "DSH 会话运行中" : "一对一交流")}
                      {!isOne && !running && `${current.rounds} 轮`}
                    </span>
                    <CopyId id={current.shortId} />
                  </div>
                  <Button variant="dark" size="sm" onClick={summarize} disabled={summarizing || visibleMessages.length === 0}>
                    {summarizing ? "总结中…" : "总结"}
                  </Button>
                </div>
              </div>

              {/* 中：参与人 */}
              <div className="flex min-h-0 flex-[1.1] flex-col">
                <div className="flex items-center gap-2 border-b border-divider-soft bg-pearl px-4 py-3 text-fine font-semibold uppercase tracking-wide text-ink-40">
                  <UsersThree size={14} /> {isOne ? "交流对象" : "参与人"}（{current.personas?.length ?? 0}）
                </div>
                <div className="flex-1 space-y-1 overflow-y-auto bg-pearl p-2">
                  {(current.personas ?? []).map((p) => (
                    <div key={p.id} className="flex items-center gap-2.5 rounded-sm px-3 py-2 hover:bg-parchment/70">
                      <Avatar name={p.name} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-caption font-semibold text-ink">{p.name}</div>
                        <div className="text-fine text-ink-40">{TYPE_LABEL[p.perspectiveType] ?? p.perspectiveType}</div>
                      </div>
                      {canFollowUp && (
                        <button
                          onClick={() => {
                            setFollowUp({ personaId: p.id, name: p.name });
                            setMentionQuery(null);
                            steerRef.current?.focus();
                          }}
                          className={cn(
                            "ml-auto shrink-0 rounded-full px-2.5 py-1 text-fine transition-colors",
                            followUp?.personaId === p.id
                              ? "bg-primary text-white"
                              : "border border-hairline text-ink-60 hover:border-primary/40 hover:text-primary"
                          )}
                        >
                          {followUp?.personaId === p.id ? "追问中…" : "追问"}
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-2.5 rounded-sm px-3 py-2 hover:bg-parchment/70">
                    <Avatar name="我" size="sm" />
                    <div>
                      <div className="text-caption font-semibold text-ink">我</div>
                      <div className="text-fine text-ink-40">主持人 · {isOne ? "提问" : "可插话"}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 下：产物与引用 */}
              <div className="flex min-h-0 flex-[1] flex-col border-t border-divider-soft">
                <div className="flex items-center gap-2 border-b border-divider-soft bg-pearl px-4 py-3 text-fine font-semibold uppercase tracking-wide text-ink-40">
                  <FileText size={14} /> 产物与引用
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto bg-parchment/40 p-3">
                  {current.attachmentName && (
                    <div className="flex items-center gap-2.5 rounded-sm border border-hairline bg-white p-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
                        <FilePdf size={16} weight="duotone" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-caption font-semibold text-ink">{current.attachmentName}</div>
                        <div className="text-fine text-ink-48">已读取 {current.attachmentCharCount ?? 0} 字{current.attachmentTruncated ? "（截取）" : ""}</div>
                      </div>
                    </div>
                  )}
                  {current.artifacts && current.artifacts.length > 0 ? (
                    <div className="space-y-2.5">
                      {current.artifacts.map((a) => (
                        <div key={a.id} className="rounded-sm border border-hairline bg-white p-2.5">
                          <div className="truncate text-caption font-semibold text-ink">{a.title}</div>
                          {a.summary && (
                            <div className="mt-0.5 line-clamp-2 text-fine leading-[1.5] text-ink-48">{a.summary}</div>
                          )}
                          <div className="mt-1.5 flex items-center gap-3 text-fine">
                            <button onClick={() => setViewArtifact(a)} className="font-semibold text-primary hover:underline">查看</button>
                            <button onClick={() => downloadArtifact(a)} className="text-ink-60 hover:text-primary">下载 md</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-hairline bg-parchment/50 px-3 py-3 text-fine text-ink-48">
                      <FileText size={14} className="text-ink-40" /> 点「总结」生成 md 报告
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
      )}

      {/* 产物预览：统一走 Modal 基元（role=dialog / Escape / 焦点陷阱） */}
      <Modal
        open={Boolean(viewArtifact)}
        onClose={() => setViewArtifact(null)}
        title={viewArtifact?.title ?? ""}
        description={
          viewArtifact
            ? `Markdown 报告 · ${new Date(viewArtifact.createdAt).toLocaleString("zh-CN", { hour12: false })}`
            : undefined
        }
        headerAction={
          <Button variant="ghost" size="sm" onClick={() => viewArtifact && downloadArtifact(viewArtifact)}>
            下载 md
          </Button>
        }
      >
        <div className="bg-parchment/30 p-5">
          <pre className="whitespace-pre-wrap text-caption leading-[1.7] text-ink">
            {viewArtifact?.content}
          </pre>
        </div>
      </Modal>

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

// useSearchParams() 需在页面内包一层 <Suspense>（Next 16 预渲染要求）
export default function DiscussionsPage() {
  return (
    <Suspense fallback={null}>
      <DiscussionsContent />
    </Suspense>
  );
}
