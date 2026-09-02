"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogPanel } from "@/components/skills/log-panel";

interface Candidate {
  file: string;
  name: string;
  description: string | null;
  instructions: string;
  sourceRef: string;
}

interface JobState {
  jobId: string;
  status: "running" | "done" | "failed";
  logs: string[];
  candidates: Candidate[];
  error: string | null;
}

/** UX 4.2.1 npx 导入弹窗：命令输入 → 确认执行 → 日志 → 解析结果勾选入库 */
export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [command, setCommand] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const close = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    onClose();
  };

  const execute = async () => {
    setClientError(null);
    if (!command.trim()) {
      setClientError("请输入 npx 命令");
      return;
    }
    try {
      const res = await fetch("/api/v1/skills/import/npx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const d = await res.json();
      if (d.code !== 0) {
        setClientError(d.message ?? "启动失败");
        return;
      }
      setJob({ jobId: d.data.jobId, status: "running", logs: [], candidates: [], error: null });
      pollRef.current = setInterval(() => poll(d.data.jobId), 2000);
    } catch {
      setClientError("启动失败");
    }
  };

  const poll = async (jobId: string) => {
    try {
      const res = await fetch(`/api/v1/skills/import/${jobId}`);
      const d = await res.json();
      if (d.code !== 0) {
        if (pollRef.current) clearInterval(pollRef.current);
        setJob((j) => (j ? { ...j, status: "failed", error: d.message } : j));
        return;
      }
      setJob({
        jobId,
        status: d.data.status,
        logs: d.data.logs ?? [],
        candidates: d.data.candidates ?? [],
        error: d.data.error ?? null,
      });
      if (d.data.status !== "running") {
        if (pollRef.current) clearInterval(pollRef.current);
        setSelected((d.data.candidates ?? []).map((c: Candidate) => c.file));
      }
    } catch {
      // 轮询失败时保留当前状态，下次轮询重试
    }
  };

  const confirmImport = async () => {
    if (!job) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/v1/skills/import/${job.jobId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedFiles: selected }),
      });
      const d = await res.json();
      if (d.code === 0) {
        onImported();
        close();
      } else {
        setClientError(d.message ?? "导入失败");
      }
    } catch {
      setClientError("导入失败");
    } finally {
      setImporting(false);
    }
  };

  if (!job) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
        <div className="bg-white rounded-lg w-full max-w-2xl p-8 max-h-[85vh] overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[21px] font-semibold tracking-[0.231px]">通过 npx 导入 Skill</h2>
            <button className="text-ink-48 hover:text-ink text-[20px]" onClick={close} aria-label="关闭">
              ✕
            </button>
          </div>
          <div className="grid gap-2 mb-4">
            <label className="text-[14px] font-semibold text-ink-80">命令</label>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx skills add pricing-model"
              onKeyDown={(e) => {
                if (e.key === "Enter") execute();
              }}
            />
            <p className="text-[12px] text-warning">⚠ 将执行上方命令（最长 120 秒），请确认来源可信。仅支持以 npx 开头的命令。</p>
          </div>
          {clientError && <p className="text-[14px] text-error mb-3">{clientError}</p>}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={close}>
              取消
            </Button>
            <Button onClick={execute}>确认执行 ▶</Button>
          </div>
        </div>
      </div>
    );
  }

  const running = job.status === "running";
  const failed = job.status === "failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
      <div className="bg-white rounded-lg w-full max-w-2xl p-8 max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[21px] font-semibold tracking-[0.231px]">通过 npx 导入 Skill</h2>
          <button className="text-ink-48 hover:text-ink text-[20px]" onClick={close} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="grid gap-2 mb-4">
          <label className="text-[14px] font-semibold text-ink-80">命令</label>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npx skills add pricing-model"
            disabled={running}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !running) execute();
            }}
          />
          <p className="text-[12px] text-warning">⚠ 将执行上方命令（最长 120 秒），请确认来源可信。仅支持以 npx 开头的命令。</p>
        </div>

        {clientError && <p className="text-[14px] text-error mb-3">{clientError}</p>}

        {!job && (
          <div className="flex justify-end">
            <Button onClick={execute}>确认执行 ▶</Button>
          </div>
        )}

        {job && (
          <>
            <div className="grid gap-2 mb-4">
              <div className="flex items-center justify-between">
                <label className="text-[14px] font-semibold text-ink-80">执行日志</label>
                {job.status === "done" && <span className="text-[12px] text-success">✓ 执行完成</span>}
                {failed && <span className="text-[12px] text-error">✗ 执行失败</span>}
                {running && <span className="text-[12px] text-primary animate-pulse">执行中…</span>}
              </div>
              <LogPanel logs={job.logs} failed={failed} />
            </div>

            {job.status === "done" && (
              <div className="grid gap-3 mb-4">
                <label className="text-[14px] font-semibold text-ink-80">解析结果（勾选入库）</label>
                {job.candidates.length === 0 ? (
                  <p className="text-[14px] text-ink-48">未在临时目录发现 SKILL.md 文件。</p>
                ) : (
                  job.candidates.map((c) => (
                    <label
                      key={c.file}
                      className="flex items-start gap-3 bg-pearl border border-hairline rounded-lg p-4 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(c.file)}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked ? [...prev, c.file] : prev.filter((f) => f !== c.file)
                          )
                        }
                        className="mt-1 accent-[#0066cc]"
                      />
                      <div>
                        <div className="text-[15px] font-semibold">{c.name}</div>
                        {c.description && <div className="text-[13px] text-ink-48">{c.description}</div>}
                        <div className="text-[12px] text-ink-48 mt-1">{c.file}</div>
                      </div>
                    </label>
                  ))
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              {running ? (
                <Button variant="secondary" onClick={close}>
                  关闭
                </Button>
              ) : job.status === "done" ? (
                <>
                  <Button variant="secondary" onClick={close}>
                    取消
                  </Button>
                  <Button onClick={confirmImport} disabled={selected.length === 0 || importing}>
                    {importing ? "导入中…" : `导入选中项（${selected.length}）`}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setJob(null)}>
                    修改命令重试
                  </Button>
                  <Button variant="dark" onClick={close}>
                    关闭
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
