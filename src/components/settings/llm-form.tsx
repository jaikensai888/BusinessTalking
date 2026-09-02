"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OPENAI_PRESETS, PROVIDERS } from "@/lib/llm/constants";

type Settings = {
  provider: "openai" | "anthropic";
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyMasked: string | null;
  models: string[];
  defaultModel: string;
  timeoutSeconds: number;
};

type Status = { kind: "info" | "ok" | "error"; text: string } | null;

/** 设置页 LLM 配置表单（UX 4.10）：双 provider + baseURL + 多模型 */
export function LLMSettingsForm() {
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const parseModels = (t: string) =>
    t
      .split("\n")
      .map((m) => m.trim())
      .filter(Boolean);

  useEffect(() => {
    fetch("/api/v1/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          const llm: Settings = d.data.llm;
          setProvider(llm.provider);
          setBaseUrl(llm.baseUrl ?? "");
          setModelsText(llm.models.join("\n"));
          setDefaultModel(llm.defaultModel ?? "");
          setTimeoutSeconds(llm.timeoutSeconds);
          setApiKeyConfigured(llm.apiKeyConfigured);
        }
      })
      .catch(() => setStatus({ kind: "error", text: "加载配置失败" }));
  }, []);

  const models = parseModels(modelsText);

  const onModelsChange = (t: string) => {
    setModelsText(t);
    const m = parseModels(t);
    if (m.length > 0 && !m.includes(defaultModel)) setDefaultModel(m[0]);
  };

  const save = async () => {
    setSaving(true);
    setStatus(null);
    const cleaned = parseModels(modelsText);
    if (cleaned.length === 0) {
      setStatus({ kind: "error", text: "请至少填写一个模型" });
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/v1/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          baseUrl,
          apiKey,
          models: cleaned,
          defaultModel: defaultModel || cleaned[0],
          timeoutSeconds,
        }),
      });
      const d = await res.json();
      if (d.code === 0) {
        setApiKeyConfigured(true);
        setApiKey("");
        setStatus({ kind: "ok", text: "已保存" });
      } else {
        setStatus({ kind: "error", text: d.message ?? "保存失败" });
      }
    } catch {
      setStatus({ kind: "error", text: "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const res = await fetch("/api/v1/settings/test", { method: "POST" });
      const d = await res.json();
      if (d.code === 0) {
        setStatus({ kind: "ok", text: `连接成功（${d.data.latencyMs}ms）` });
      } else {
        setStatus({ kind: "error", text: d.message ?? "连接失败" });
      }
    } catch {
      setStatus({ kind: "error", text: "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-2">
        <label className="text-[14px] font-semibold text-ink-80">服务商</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as "openai" | "anthropic")}
          className="h-11 bg-white border border-hairline rounded-lg px-3 text-[15px] outline-none focus:border-primary"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-[12px] text-ink-48">{PROVIDERS.find((p) => p.value === provider)?.description}</p>
      </div>

      {provider === "openai" && (
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">接口地址（Base URL）</label>
          <div className="flex gap-2">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
            {OPENAI_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setBaseUrl(p.baseUrl)}
                className="shrink-0 rounded-lg border border-hairline px-3 py-2 text-[13px] text-ink-60 transition-colors hover:border-primary/40 hover:text-ink"
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-ink-48">DeepSeek 等 OpenAI 兼容服务：选 DeepSeek，下方模型填 deepseek-v4-flash 等。</p>
        </div>
      )}

      <div className="grid gap-2">
        <label className="text-[14px] font-semibold text-ink-80">API Key</label>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={apiKeyConfigured ? "已配置（留空则不修改）" : "sk-…"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Button variant="dark" onClick={test} disabled={testing}>
            {testing ? "测试中…" : "测试连接"}
          </Button>
        </div>
        {apiKeyConfigured && !apiKey && (
          <p className="text-[12px] text-ink-48">已保存过 Key，输入新 Key 可覆盖。</p>
        )}
      </div>

      <div className="grid gap-2">
        <label className="text-[14px] font-semibold text-ink-80">
          模型列表（每行一个，可填多个）{" "}
          <span className="font-normal text-ink-40">如 deepseek-v4-flash / deepseek-v4-pro / deepseek-v4-flash-vision-exp</span>
        </label>
        <textarea
          value={modelsText}
          onChange={(e) => onModelsChange(e.target.value)}
          rows={4}
          placeholder={"deepseek-v4-flash\ndeepseek-v4-pro\ndeepseek-v4-flash-vision-exp"}
          className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[15px] font-mono outline-none focus:border-primary resize-y"
        />
      </div>

      {models.length > 0 && (
        <div className="grid gap-2">
          <label className="text-[14px] font-semibold text-ink-80">默认模型</label>
          <select
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            className="bg-white border border-hairline rounded-[8px] px-3 py-2 text-[17px] outline-none focus:border-primary"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <p className="text-[12px] text-ink-48">分析运行默认使用该模型（后续可按配方/步骤覆盖）。</p>
        </div>
      )}

      <div className="grid gap-2">
        <label className="text-[14px] font-semibold text-ink-80">超时时间（秒）</label>
        <Input
          type="number"
          min={30}
          max={600}
          value={timeoutSeconds}
          onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
        />
      </div>

      {status && (
        <p
          className={
            status.kind === "ok"
              ? "text-[14px] text-success"
              : status.kind === "error"
                ? "text-[14px] text-error"
                : "text-[14px] text-ink-48"
          }
        >
          {status.text}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}
