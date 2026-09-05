import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StepSummaryBlock } from "@ai4s/shared";
import { cn } from "@/lib/cn";

export const StepSummaryRow = memo(function StepSummaryRow({ block }: { block: StepSummaryBlock }) {
  const { t } = useTranslation(["session", "common"]);
  const [open, setOpen] = useState(false);
  const hasDetails = (block.details?.length ?? 0) > 0;
  return (
    <div className="rounded-input border border-border bg-surface-2/60">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted"
        onClick={() => hasDetails && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronRight
          size={15}
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="flex-1 truncate">{block.summary}</span>
        <span className="shrink-0 text-xs">{t("stepSummary.steps", { count: block.steps })}</span>
      </button>
      {open && hasDetails && (
        <ul className="space-y-1 px-9 pb-3 text-sm text-muted">
          {block.details!.map((d, i) => (
            <li key={i} className="list-disc">
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
