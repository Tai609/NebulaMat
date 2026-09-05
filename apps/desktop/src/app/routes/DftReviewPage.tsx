/* eslint-disable i18next/no-literal-string -- DFT review labels are intentionally explicit and technical. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Clock3, FileCheck2, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { readArtifact } from "@/lib/artifactFile";
import {
  claimMaterialsDftHumanReview,
  getMaterialsWorkflow,
  listMaterialsWorkflows,
  recordMaterialsDftHumanReview,
  type MaterialsWorkflowSummary,
} from "@/lib/tauri";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/cn";
import type { DFTWorkflowStage, DFTWorkflowStatus } from "@ai4s/shared";

type Decision = "approved" | "changes_requested" | "rejected";
type WorkflowTaskView = {
  task_id: string;
  stage: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  attempt: number;
  claimed_by?: string;
  output?: { artifacts?: string[] };
};
type WorkflowData = {
  workflow_id: string;
  goal: string;
  status: DFTWorkflowStatus | string;
  stage: DFTWorkflowStage | string;
  tasks: WorkflowTaskView[];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asList = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
const latestTask = (data: WorkflowData, prefix: string): WorkflowTaskView | undefined => {
  const matches = data.tasks?.filter((task) => String(task.task_id ?? "").startsWith(prefix)) ?? [];
  return matches[matches.length - 1];
};
const outputArtifacts = (task?: WorkflowTaskView): string[] => task?.output?.artifacts?.filter((item): item is string => typeof item === "string") ?? [];

function parseWorkflowData(value: unknown): WorkflowData {
  const record = asRecord(value);
  const tasks: WorkflowTaskView[] = asList(record.tasks).map((task) => ({
    task_id: String(task.task_id ?? ""),
    stage: String(task.stage ?? ""),
    status: String(task.status ?? "pending") as WorkflowTaskView["status"],
    attempt: Number(task.attempt ?? 0),
    ...(typeof task.claimed_by === "string" ? { claimed_by: task.claimed_by } : {}),
    ...(task.output && typeof task.output === "object" ? { output: asRecord(task.output) as WorkflowTaskView["output"] } : {}),
  }));
  return {
    workflow_id: String(record.workflow_id ?? ""),
    goal: String(record.goal ?? ""),
    status: String(record.status ?? "active"),
    stage: String(record.stage ?? "goal"),
    tasks,
  };
}

export function DftReviewPage() {
  const [rows, setRows] = useState<MaterialsWorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<WorkflowData | null>(null);
  const [actor, setActor] = useState(() => (typeof window === "undefined" ? "human:reviewer" : window.localStorage.getItem("openscience.dftReviewer") || "human:reviewer"));
  const [note, setNote] = useState("");
  const [requestedChanges, setRequestedChanges] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!isTauri) return;
    setBusy("list");
    setError(null);
    try {
      const next = await listMaterialsWorkflows();
      setRows(next);
      setSelectedId((current) => (current && next.some((row) => row.workflow_id === current) ? current : next[0]?.workflow_id ?? null));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshWorkflow = useCallback(async (workflowId: string) => {
    setBusy("workflow");
    setError(null);
    try {
      setData(parseWorkflowData(await getMaterialsWorkflow(workflowId)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setData(null);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => { if (selectedId) void refreshWorkflow(selectedId); else setData(null); }, [refreshWorkflow, selectedId]);

  const reviewTask = data ? latestTask(data, "dft:human-review") : undefined;
  const prepareTask = data ? latestTask(data, "dft:prepare") : undefined;
  const auditTask = data ? latestTask(data, "dft:audit") : undefined;
  const artifacts = useMemo(() => [...new Set([...outputArtifacts(prepareTask), ...outputArtifacts(auditTask)])], [auditTask, prepareTask]);
  const reviewReady = reviewTask?.status === "pending";
  const claimedBy = typeof reviewTask?.claimed_by === "string" ? reviewTask.claimed_by : null;
  const canReview = reviewTask?.status === "running" && claimedBy === actor;

  const claim = async () => {
    if (!selectedId || !actor.startsWith("human:") || !reviewTask) return;
    setBusy("claim"); setError(null);
    try {
      await claimMaterialsDftHumanReview(selectedId, String(reviewTask.task_id), actor);
      window.localStorage.setItem("openscience.dftReviewer", actor);
      await refreshWorkflow(selectedId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(null); }
  };

  const decide = async (decision: Decision) => {
    if (!selectedId || !reviewTask || !canReview) return;
    setBusy(decision); setError(null);
    try {
      await recordMaterialsDftHumanReview({
        workflowId: selectedId,
        taskId: String(reviewTask.task_id),
        actor,
        decision,
        note,
        requestedChanges: requestedChanges.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      });
      setNote(""); setRequestedChanges("");
      await refreshWorkflow(selectedId);
      await refreshList();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(null); }
  };

  if (!isTauri) return <EmptyState title="审查需要桌面工作区" body="浏览器预览不会写入工作流状态或调用本地材料 MCP。" />;

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-[1280px] px-5 py-6 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent"><ShieldCheck size={14} /> DFT gate</div>
            <h1 className="mt-2 font-serif text-2xl text-text">审查</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">模型、参数、AI 审计和成本估算必须由指定人工确认后，远程任务才会进入可提交状态。</p>
          </div>
          <button onClick={() => void refreshList()} disabled={busy !== null} title="刷新工作流" aria-label="刷新工作流" className="rounded-input border border-border bg-surface p-2 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"><RefreshCw size={15} className={cn(busy === "list" && "animate-spin")} /></button>
        </header>

        {error && <div className="mt-4 flex items-start gap-2 rounded-input border border-error/25 bg-error/10 px-3 py-2 text-xs text-error"><CircleAlert size={14} className="mt-0.5 shrink-0" /><span className="break-words">{error}</span></div>}
        <div className="mt-5 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="rounded-card border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">待审工作流</h2><span className="text-[11px] tabular-nums text-muted">{rows.length}</span></div>
            <div className="space-y-1">
              {rows.map((row) => <button key={row.workflow_id} onClick={() => setSelectedId(row.workflow_id)} className={cn("w-full rounded-input border px-3 py-2 text-left", selectedId === row.workflow_id ? "border-accent/50 bg-accent/10" : "border-transparent hover:bg-surface-2")}><div className="truncate text-sm font-medium text-text">{row.goal || row.workflow_id}</div><div className="mt-1 flex items-center gap-2 text-[10px] text-muted"><span className="font-mono">{row.workflow_id}</span><span>{row.stage}</span></div></button>)}
              {rows.length === 0 && <p className="px-2 py-5 text-xs leading-5 text-muted">没有发现启用 DFT 的工作流，或材料 MCP 尚未安装。</p>}
            </div>
          </aside>

          <main className="min-w-0 rounded-card border border-border bg-surface p-4 sm:p-5">
            {!data ? <EmptyState title="选择一个工作流" body="左侧列表中的工作流会显示其冻结输入、模型审计和成本审计。" /> : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4"><div><div className="font-mono text-[11px] text-muted">{String(data.workflow_id)}</div><h2 className="mt-1 text-lg font-semibold text-text">{String(data.goal || "DFT workflow")}</h2></div><StatusBadge status={String(data.status || data.stage || "active")} /></div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="模型准备" task={prepareTask} /><Metric label="AI 模型/成本审计" task={auditTask} /><Metric label="人工审查" task={reviewTask} /></div>
                <ArtifactSection artifacts={artifacts} />

                <section className="mt-5 border-t border-border pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-text">人工决定</h3><p className="mt-1 text-xs text-muted">审查身份必须是 <span className="font-mono text-text">human:&lt;id&gt;</span>，批准绑定当前三个工件的 SHA-256。</p></div>{reviewReady && <button onClick={() => void claim()} disabled={busy !== null || !actor.startsWith("human:")} className="inline-flex items-center gap-1.5 rounded-input bg-accent px-3 py-2 text-xs font-semibold text-accent-fg disabled:opacity-50"><FileCheck2 size={14} /> 开始审查</button>}{claimedBy && <span className="text-xs text-muted">已领取：<span className="font-mono text-text">{claimedBy}</span></span>}</div>
                  <label className="mt-4 block text-xs font-medium text-text">审查身份<input value={actor} onChange={(event) => setActor(event.target.value)} className="mt-1 w-full rounded-input border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent" placeholder="human:your-id" /></label>
                  <label className="mt-3 block text-xs font-medium text-text">审查意见<textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-20 w-full resize-y rounded-input border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent" placeholder="记录模型、参数、时间或成本方面的意见" /></label>
                  <label className="mt-3 block text-xs font-medium text-text">要求修改（每行一项）<textarea value={requestedChanges} onChange={(event) => setRequestedChanges(event.target.value)} className="mt-1 min-h-16 w-full resize-y rounded-input border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent" placeholder="例如：将 4x4 超胞改为 3x3" /></label>
                  <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => void decide("approved")} disabled={!canReview || busy !== null} className="inline-flex items-center gap-1.5 rounded-input bg-ok px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Check size={14} /> 批准并允许提交</button><button onClick={() => void decide("changes_requested")} disabled={!canReview || busy !== null} className="inline-flex items-center gap-1.5 rounded-input border border-warn/40 bg-warn/10 px-3 py-2 text-xs font-semibold text-warn disabled:opacity-40"><RefreshCw size={14} /> 要求修改</button><button onClick={() => void decide("rejected")} disabled={!canReview || busy !== null} className="inline-flex items-center gap-1.5 rounded-input border border-error/30 bg-error/10 px-3 py-2 text-xs font-semibold text-error disabled:opacity-40"><X size={14} /> 拒绝</button>{busy && busy !== "list" && busy !== "workflow" && <Loader2 size={15} className="animate-spin self-center text-muted" />}</div>
                </section>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, task }: { label: string; task?: Record<string, unknown> }) {
  const status = String(task?.status ?? "pending");
  return <div className="rounded-input border border-border bg-bg px-3 py-2.5"><div className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div><div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-text">{status === "completed" ? <Check size={14} className="text-ok" /> : status === "running" ? <Clock3 size={14} className="text-accent" /> : <CircleAlert size={14} className="text-muted" />}{status}</div></div>;
}

function StatusBadge({ status }: { status: string }) { return <span className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs text-muted">{status}</span>; }

function ArtifactSection({ artifacts }: { artifacts: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => { if (!selected) { setContent(null); return; } let cancelled = false; void readArtifact(selected).then((file) => { if (!cancelled) setContent(file?.data ?? "(文件不可读)"); }); return () => { cancelled = true; }; }, [selected]);
  return <section className="mt-5 border-t border-border pt-5"><h3 className="text-sm font-semibold text-text">冻结工件</h3><div className="mt-2 grid gap-2 sm:grid-cols-3">{artifacts.map((artifact) => <button key={artifact} onClick={() => setSelected(artifact)} className={cn("truncate rounded-input border px-2.5 py-2 text-left font-mono text-[11px]", selected === artifact ? "border-accent bg-accent/10 text-text" : "border-border text-muted hover:bg-surface-2")}>{artifact}</button>)}</div>{selected && <pre className="mt-3 max-h-64 overflow-auto rounded-input border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-text">{content ?? "读取中..."}</pre>}</section>;
}

function EmptyState({ title, body }: { title: string; body: string }) { return <div className="flex min-h-56 flex-col items-center justify-center px-6 py-8 text-center text-muted"><CircleAlert size={24} className="mb-2 opacity-60" /><h2 className="text-sm font-semibold text-text">{title}</h2><p className="mt-1 max-w-sm text-xs leading-5">{body}</p></div>; }
