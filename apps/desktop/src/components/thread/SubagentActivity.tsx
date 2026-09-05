import { subagentActivity, useRuntimeStore } from "@/lib/runtime";

/**
 * Live one-line pulse of the subagent a task tool spawned. It subscribes to
 * ONLY its child session's thread, so a subagent's high-frequency folds
 * re-render this tiny leaf alone — never the parent tool row (which stays
 * memoized on its own block) or the whole conversation. Renders nothing until
 * the child reports an activity. Mount it only while the task is running.
 */
export function SubagentActivity({ childId }: { childId: string }) {
  const activity = useRuntimeStore((s) => subagentActivity(s.threads[childId]?.blocks));
  if (!activity) return null;
  return (
    <div className="flex items-center gap-2 px-2 pb-0.5 text-xs" data-subagent-activity>
      <span
        aria-hidden
        className="mb-1.5 ml-[6px] h-2 w-2 shrink-0 rounded-bl border-b border-l border-border"
      />
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
      <span className="min-w-0 flex-1 truncate font-mono text-muted">{activity}</span>
    </div>
  );
}
