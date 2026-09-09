"use client";

import { Fragment, Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUp, ChatCircleDots, FilePdf, FileText, Plus, SpinnerGap, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getOneOnOneFailure, hasNewPersonaReply, isOneOnOneReplyPending } from "@/lib/discussion/live-state";
import { MentionList, useMentionNavigation } from "@/components/ui/mention-list";
import { composerStatus, composerTarget } from "@/lib/discussion/composer-state";
import { useDiscussionEvents } from "@/hooks/use-discussion-events";
import type { DshToolView } from "@/lib/discussion/dsh-turn-projection";
import { assignProcessTurns } from "@/lib/discussion/message-order";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { CopyId } from "@/components/ui/copy-id";
import { Markdown } from "@/components/ui/markdown";
import { DshApprovalPanel } from "@/components/discussions/dsh-approval-panel";
import { DshTurnProcess } from "@/components/discussions/dsh-turn-process";
import { DiscussionPermissionControl } from "@/components/discussions/discussion-permission-control";
import { CopyText } from "@/components/discussions/message-actions";

interface PersonaOption { id: string; name: string; perspectiveType: string }
interface Msg { id: string; sender: string; role: string; turn: number; content: string; createdAt: string; sessionId?: string | null; streaming?: boolean }
interface Artifact { id: string; title: string; type: string; filePath?: string | null; summary?: string | null; content: string; createdAt: string }
interface ParticipantState { id: string; personaId: string; dshSessionId?: string; status: string; lastError?: string | null }
interface Discussion {
  id: string;
  brief: string;
  rounds: number;
  status: string;
  permissionMode?: string;
  approvalPolicy?: string;
  eventCursor?: number;
  discussionState?: { round: number } | null;
  personas: PersonaOption[];
  participants?: ParticipantState[];
  messages: Msg[];
  artifacts?: Artifact[];
  attachmentName?: string | null;
  attachmentCharCount?: number | null;
  attachmentTruncated?: boolean | null;
  shortId?: string | null;
}

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
  const steerRef = useRef<HTMLTextAreaElement | null>(null);
  const followScrollRef = useRef(true);
  const [hasNewUpdates, setHasNewUpdates] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"members" | "files">("members");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [viewArtifact, setViewArtifact] = useState<Artifact | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachment, setAttachment] = useState<{ filename: string; charCount: number; truncated: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [followUp, setFollowUp] = useState<{ personaId: string; name: string } | null>(null);
  /** ≤1024px 时右侧「参与人 / 产物」面板浮为抽屉，默认收起 */
  const [panelOpen, setPanelOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeArtifact = useCallback(() => setViewArtifact(null), []);

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
        // 默认全选已安装 skill：新装技能（如 humanizer）对所有新讨论 session 自动生效，可手动取消
        setSelectedSkills(revs.map((r) => r.id));
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
    if (followScrollRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    else setHasNewUpdates(true);
  }, [current?.messages.length, eventStream.process.turns.length, eventStream.process.cursor]);

  useEffect(() => {
    const input = steerRef.current;
    if (input) { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 168) + "px"; }
  }, [steer]);

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
    if (!current || !steer.trim() || sending || eventStream.process.pendingApprovals.length > 0) return;
    followScrollRef.current = true;
    setHasNewUpdates(false);
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
    } catch {
      setError("发送失败，请检查连接后重试");
      setSteer((draft) => draft || question);
    } finally {
      setSending(false);
    }
  };

  const summarize = async () => {
    if (!current || summarizing) return;
    setSummarizing(true);
    try {
      const res = await fetch(`/api/v1/discussions/${current.id}/summary`, { method: "POST" });
      const d = await res.json();
      if (d.code === 0) { void load(current.id); setDetailTab("files"); setPanelOpen(true); }
      else setError(d.message ?? "生成总结失败");
    } catch { setError("生成总结失败，请检查连接后重试"); }
    finally { setSummarizing(false); }
  };

  // @ 提及：输入时检测光标前的 "@",弹出成员选择
  const handleSteerChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
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

  useEffect(() => {
    const input = steerRef.current;
    if (!input) return;
    const resize = () => { input.style.height = "0px"; input.style.height = `${Math.min(input.scrollHeight, 128)}px`; };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => { if (input.clientWidth !== width) { width = input.clientWidth; resize(); } });
    observer.observe(input);
    return () => observer.disconnect();
  }, [steer, current?.id]);

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

  const mentionVisible = !followUp && (current?.personas.length ?? 0) > 1 && mentionQuery !== null;
  const mentionNav = useMentionNavigation(mentionOptions, mentionVisible, (option) => insertMention(option.name), () => setMentionQuery(null));

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
  const processParticipants = (current?.participants ?? []).flatMap((participant) => {
    const persona = current?.personas.find((item) => item.id === participant.personaId);
    return participant.dshSessionId && persona
      ? [{ sessionId: participant.dshSessionId, personaName: persona.name }]
      : [];
  });
  const processAssignments = assignProcessTurns(visibleMessages, processTurns, processParticipants);
  const processTurnsByKey = new Map(processTurns.map((turn) => [turn.key, turn]));
  const assignedTurnKeys = new Set(processAssignments.values());

  const nameForSession = (sessionId: string) => {
    const participant = current?.participants?.find((p) => p.dshSessionId === sessionId);
    return current?.personas.find((p) => p.id === participant?.personaId)?.name
      ?? current?.messages.find((m) => m.sessionId === sessionId && m.role === "persona")?.sender
      ?? "讨论主持人";
  };
  const participantStatus = (personaId: string) => {
    const participant = current?.participants?.find((p) => p.personaId === personaId);
    if (pendingApproval?.sessionId === participant?.dshSessionId && pendingApproval) return "等待批准";
    const turn = processTurns.filter((t) => t.sessionId === participant?.dshSessionId).at(-1);
    if (turn?.status === "running") return turn.liveAnswer ? "正在回答" : "正在思考 / 查资料";
    return ({ pending: "等待开始", running: "正在处理", completed: "本轮完成", failed: "回答失败", archived: "已归档" } as Record<string, string>)[participant?.status ?? ""] ?? "等待开始";
  };
  const discussionStatus = pendingApproval ? "等待批准" : running ? "讨论进行中" : current?.status === "failed" ? "讨论未完成" : "可继续提问";
  const composerRecipient = followUp?.name ?? (isOne ? current?.personas[0]?.name ?? "专家" : "所有人");
  const composerTargetLabel = composerTarget({
    followUpName: followUp?.name,
    isOne,
    personaName: current?.personas[0]?.name ?? "专家",
  });
  const composerStatusLabel = composerStatus({ pendingApproval: Boolean(pendingApproval), sending });
  const roundNumber = Math.max(current?.discussionState?.round ?? 0, ...processTurns.map((t) => t.turnNumber ?? 0), ...visibleMessages.filter((m) => m.role === "persona").map((m) => m.turn));
  const roundLabel = roundNumber > 0
    ? `第 ${roundNumber} / ${current?.rounds ?? 0} 轮`
    : current?.status === "done" ? "讨论已结束" : current?.status === "failed" ? "等待恢复" : "准备中";
  const quoteMessage = (message: Msg) => {
    const persona = current?.personas.find((p) => p.name === message.sender);
    if (persona && canFollowUp) setFollowUp({ personaId: persona.id, name: persona.name });
    setSteer((draft) => (draft ? draft + "\n\n" : "") + (persona && !canFollowUp ? "@" + persona.name + " " : "") + "关于「" + message.content.slice(0, 180) + "」\n");
    steerRef.current?.focus();
  };

  return (
    <div className="mx-auto h-[calc(100dvh-44px)] max-w-[1500px] px-4 sm:px-6">
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

        <div className="flex h-full min-h-0 flex-col">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-hairline py-2">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-body font-semibold" title={current.brief}>{current.brief}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-fine text-ink-48" role="status">
                <span>{current.personas.length} 位专家</span><span>·</span><span>{discussionStatus}</span>
                {!isOne && <span>· {roundLabel}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="min-h-11 rounded-sm px-3 text-caption hover:bg-white" aria-expanded={panelOpen} aria-controls="discussion-side-panel" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? "收起详情" : "成员与资料"}</button>
              <button type="button" className="min-h-11 rounded-sm px-3 text-caption hover:bg-white" onClick={() => setSettingsOpen(true)}>设置</button>
              <Button size="sm" onClick={summarize} disabled={summarizing || visibleMessages.length === 0}>{summarizing ? "生成中…" : running ? "阶段总结" : "生成总结"}</Button>
            </div>
          </header>
          <div className="relative flex min-h-0 flex-1">
            <div className="relative flex min-w-0 flex-1 flex-col">
              {error && <div role="alert" className="mx-2 mt-3 rounded-md border border-error/20 bg-error/5 px-4 py-3 text-caption text-error"><strong>本次操作未完成</strong><p className="mt-1 break-words">{error}</p></div>}
              {eventStream.streamError && <div role="status" className="mx-2 mt-2 rounded-md bg-warning/10 px-4 py-2 text-caption">{eventStream.streamError}</div>}
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={(event) => {
                const el = event.currentTarget;
                followScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                if (followScrollRef.current) setHasNewUpdates(false);
              }}>
                <div className="mx-auto max-w-[1080px] space-y-3 px-2 py-3 sm:px-4">
                  {visibleMessages.length === 0 && processTurns.length === 0 && <div className="py-16 text-center text-caption text-ink-48">{running ? "正在准备讨论，专家回复将在这里显示…" : "提出你的问题，开始交流。"}</div>}
                  {visibleMessages.map((message, index) => {
                    if (message.role === "summary") return <article key={message.id} className="rounded-lg border border-primary/15 bg-white p-5 text-base"><div className="mb-3 text-caption font-semibold text-primary">讨论总结</div><Markdown>{message.content}</Markdown><CopyText text={message.content} label="复制总结" /></article>;
                    const processKey = processAssignments.get(message.id);
                    const process = processKey ? processTurnsByKey.get(processKey) : undefined;
                    const isUser = message.role === "user";
                    const previous = visibleMessages[index - 1];
                    return <Fragment key={message.id}>
                      {(!previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt)) && <div className="py-1 text-center text-fine text-ink-48">{dayLabel(message.createdAt)}</div>}
                      <article className={cn("min-w-0", isUser && "ml-auto max-w-[90%] sm:max-w-[80%]")}>
                        {process ? <DshTurnProcess turn={process} name={message.sender} /> : <div className={cn("mb-1 flex items-center gap-2 text-caption", isUser && "justify-end")}><Avatar name={isUser ? "我" : message.sender} size="sm" /><span className="font-semibold">{isUser ? "我" : message.sender}</span><time className="text-fine text-ink-48" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"})}</time></div>}
                        <div className={cn("mt-1 w-fit max-w-full rounded-lg px-3.5 py-2 text-base leading-6", isUser ? "ml-auto bg-primary text-white" : "bg-white text-ink")}>
                          <Markdown names={personaNames} tone={isUser ? "dark" : "light"}>{message.content}</Markdown>
                          {message.streaming && <span className="text-caption text-ink-48">正在回答…</span>}
                        </div>
                        <div className={cn("flex items-center gap-1", isUser && "justify-end")}><CopyText text={message.content} label="复制发言" compact />{!isUser && <button type="button" onClick={() => quoteMessage(message)} className="min-h-8 rounded-sm px-2 text-fine text-ink-48 hover:bg-white hover:text-primary">引用追问</button>}</div>
                      </article>
                    </Fragment>;
                  })}
                  {processTurns.filter((turn) => !assignedTurnKeys.has(turn.key)).map((turn) => <DshTurnProcess key={turn.key} turn={turn} name={nameForSession(turn.sessionId)} />)}
                </div>
              </div>
              {hasNewUpdates && <button type="button" className="absolute bottom-48 left-1/2 z-10 min-h-11 -translate-x-1/2 rounded-full border border-hairline bg-white px-4 text-caption text-primary shadow-float" onClick={() => { followScrollRef.current = true; setHasNewUpdates(false); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }}>有新回复 ↓</button>}
              <div className="mx-auto w-full max-w-[1080px] shrink-0 px-2 pb-2 pt-1 sm:px-4">
                {pendingApproval && <DshApprovalPanel discussionId={current.id} approval={pendingApproval} toolInput={approvalToolInput} />}
                <div className="rounded-lg border border-hairline bg-white p-2.5 transition-colors focus-within:border-primary/45 sm:p-3">
                  <div className="flex items-center justify-between gap-3 px-1.5 pb-2">
                    <div className="flex min-w-0 items-center gap-2 text-fine">
                      <Avatar name={composerRecipient} size="sm" />
                      <span className="truncate text-ink-60">{composerTargetLabel}</span>
                      {!isOne && !followUp && <span className="shrink-0 text-ink-40">· @ 点名</span>}
                      {(sending || pendingApproval) && <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-semibold", pendingApproval ? "bg-warning/12 text-warning-ink" : "bg-primary/10 text-primary")}>{composerStatusLabel.label}</span>}
                    </div>
                    {followUp && <button type="button" onClick={() => setFollowUp(null)} className="min-h-8 shrink-0 rounded-full bg-parchment px-2.5 text-fine text-ink-60 transition-colors hover:bg-primary/10 hover:text-primary">取消追问</button>}
                  </div>
                  <div className="relative flex items-end gap-2 rounded-md bg-parchment/45 px-2.5 py-2">
                    {mentionVisible && <div className="absolute bottom-full left-0 right-0 z-20 mb-2"><MentionList id="discussion-mentions" options={mentionOptions} activeIndex={mentionNav.activeIndex} onActivate={mentionNav.activate} onSelect={(option) => insertMention(option.name)} /></div>}
                    <textarea ref={steerRef} rows={1} aria-autocomplete="list" aria-controls={mentionVisible ? "discussion-mentions" : undefined} aria-activedescendant={mentionVisible && mentionOptions.length ? `discussion-mentions-${mentionNav.activeIndex}` : undefined} aria-label="讨论消息" aria-describedby="discussion-send-hint" value={steer} onChange={handleSteerChange} placeholder="写下你的问题或观点…" onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                      if (mentionNav.onKeyDown(event)) return;
                      if (event.key === "Escape") { setMentionQuery(null); setFollowUp(null); return; }
                      if (event.key !== "Enter" || event.shiftKey) return;
                      event.preventDefault();
                      void sendSteer();
                    }} className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-base leading-6 text-ink outline-none placeholder:text-ink-40 focus-visible:outline-none" />
                    <button type="button" onClick={sendSteer} disabled={sending || Boolean(pendingApproval) || !steer.trim()} aria-label={sending ? "等待回复" : pendingApproval ? "等待审批" : "发送消息"} className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors", sending || pendingApproval ? "bg-white text-ink-40" : "bg-primary text-white hover:bg-primary-hover", !steer.trim() && !sending && !pendingApproval && "bg-white text-ink-40")}>{sending ? <SpinnerGap size={17} className="animate-spin" /> : <ArrowUp size={19} weight="bold" />}</button>
                  </div>
                  <div id="discussion-send-hint" className="flex min-h-6 items-center gap-2 px-1.5 pt-2 text-fine" role="status">
                    {sending && <SpinnerGap size={12} className="shrink-0 animate-spin text-primary" />}
                    <span className={cn(pendingApproval ? "text-warning-ink" : sending ? "text-primary" : "text-ink-48")}>{composerStatusLabel.hint}</span>
                  </div>
                </div>
                <div className="mt-2 flex justify-between text-fine text-ink-48"><span>{eventStream.reconnecting ? "正在重新连接…" : eventStream.connected ? "实时同步已连接" : "正在连接…"}</span><span>AI 模拟视角</span></div>
              </div>
            </div>
            {panelOpen && <>
              <button type="button" aria-label="关闭讨论详情" onClick={() => setPanelOpen(false)} className="absolute inset-0 z-20 bg-black/20 lg:hidden" />
              <aside id="discussion-side-panel" aria-label="讨论详情" className="absolute inset-y-0 right-0 z-30 w-[300px] max-w-[90vw] overflow-y-auto border-l border-hairline bg-white p-4 lg:static lg:shrink-0" onKeyDown={(e) => { if (e.key === "Escape") setPanelOpen(false); }}>
                <div className="flex items-center justify-between"><span className="text-caption font-semibold">讨论详情</span><button type="button" aria-label="收起详情面板" onClick={() => setPanelOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-sm hover:bg-parchment"><X size={18} /></button></div>
                <div className="mb-4"><CopyId id={current.shortId} /></div>
                <div className="mb-4 flex rounded-md bg-parchment p-1">{(["members", "files"] as const).map((tab) => <button type="button" key={tab} aria-pressed={detailTab === tab} onClick={() => setDetailTab(tab)} className={cn("min-h-11 flex-1 rounded-sm text-caption", detailTab === tab && "bg-white font-semibold text-primary")}>{tab === "members" ? "成员" : "资料与总结"}</button>)}</div>
                {detailTab === "members" ? <div className="space-y-4">{current.personas.map((p) => <div key={p.id} className="flex items-start gap-3"><Avatar name={p.name} size="sm" /><div className="min-w-0 flex-1"><div className="text-caption font-semibold">{p.name}</div><p className="mt-1 text-fine text-ink-48">{participantStatus(p.id)}</p>{canFollowUp && <button type="button" className="min-h-11 text-fine text-primary" onClick={() => { setFollowUp({personaId:p.id,name:p.name}); setPanelOpen(false); steerRef.current?.focus(); }}>向他追问</button>}</div></div>)}<p className="border-t border-divider-soft pt-3 text-fine text-ink-48">你是这场讨论的主持人，可以随时写下问题。</p></div> : <div className="space-y-3">{current.attachmentName && <div className="rounded-md bg-parchment p-3 text-caption"><FileText size={18} /><p className="mt-2 break-words">{current.attachmentName}</p><p className="mt-1 text-fine text-ink-48">已读取 {current.attachmentCharCount ?? 0} 字</p></div>}{current.artifacts?.map((artifact) => <article key={artifact.id} className="rounded-md border border-hairline p-3"><h2 className="text-caption font-semibold">{artifact.title}</h2><p className="mt-1 text-fine text-ink-48">{artifact.summary}</p><div className="mt-2 flex gap-3"><button type="button" onClick={() => setViewArtifact(artifact)} className="min-h-11 text-caption text-primary">阅读</button><button type="button" onClick={() => downloadArtifact(artifact)} className="min-h-11 text-caption text-ink-48">下载 Markdown</button></div></article>)}{!current.attachmentName && !current.artifacts?.length && <p className="py-4 text-caption text-ink-48">还没有资料。生成的讨论总结会保存在这里。</p>}</div>}
              </aside>
            </>}
          </div>
        </div>
      )}

      {/* 产物预览：统一走 Modal 基元（role=dialog / Escape / 焦点陷阱） */}
      <Modal
        open={Boolean(viewArtifact)}
        onClose={closeArtifact}
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
          <Markdown className="text-base leading-7">{viewArtifact?.content ?? ""}</Markdown>
        </div>
      </Modal>

      <Modal open={settingsOpen} onClose={closeSettings} title="讨论设置" description="工具权限与审批策略">
        <div className="p-5">{current && <DiscussionPermissionControl discussionId={current.id} permissionMode={current.permissionMode} approvalPolicy={current.approvalPolicy} busy={running || Boolean(pendingApproval)} onUpdated={(value) => setCurrent((prev) => prev ? {...prev, ...value} : prev)} />}</div>
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
