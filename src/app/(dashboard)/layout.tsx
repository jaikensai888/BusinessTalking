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
    let shouldCollapse = false;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") shouldCollapse = true;
    } catch {
      /* ignore */
    }
    // ≤833px 首次进入默认收起（规范：tablet portrait 起全局导航折叠）
    if (window.matchMedia("(max-width: 833px)").matches) shouldCollapse = true;
    if (shouldCollapse) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(true);
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
      {/* DESIGN.md global-nav：纯黑 44px，全站唯一出现纯黑的位置 */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-black bg-black px-3 text-white">
        <button
          onClick={toggle}
          aria-label={collapsed ? "展开侧边栏" : "隐藏侧边栏"}
          title={collapsed ? "展开侧边栏" : "隐藏侧边栏"}
          className="relative flex h-8 w-8 items-center justify-center rounded-sm text-white/70 transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-white/10 hover:text-white"
        >
          <SidebarSimple size={18} weight="bold" />
        </button>
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-fine font-semibold text-white">
            BT
          </span>
          <span className="text-caption font-semibold tracking-[-0.12px]">BusinessTalking</span>
          <span className="hidden text-fine text-white/50 sm:inline">商业可行性对话</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-fine text-white/50">
          <FloppyDisk size={14} />
          本地数据
        </div>
      </header>

      <div className="relative flex flex-1 min-h-0">
        <Sidebar collapsed={!mounted ? false : collapsed} onClose={() => setCollapsed(true)} />
        <main className="min-w-0 flex-1 bg-canvas">{children}</main>
      </div>
    </div>
  );
}
