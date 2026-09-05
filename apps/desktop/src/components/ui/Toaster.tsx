import { CheckCircle2, XCircle } from "lucide-react";
import { useToastStore } from "@/lib/toast";
import { cn } from "@/lib/cn";

/** Bottom-center stack of transient notifications (download saved/failed, …). */
export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cn(
            "pointer-events-auto flex max-w-[70vw] items-center gap-2 rounded-card border px-3.5 py-2 text-sm shadow-card",
            t.tone === "success"
              ? "border-ok/30 bg-surface text-text"
              : "border-error/30 bg-surface text-error",
          )}
        >
          {t.tone === "success" ? (
            <CheckCircle2 size={15} className="shrink-0 text-ok" />
          ) : (
            <XCircle size={15} className="shrink-0 text-error" />
          )}
          <span className="truncate">{t.message}</span>
        </button>
      ))}
    </div>
  );
}
