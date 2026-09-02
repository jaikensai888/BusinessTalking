import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** 统一空状态：图标 + 标题 + 说明 + 可选操作（design-taste：空态需引导如何填充） */
export function EmptyState({
  icon: IconComponent,
  title,
  description,
  action,
  className,
}: {
  icon: Icon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-pearl/60 px-8 py-16 text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-parchment text-ink-40">
        <IconComponent size={24} weight="regular" />
      </div>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="max-w-sm text-[13px] leading-[1.5] text-ink-48">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
