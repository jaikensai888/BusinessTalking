import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/** DESIGN.md store-utility-card（精修）：白底 hairline lg 圆角，可选 hover 反馈 */
export const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }>(
  function Card({ className, interactive, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-white border border-hairline rounded-lg",
          interactive && "transition-colors duration-150 hover:border-primary/40 hover:bg-pearl/60 cursor-pointer",
          className
        )}
        {...props}
      />
    );
  }
);
