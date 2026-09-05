import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot, CheckCircle2, CircleDashed, Loader2, X, XCircle } from "lucide-react";
import type { ToolCallStatus } from "@ai4s/shared";
import type { SubagentInfo } from "@ai4s/sdk";
import { cn } from "@/lib/cn";
import { subagentActivity, useRuntimeStore } from "@/lib/runtime";
import { PaneTitlebarInset } from "@/components/inspector/RightPane";

/** One subagent this conversation spawned. */
interface Row {
  /** The task tool's own title — what the subagent was asked to do. */
  task: string;
  status: ToolCallStatus;
  childSessionId?: string;
  startedAt?: number;
  endedAt?: number;
}

// Keep the Zustand snapshot stable when a session has no DSH catalog yet.
// Returning `[]` from a selector allocates on every read and makes React's
// useSyncExternalStore detect a change forever.
const EMPTY_SUBAGENTS: readonly SubagentInfo[] = [];

/** Human-readable elapsed time for a subagent: "12s", "3m 04s". */
function elapsed(row: Row, now: number): string {
  if (row.startedAt == null) return "";
  const end = row.endedAt ?? now;
  const s = Math.max(0, Math.round((end - row.startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * What the subagents are doing (#63). A multi-agent turn otherwise only shows
 * as a collapsed tool row in the transcript: you cannot see which subagent is
 * running, on what, or how long it has been going. This panel lists them all —
 * finished ones included, so a finished run can still be reviewed.
 */
export function SubagentPane({
  sessionId,
  onClose,
  controls,
}: {
  sessionId: string;
  onClose: () => void;
  controls?: React.ReactNode;
}) {
  const { t } = useTranslation(["session", "common"]);
  const blocks = useRuntimeStore((s) => s.threads[sessionId]?.blocks);
  const sessions = useRuntimeStore((s) => s.sessions);
  const sessionParents = useRuntimeStore((s) => s.sessionParents);
  const catalog = useRuntimeStore((s) => s.subagents[sessionId]) ?? EMPTY_SUBAGENTS;
  const refreshSessions = useRuntimeStore((s) => s.refreshSessions);
  const refreshSubagents = useRuntimeStore((s) => s.refreshSubagents);
  const now = Date.now();

  // Recover child sessions created before this window was opened (or before a
  // reconnect). The DSH session list carries the durable parent relationship,
  // so the panel does not depend solely on a live task event.
  useEffect(() => {
    void refreshSessions();
    void refreshSubagents(sessionId);
    const timer = window.setInterval(() => void refreshSubagents(sessionId), 1500);
    return () => window.clearInterval(timer);
  }, [refreshSessions, refreshSubagents, sessionId]);

  // Subagents are the task-tool rows of this conversation, newest last. A tool
  // row updates in place, so the list stays one entry per subagent.
  const rows: Row[] = (blocks ?? [])
    .filter((b) => b.kind === "tool-call" && (isSubagentTool(b.tool) || !!b.childSessionId))
    .map((b) => {
      const tool = b as Extract<typeof b, { kind: "tool-call" }>;
      return {
        task: tool.title,
        status: tool.status,
        childSessionId: tool.childSessionId,
        startedAt: tool.startedAt,
        endedAt: tool.endedAt,
      };
    });
  const representedChildren = new Set(rows.map((row) => row.childSessionId).filter(Boolean));
  // DSH's current delegation tool is `subagent` and its durable child catalog
  // is a separate RPC. Merge that catalog so background/continuable children
  // are visible even when the parent tool row has no child id yet.
  for (const child of catalog) {
    const existing = rows.find((row) => row.childSessionId === child.id);
    if (existing) {
      if (child.activity === "running") existing.status = "running";
      continue;
    }
    representedChildren.add(child.id);
    rows.push({
      task: child.label || child.id,
      status: child.activity === "running" ? "running" : "success",
      childSessionId: child.id,
    });
  }
  for (const child of sessions.filter((candidate) => sessionParents[candidate.id] === sessionId)) {
    if (representedChildren.has(child.id)) continue;
    const status: ToolCallStatus = child.running === true
      ? "running"
      : child.running === false
        ? "success"
        : "pending";
    rows.push({
      task: child.title || child.id,
      status,
      childSessionId: child.id,
      startedAt: child.created ?? child.updated,
      ...(status === "running" ? {} : { endedAt: child.updated }),
    });
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <PaneTitlebarInset />
        <Bot size={14} strokeWidth={1.5} className="shrink-0 text-text" />
        <span className="text-sm font-medium text-text">{t("subagents.title")}</span>
        <span className="text-xs text-muted">
          {t("subagents.count", { count: rows.length })}
        </span>
        <div className="flex-1" />
        {controls}
        <button
          className="text-text hover:opacity-60"
          aria-label={t("subagents.closeAria")}
          onClick={onClose}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {rows.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted">{t("subagents.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((row, i) => (
              <li
                key={`${row.childSessionId ?? "row"}:${i}`}
                className="rounded-card border border-border bg-surface-2 px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <StatusIcon status={row.status} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text">{row.task}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted">
                    {elapsed(row, now)}
                  </span>
                </div>
                {row.childSessionId && row.status === "running" && (
                  <Activity childId={row.childSessionId} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function isSubagentTool(tool?: string): boolean {
  return !!tool && /^(?:task|subagent|delegate|spawn[_-]?agent)$/i.test(tool);
}

/** The running subagent's current step. Subscribes to its OWN child thread so
 *  a fast-folding subagent repaints this line alone, not the whole panel. */
function Activity({ childId }: { childId: string }) {
  const activity = useRuntimeStore((s) => subagentActivity(s.threads[childId]?.blocks));
  if (!activity) return null;
  return <p className="mt-1 truncate pl-6 font-mono text-[11px] text-muted">{activity}</p>;
}

function StatusIcon({ status }: { status: ToolCallStatus }) {
  const common = "shrink-0";
  if (status === "running")
    return <Loader2 size={13} className={cn(common, "animate-spin text-accent")} />;
  if (status === "success") return <CheckCircle2 size={13} className={cn(common, "text-ok")} />;
  if (status === "failed") return <XCircle size={13} className={cn(common, "text-error")} />;
  return <CircleDashed size={13} className={cn(common, "text-muted")} />;
}
