"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartLineUp,
  ChatCircleDots,
  Database,
  GearSix,
  ListBullets,
  Scroll,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const MAIN_NAV: { href: string; label: string; icon: Icon }[] = [
  { href: "/", label: "工作台", icon: ChartLineUp },
  { href: "/spaces", label: "会话空间", icon: ChatCircleDots },
  { href: "/skills", label: "Skill 库", icon: Database },
  { href: "/personas", label: "人格库", icon: UsersThree },
  { href: "/recipes", label: "配方", icon: Scroll },
  { href: "/runs", label: "运行", icon: ListBullets },
];
const SETTINGS: { href: string; label: string; icon: Icon } = {
  href: "/settings",
  label: "设置",
  icon: GearSix,
};

/** 侧边栏（优化版）：图标 + 标签，选中态 Action Blue 圆角胶囊；设置项钉到底部；collapsed 时隐藏 */
export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href));

  const renderItem = (it: { href: string; label: string; icon: Icon }) => {
    const active = isActive(it.href);
    const IconComponent = it.icon;
    return (
      <Link
        key={it.href}
        href={it.href}
        title={collapsed ? it.label : undefined}
        className={cn(
          "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors duration-150 whitespace-nowrap",
          active
            ? "bg-primary/10 text-primary"
            : "text-ink-60 hover:bg-parchment hover:text-ink"
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" aria-hidden />
        )}
        <IconComponent size={18} weight={active ? "fill" : "regular"} className="shrink-0" />
        {!collapsed && <span>{it.label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "sticky top-0 flex shrink-0 flex-col self-start overflow-hidden border-r border-hairline bg-pearl transition-all duration-300 ease-out",
        collapsed ? "w-0 border-r-0" : "w-56"
      )}
      style={{ height: collapsed ? undefined : "calc(100vh - 44px)" }}
      aria-hidden={collapsed}
    >
      <nav aria-label="主导航" className="flex flex-col gap-1 px-3 py-5">
        {MAIN_NAV.map(renderItem)}
      </nav>

      <div className={cn("mt-auto flex flex-col gap-1 px-3 pb-5", collapsed && "hidden")}>
        <div className="mb-1 h-px bg-hairline" />
        {renderItem(SETTINGS)}
        <p className="px-3 pt-2 text-[11px] text-ink-40">v0.1 · BusinessTalking</p>
      </div>
    </aside>
  );
}
