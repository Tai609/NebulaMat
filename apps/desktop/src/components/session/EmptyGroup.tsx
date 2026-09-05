import { useTranslation } from "react-i18next";
import { LayoutGrid, Plus } from "lucide-react";
import { useDragPane } from "@/lib/dragPane";
import { useLayoutStore } from "@/lib/layout";
import { cn } from "@/lib/cn";

/**
 * Onboarding for an empty group (no panes): a full-area drop target plus a
 * "New session" button. The drag controller marks it via `data-empty-group`,
 * so dropping a session here fills the group; the button fills it with a fresh
 * draft pane. Highlights while a drag hovers it.
 */
export function EmptyGroup() {
  const { t } = useTranslation("session");
  const reset = useLayoutStore((s) => s.reset);
  // A session drag hovering the empty zone → highlight.
  const hovering = useDragPane((s) => !!s.active && !!s.active.target && "empty" in s.active.target);
  return (
    <div
      data-empty-group
      className={cn(
        "flex h-full w-full items-center justify-center p-8 transition-colors",
        hovering && "bg-accent/10 ring-1 ring-inset ring-accent/50",
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <LayoutGrid size={28} strokeWidth={1.5} className="text-muted" />
        <div className="text-sm font-medium text-text">{t("group.empty.title")}</div>
        <p className="text-sm text-muted">{t("group.empty.hint")}</p>
        {/* Fills the empty group with a fresh draft pane. */}
        <button
          onClick={() => reset(null)}
          className="mt-1 flex items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          <Plus size={14} strokeWidth={2} />
          {t("group.empty.newSession")}
        </button>
      </div>
    </div>
  );
}
