import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "dark" | "pearl" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

/** DESIGN.md 5.1 按钮语法（精修）：胶囊 CTA + 紧凑工具矩形；active 微缩、hover 微亮、焦点环全局 */
const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover active:scale-[0.97]",
  secondary:
    "border border-primary/50 text-primary hover:bg-primary/5 active:scale-[0.97] bg-transparent",
  dark: "bg-ink text-white hover:bg-ink-hover active:scale-[0.97]",
  pearl: "bg-pearl text-ink-80 border border-hairline hover:bg-parchment active:scale-[0.97]",
  danger: "text-error hover:text-error-hover hover:underline",
  ghost: "text-primary hover:text-primary-hover hover:underline",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3.5 py-1.5 text-caption gap-1.5",
  md: "px-5 py-2.5 text-caption gap-2",
  lg: "px-6 py-3 text-body gap-2",
};

const radius: Record<ButtonVariant, string> = {
  primary: "rounded-full",
  secondary: "rounded-full",
  dark: "rounded-sm",
  pearl: "rounded-sm",
  danger: "",
  ghost: "",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>(function Button({ variant = "primary", size = "md", className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-all duration-150",
        "disabled:opacity-45 disabled:pointer-events-none select-none cursor-pointer",
        variants[variant],
        sizes[size],
        radius[variant],
        className
      )}
      {...props}
    />
  );
});
