"use client";

import { GearSix, ShieldCheck, Sparkle } from "@phosphor-icons/react";
import { LLMSettingsForm } from "@/components/settings/llm-form";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GearSix size={22} weight="duotone" />
          </div>
          <div>
            <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.4px]">设置</h1>
            <p className="text-[13px] text-ink-48">配置大模型服务，填入 API Key 后即可运行配方</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-hairline bg-white">
          <div className="flex items-center gap-2 border-b border-divider-soft px-6 py-4">
            <Sparkle size={16} className="text-primary" />
            <h2 className="text-[15px] font-semibold">模型服务</h2>
          </div>
          <div className="p-6">
            <LLMSettingsForm />
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-hairline bg-pearl px-5 py-4">
          <ShieldCheck size={18} className="shrink-0 text-success" />
          <p className="text-[12px] leading-[1.6] text-ink-48">
            API Key 在本机加密存储（AES-256-GCM），不随请求下发、明文不落盘。数据仅保存在本地。
          </p>
        </div>
      </div>
    </div>
  );
}
