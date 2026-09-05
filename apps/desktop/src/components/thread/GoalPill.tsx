import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, Target, X } from "lucide-react";
import { goalState, goalUpdate, type GoalState } from "@/lib/tauri";
import { cn } from "@/lib/cn";

/** How often the pill re-reads the plugin's state file while a session is
 *  open. Goal turns take seconds-to-minutes; 4s keeps the pill honest without
 *  chatter (one small JSON read per tick, no model turns). */
const POLL_MS = 4000;

/** Agent-facing (English, like all agent prompts). A resumed goal has no
 *  pending idle event to re-arm the plugin's continuation loop — verified
 *  against the legacy runtime — so resume must kick one turn; the loop takes
 *  over from that turn's idle. */
export const GOAL_RESUME_NUDGE = "Continue working toward the active goal.";

/**
 * Session-header pill for goal mode (/goal): shows the persistent objective,
 * its live status (running / paused / blocked / done + auto-turn count), and
 * instant pause / resume / clear controls that bypass the model entirely.
 * Renders nothing when the session has no goal.
 */
export function GoalPill({
  sessionId,
  onResumed,
}: {
  sessionId: string;
  /** Called after a successful resume — the page sends GOAL_RESUME_NUDGE. */
  onResumed?: () => void;
}) {
  const { t } = useTranslation("session");
  const [goal, setGoal] = useState<GoalState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setGoal(await goalState(sessionId));
  }, [sessionId]);

  useEffect(() => {
    setGoal(null); // never show the previous session's goal while loading
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = async (action: "pause" | "resume" | "clear") => {
    setBusy(true);
    try {
      setGoal(await goalUpdate(sessionId, action));
      if (action === "resume") onResumed?.();
    } catch {
      await refresh(); // the plugin may have raced us — show whatever won
    } finally {
      setBusy(false);
    }
  };

  if (!goal) return null;

  const status = goal.status;
  const autoTurns = goal.autoTurns ?? 0;
  // The plugin's status enum: active / paused / complete are the main line;
  // "unmet" is a goal the model declared blocked, budget/usageLimited hit a
  // guardrail. Anything unknown renders muted like paused (fail quiet).
  const limited = status === "budgetLimited" || status === "usageLimited";
  const statusLabel =
    status === "active"
      ? autoTurns > 0
        ? t("goal.runningTurns", { count: autoTurns })
        : t("goal.running")
      : status === "complete"
        ? t("goal.done")
        : status === "unmet"
          ? t("goal.unmet")
          : limited
            ? t("goal.limited")
            : t("goal.paused");
  const tooltip = [
    `${t("goal.label")}: ${goal.objective}`,
    status === "unmet" && goal.blocker ? `⚠ ${goal.blocker}` : null,
    limited && goal.lastStatus ? `⚠ ${goal.lastStatus}` : null,
    status === "complete" && goal.completionEvidence ? `✓ ${goal.completionEvidence}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      title={tooltip}
      className={cn(
        "flex min-w-0 shrink items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-1 text-xs",
        status === "active" && "border-accent/30 bg-accent/10 text-text",
        status === "unmet" && "border-error/30 bg-error/10 text-text",
        limited && "border-warn/30 bg-warn/10 text-text",
        status === "complete" && "border-ok/30 bg-ok/10 text-text",
        !["active", "unmet", "complete"].includes(status) && !limited &&
          "border-border bg-surface-2 text-muted",
      )}
    >
      <Target
        size={12}
        className={cn(
          "shrink-0",
          status === "active" && "text-accent",
          status === "unmet" && "text-error",
          limited && "text-warn",
          status === "complete" && "text-ok",
          !["active", "unmet", "complete"].includes(status) && !limited && "text-muted",
        )}
      />
      <span className="max-w-[180px] truncate">{goal.objective}</span>
      <span
        className={cn(
          "shrink-0 whitespace-nowrap",
          status === "active" ? "text-accent" : "text-muted",
        )}
      >
        {statusLabel}
      </span>
      {status === "active" && (
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
      )}
      {(status === "active" || status === "paused") && (
        <button
          onClick={() => void act(status === "active" ? "pause" : "resume")}
          disabled={busy}
          aria-label={status === "active" ? t("goal.pauseAria") : t("goal.resumeAria")}
          title={status === "active" ? t("goal.pauseAria") : t("goal.resumeAria")}
          className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-surface hover:text-text"
        >
          {status === "active" ? <Pause size={11} /> : <Play size={11} />}
        </button>
      )}
      <button
        onClick={() => void act("clear")}
        disabled={busy}
        aria-label={t("goal.clearAria")}
        title={t("goal.clearAria")}
        className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-surface hover:text-error"
      >
        <X size={11} />
      </button>
    </div>
  );
}
