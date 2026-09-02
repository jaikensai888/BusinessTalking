import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-6 w-6 text-[11px]",
  md: "h-10 w-10 text-[15px]",
  lg: "h-14 w-14 text-[20px]",
  xl: "h-20 w-20 text-[28px]",
} as const;

/** 平铺纯色 app 图标色（类 Chrome Web Store 扩展图标，与工作区卡片一致） */
const PALETTE = ["#2f6fed", "#4f46e5", "#0ea5a6", "#b98a2f", "#e0567a", "#5b6b8c", "#7c5cd6", "#2e7d64"];

/** DESIGN.md 7.6 头像（精修）：正圆 + 白色描边 + 平铺纯色；无图时按名称生成 */
export function Avatar({
  src,
  name,
  size = "md",
  className,
}: {
  src?: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const initial = name.trim().charAt(0) || "?";
  const hue = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const color = PALETTE[hue % PALETTE.length];

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} className={cn("rounded-full object-cover shrink-0 ring-2 ring-white", SIZES[size], className)} />;
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center text-white font-semibold select-none shrink-0",
        "ring-2 ring-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]",
        SIZES[size],
        className
      )}
      style={{ backgroundColor: color }}
      aria-label={name}
    >
      {initial}
    </div>
  );
}
