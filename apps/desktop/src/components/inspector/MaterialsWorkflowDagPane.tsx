import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, CircleDashed, Loader2, RefreshCw, Workflow, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  getScopedMaterialsWorkflow,
  listAllMaterialsWorkflows,
  type MaterialsWorkflowSummary,
} from "@/lib/tauri";
import {
  isTerminalMaterialsTask,
  layoutMaterialsWorkflowDag,
  parseMaterialsWorkflowDag,
  type MaterialsTaskStatus,
  type MaterialsWorkflowDag,
} from "@/lib/materialsWorkflowDag";
import { PaneTitlebarInset } from "./RightPane";

const STATUS_CLASS: Record<MaterialsTaskStatus, string> = {
  pending: "border-border text-muted",
  running: "border-accent/60 bg-accent/10 text-accent",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  failed: "border-red-500/30 bg-red-500/10 text-red-700",
  blocked: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  skipped: "border-border border-dashed text-muted",
};

function StatusIcon({ status }: { status: MaterialsTaskStatus }) {
  if (status === "running") return <Loader2 size={12} className="animate-spin" />;
  if (status === "completed") return <CheckCircle2 size={12} />;
  if (status === "failed" || status === "blocked") return <CircleAlert size={12} />;
  return <CircleDashed size={12} />;
}

function summaryLabel(summary: MaterialsWorkflowSummary): string {
  const goal = summary.goal.trim() || summary.workflow_id;
  return `${summary.workflow_id} · ${goal.slice(0, 54)}${goal.length > 54 ? "…" : ""}`;
}

export function MaterialsWorkflowDagPane({
  workspaceDirectory,
  onClose,
  controls,
}: {
  workspaceDirectory?: string;
  onClose: () => void;
  controls?: React.ReactNode;
}) {
  const { t } = useTranslation("inspector");
  const [summaries, setSummaries] = useState<MaterialsWorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<MaterialsWorkflowDag | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (keepSelection = true) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listAllMaterialsWorkflows(workspaceDirectory);
      setSummaries(rows);
      const nextId = keepSelection && selectedId && rows.some((row) => row.workflow_id === selectedId)
        ? selectedId
        : rows[0]?.workflow_id ?? null;
      setSelectedId(nextId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSummaries([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [selectedId, workspaceDirectory]);

  useEffect(() => {
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setWorkflow(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setError(null);
    void getScopedMaterialsWorkflow(selectedId, workspaceDirectory)
      .then((raw) => {
        if (!cancelled) setWorkflow(parseMaterialsWorkflowDag(raw));
      })
      .catch((reason) => {
        if (!cancelled) {
          setWorkflow(null);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, workspaceDirectory]);

  const layout = useMemo(() => workflow ? layoutMaterialsWorkflowDag(workflow) : null, [workflow]);
  const selectedSummary = summaries.find((summary) => summary.workflow_id === selectedId);

  return (
    <div className="flex h-full min-w-0 flex-col border-l border-border bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <PaneTitlebarInset />
        <Workflow size={15} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{t("materialsWorkflow.title")}</span>
        {workflow && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-muted">{workflow.tasks.length}</span>}
        <button
          type="button"
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
          aria-label={t("materialsWorkflow.refresh")}
          title={t("materialsWorkflow.refresh")}
          disabled={loading}
          onClick={() => void refresh(true)}
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
        </button>
        {controls}
        <button type="button" className="rounded p-1 text-text hover:bg-surface-2" aria-label={t("materialsWorkflow.close")} onClick={onClose}>
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {summaries.length > 0 && (
          <div className="border-b border-border px-3 py-2">
            <label className="sr-only" htmlFor="materials-workflow-select">{t("materialsWorkflow.select")}</label>
            <select
              id="materials-workflow-select"
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
              value={selectedId ?? ""}
              onChange={(event) => setSelectedId(event.target.value || null)}
            >
              {summaries.map((summary) => <option key={summary.workflow_id} value={summary.workflow_id}>{summaryLabel(summary)}</option>)}
            </select>
            {selectedSummary && (
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="truncate">{selectedSummary.workflow_template ?? t("materialsWorkflow.genericTemplate")}</span>
                <span className="shrink-0 font-mono">{selectedSummary.stage} · {selectedSummary.status}</span>
              </div>
            )}
          </div>
        )}

        {loading && !summaries.length ? (
          <div className="flex flex-1 items-center justify-center gap-2 px-6 text-sm text-muted"><Loader2 size={15} className="animate-spin" />{t("materialsWorkflow.loading")}</div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-sm text-muted">
            <CircleAlert size={18} className="text-red-500" />
            <span>{t("materialsWorkflow.readError", { error })}</span>
            <button type="button" className="rounded-input border border-border px-2 py-1 text-xs text-text hover:bg-surface-2" onClick={() => void refresh(true)}>{t("materialsWorkflow.retry")}</button>
          </div>
        ) : !summaries.length ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-sm text-muted">
            <Workflow size={20} className="text-accent/70" />
            <span>{t("materialsWorkflow.empty")}</span>
          </div>
        ) : detailLoading || !layout || !workflow ? (
          <div className="flex flex-1 items-center justify-center gap-2 px-6 text-sm text-muted"><Loader2 size={15} className="animate-spin" />{t("materialsWorkflow.loading")}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            <div className="mb-3 text-xs text-muted">
              <div className="truncate text-sm text-text">{workflow.goal || workflow.workflowId}</div>
              <div className="mt-1">{t("materialsWorkflow.nodeCount", { count: workflow.tasks.length })}</div>
            </div>
            <div className="flex min-w-max items-stretch gap-2" style={{ minHeight: layout.height }}>
              {layout.layers.map((layer, layerIndex) => (
                <div key={`layer-${layerIndex}`} className="flex w-[206px] flex-col gap-2">
                  <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted">{t("materialsWorkflow.layer", { count: layerIndex + 1 })}</div>
                  {layer.map((node) => (
                    <article key={node.taskId} className={cn("rounded-input border bg-surface px-2.5 py-2 shadow-sm", STATUS_CLASS[node.status], node.missingDependency && "border-dashed") }>
                      <div className="flex items-start gap-1.5">
                        <StatusIcon status={node.status} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-xs font-medium text-text" title={node.taskId}>{node.taskId}</div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted" title={node.objective}>{node.objective}</div>
                        </div>
                      </div>
                      <div className="mt-2 truncate text-[10px] text-muted" title={node.capability}>{node.capability}</div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                        <span className="truncate text-muted" title={node.role}>{node.role}</span>
                        <span className="shrink-0 font-medium capitalize">{t(`materialsWorkflow.status.${node.status}`)}</span>
                      </div>
                      {node.dependencies.length > 0 && (
                        <div className="mt-2 flex min-w-0 items-center gap-1 border-t border-current/10 pt-1 text-[10px] text-muted" title={node.dependencies.join(", ")}>
                          <ArrowRight size={10} className="shrink-0" />
                          <span className="truncate">{t("materialsWorkflow.dependsOn", { dependencies: node.dependencies.join(", ") })}</span>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )).flatMap((column, index, columns) => index < columns.length - 1 ? [column, <div key={`arrow-${index}`} className="flex items-center text-muted"><ArrowRight size={15} /></div>] : [column])}
            </div>
            {workflow.optionalStages.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <div className="text-xs font-medium text-text">{t("materialsWorkflow.optionalTitle")}</div>
                <div className="mt-2 space-y-1.5">
                  {workflow.optionalStages.map((stage) => (
                    <div key={stage.stage} className="rounded-input border border-dashed border-border px-2.5 py-2 text-[11px] text-muted">
                      <div className="flex items-center gap-1.5"><CircleDashed size={12} /><span className="font-mono text-text">{stage.stage}</span><span className="ml-auto">{stage.status}</span></div>
                      {stage.reason && <div className="mt-1">{stage.reason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function isMaterialsWorkflowActive(workflow: MaterialsWorkflowDag | null): boolean {
  return !!workflow?.tasks.some((task) => !isTerminalMaterialsTask(task.status));
}
