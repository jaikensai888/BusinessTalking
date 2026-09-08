"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 模态基元（DESIGN.md + WCAG AA）
 * - role="dialog" / aria-modal / aria-labelledby
 * - Escape 关闭、Tab 焦点陷阱、关闭后焦点归还触发元素
 * - 打开期间锁定 body 滚动
 * - 关闭按钮触控区 44×44（规范最小触控目标）
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  headerAction,
  footer,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = `modal-${useId()}`;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const raf = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(raf);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "fl-rise flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-overlay outline-none",
          className
        )}
      >
        <div className="flex items-center gap-3 border-b border-divider-soft px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-body font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="text-fine text-ink-40">{description}</p>}
          </div>
          {headerAction}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-ink-48 transition-colors hover:bg-parchment hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-divider-soft px-5 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
