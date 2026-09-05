import { memo, useState } from "react";
import { Brain, ChevronRight, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReasoningBlock } from "@ai4s/shared";
import { cn } from "@/lib/cn";

/**
 * The model's reasoning ("thinking"). It stays collapsed while streaming and
 * after completion so intermediate tool-preface prose never becomes part of
 * the answer surface. The user can click the row to inspect it. `streaming` is
 * derived by the caller and only changes the icon/label; `inline` renders it
 * bare for use inside a tool activity group.
 */
export const ReasoningRow = memo(function ReasoningRow({
  block,
  streaming = false,
  inline = false,
}: {
  block: ReasoningBlock;
  streaming?: boolean;
  inline?: boolean;
}) {
  const { t } = useTranslation(["session", "common"]);
  // A thought is folded by default, including while it streams. This keeps
  // tool-preface chatter out of the answer surface; users can expand it when
  // they explicitly want to inspect the intermediate reasoning.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const text = block.text.trim();
  if (!text) return null;
  const open = userOpen ?? false;
  return (
    <div className={cn(!inline && "rounded-input border border-border/70 bg-surface-2/40")}>
      <button
        className={cn(
          "flex w-full items-center gap-2 text-left text-xs text-muted",
          inline ? "px-2 py-1" : "px-3 py-2",
        )}
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
      >
        {streaming ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-muted/70" />
        ) : (
          <Brain size={13} className="shrink-0 text-muted/60" />
        )}
        <span className={cn(streaming && "animate-pulse")}>
          {streaming ? t("reasoning.thinking") : t("reasoning.thought")}
        </span>
        <ChevronRight
          size={13}
          className={cn("ml-auto shrink-0 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div
          className={cn(
            "max-h-56 overflow-y-auto",
            inline ? "pb-2 pl-7 pr-2" : "px-3 pb-3",
          )}
        >
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-muted/90">
            {text}
          </p>
        </div>
      )}
    </div>
  );
});
