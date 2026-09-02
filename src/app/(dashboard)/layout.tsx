"use client";

import { useEffect, useState } from "react";
import { FloppyDisk, SidebarSimple } from "@phosphor-icons/react";
import { Sidebar } from "@/components/layout/sidebar";

const STORAGE_KEY = "fl-sidebar-collapsed";

/** 主界面布局（精修）：全局黑色导航 44px（含侧边栏隐藏按钮）+ 可折叠侧边栏 + 内容区 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // 挂载后读取本地折叠偏好（客户端专属，避免 hydration 不一致）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-hairline bg-pearl px-3 text-ink">
        <button
          onClick={toggle}
          aria-label={collapsed ? "展开侧边栏" : "隐藏侧边栏"}
          title={collapsed ? "展开侧边栏" : "隐藏侧边栏"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-60 transition-colors hover:bg-parchment hover:text-ink"
        >
          <SidebarSimple size={18} weight="bold" />
        </button>
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
            BT
          </span>
          <span className="text-[13px] font-semibold tracking-[-0.12px]">BusinessTalking</span>
          <span className="hidden text-[11px] text-ink-40 sm:inline">商业可行性对话</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-ink-40">
          <FloppyDisk size={14} />
          本地数据
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <Sidebar collapsed={!mounted ? false : collapsed} />
        <main className="min-w-0 flex-1 bg-canvas">{children}</main>
      </div>
    </div>
  );
}
