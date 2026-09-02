import { cn } from "@/lib/utils";

export type BadgeVariant = "neutral" | "primary" | "success" | "warning" | "error" | "dark";

/** 统一状态/来源徽章（DESIGN.md pearl capsule 语法精修） */
const styles: Record<BadgeVariant, string> = {
  neutral: "bg-parchment text-ink-60",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/12 text-[#1f7a43]",
  warning: "bg-warning/14 text-[#b26a00]",
  error: "bg-error/10 text-[#c7352b]",
  dark: "bg-tile-1 text-white",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-[1.5]",
        styles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
