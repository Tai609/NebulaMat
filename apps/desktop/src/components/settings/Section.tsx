import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Flat settings chrome (Codex-style): the heading sits OUTSIDE the container,
 * the content lives in one bordered rounded surface — no nested cards.
 * `flush` drops the inner padding for sections whose children are row lists.
 */
export function Section({
  title,
  hint,
  action,
  flush = false,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mt-9">
      <header className="flex items-end gap-3 px-1">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-text">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>}
        </div>
        {action}
      </header>
      <div
        className={cn(
          "mt-2.5 rounded-card border border-border bg-surface",
          flush ? "overflow-hidden" : "px-4 py-3.5",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** One settings row: title + description on the left, the control on the right.
 *  On phone-width viewports the control drops BELOW the text instead of beside
 *  it — a wide control would otherwise squeeze the title to zero width and CJK
 *  text renders one character per line. */
export function Row({
  title,
  hint,
  control,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <div className="text-[13px] font-medium text-text">{title}</div>
          {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</div>}
        </div>
        {control}
      </div>
      {children}
    </div>
  );
}

/** iOS-style switch. Color-based states only — `opacity` flickers in WKWebView. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors",
        checked ? "bg-accent" : "bg-border",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-[left] duration-150",
          checked ? "left-[18px]" : "left-[2px]",
        )}
      />
    </button>
  );
}
