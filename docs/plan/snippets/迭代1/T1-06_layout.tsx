/**
 * 任务 T1-06: 主布局框架（侧边栏 + 明暗瓦片）
 * 目标文件: src/app/(dashboard)/layout.tsx
 * 依据: 04_UX_DESIGN.md#2 信息架构 + #7 设计系统
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "工作台", icon: "⌂" },
  { href: "/skills", label: "Skill 库", icon: "◇" },
  { href: "/personas", label: "人格库", icon: "☺" },
  { href: "/recipes", label: "配方", icon: "◈" },
  { href: "/runs", label: "运行", icon: "▤" },
  { href: "/settings", label: "设置", icon: "⚙" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      {/* 全局导航：纯黑 44px（DESIGN.md global-nav） */}
      <header className="h-11 bg-black text-white flex items-center px-5 gap-6 text-[12px] tracking-[-0.12px]">
        <span className="font-semibold">可行实验室</span>
      </header>
      <div className="flex">
        {/* 侧边栏：羊皮纸表面 + hairline */}
        <aside className="w-52 shrink-0 bg-[#fafafc] border-r border-[#e0e0e0] py-6 px-3 space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-4 py-2 text-[14px] text-[#1d1d1f]",
                pathname === item.href
                  ? "bg-[#0066cc] text-white" // 选中态：Action Blue
                  : "hover:bg-[#f5f5f7]"
              )}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </aside>
        {/* 内容区：白色画布 */}
        <main className="flex-1 min-w-0 bg-white">{children}</main>
      </div>
    </div>
  );
}
