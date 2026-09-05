import { useTranslation } from "react-i18next";
import type { ModelStatus, RuntimeStatus } from "@ai4s/shared";
import { DRAFT_KEY, draftKeyFor, useRuntimeStore } from "@/lib/runtime";
import { findLeaf, useLayoutStore } from "@/lib/layout";
import { cn } from "@/lib/cn";

const RUNTIME_TONE: Record<RuntimeStatus, string> = {
  ready: "bg-ok",
  connecting: "bg-warn",
  error: "bg-error",
  offline: "bg-muted",
};

const MODEL_TONE: Record<ModelStatus, string> = {
  connected: "bg-ok",
  disconnected: "bg-muted",
  error: "bg-error",
};

export function StatusPills() {
  const { t } = useTranslation("nav");
  const currentId = useRuntimeStore((s) => s.currentId);
  const focusedPaneKey = useLayoutStore((s) => {
    const leaf = s.tree && s.focusedLeafId ? findLeaf(s.tree, s.focusedLeafId) : null;
    return leaf?.sessionId ?? (leaf ? draftKeyFor(leaf.id) : null);
  });
  // The composer may pin a model for the focused pane without changing the
  // global default. Show the effective model the user is actually about to use.
  const defaultModel = useRuntimeStore((s) => {
    const paneKey = focusedPaneKey ?? currentId ?? DRAFT_KEY;
    return s.sessionModels[paneKey] ?? s.defaultModel;
  });
  const runtime = useRuntimeStore((s) => s.status);
  const model: ModelStatus = defaultModel ? "connected" : "disconnected";

  return (
    <div className="flex flex-col gap-1 text-xs text-muted">
      <Pill
        dot={RUNTIME_TONE[runtime]}
        label={t("status.runtime")}
        value={t(`status.values.${runtime}`)}
      />
      <Pill
        dot={MODEL_TONE[model]}
        label={t("status.model")}
        value={defaultModel ? defaultModel.split("/").pop()! : t("status.modelNotSet")}
      />
    </div>
  );
}

function Pill({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-2">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <span className="shrink-0">{label}</span>
      <span className="ml-auto min-w-0 truncate capitalize text-text/70" title={value}>
        {value}
      </span>
    </div>
  );
}
