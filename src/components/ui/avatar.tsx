import { cn } from "@/lib/utils";
import { avatarColor } from "@/lib/color";

const SIZES = {
  sm: "h-6 w-6 text-fine",
  md: "h-10 w-10 text-caption",
  lg: "h-14 w-14 text-tagline",
  xl: "h-20 w-20 text-lead",
} as const;

/** DESIGN.md 7.6 头像（精修）：默认正圆；卡片主视觉可通过 className 覆盖为方形 */
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
  const color = avatarColor(name);

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} className={cn("rounded-full object-cover shrink-0 ring-2 ring-white", SIZES[size], className)} />;
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center text-white font-semibold select-none shrink-0",
        "ring-2 ring-white",
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
