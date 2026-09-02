import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/** DESIGN.md 5.2 输入框（精修）：h-11、浅灰占位符（AA）、焦点环 */
export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { pill?: boolean }
>(function Input({ className, pill, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full bg-white border border-hairline text-ink placeholder:text-ink-40",
        "outline-none transition-colors duration-150",
        "hover:border-ink-48/60",
        "focus:border-primary focus:ring-[3px] focus:ring-primary/15",
        "disabled:bg-parchment disabled:text-ink-48",
        pill ? "rounded-full px-5" : "rounded-lg px-3.5 text-[15px]",
        className
      )}
      {...props}
    />
  );
});
