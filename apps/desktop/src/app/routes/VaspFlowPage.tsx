import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Activity, Atom, Bot, CheckCircle2, FileCode2, FolderSearch2, Loader2, TriangleAlert } from "lucide-react";
import { VaspFlowStructureView } from "@/components/inspector/VaspFlowStructureView";
import { cn } from "@/lib/cn";
import { useRuntimeStore } from "@/lib/runtime";
import { useUiStore } from "@/lib/store";
import {
  fetchVaspConvergence,
  fetchVaspFile,
  fetchVaspTaskFiles,
  scanVaspProject,
  type VaspFlowConvergence,
  type VaspFlowFileContent,
  type VaspFlowTask,
  type VaspFlowTaskFiles,
} from "@/lib/vaspFlow";

function assistantPrompt(root: string, task?: VaspFlowTask) {
  return [
    "请以科研助手模式检查当前 VASP 项目。",
    `项目根目录：${root}`,
    task ? `当前任务：${task.rel_path}（task_id=${task.id}）` : "请先调用 vasp_scan 扫描项目。",
    "优先使用 VASPFlow 的 vasp_scan、vasp_convergence、vasp_structure_scene、vasp_task_files 和 vasp_read_file；仅在确有需要时再选择 pymatgen/ASE、MatterSim、UMA 或 MatterGen。",
    "先做只读诊断并区分输入、计算中间态和已收敛结果。任何 VASP 提交前必须列出模型/算法、体系规模、k 点、ENCUT、预计资源与成本，并等待我的明确确认。",
  ].join("\n");
}

export function VaspFlowPage() {
  const { t } = useTranslation("pages");
  const navigate = useNavigate();
  const serverUrl = useRuntimeStore((state) => state.serverUrl);
  const workspace = useRuntimeStore((state) => state.workspace);
  const runtimeStatus = useRuntimeStore((state) => state.status);
  const startDraft = useRuntimeStore((state) => state.startDraft);
  const setResearchAssistantMode = useRuntimeStore((state) => state.setResearchAssistantMode);
  const setComposerDraft = useUiStore((state) => state.setComposerDraft);
  const [root, setRoot] = useState(workspace ?? "");
  const [tasks, setTasks] = useState<VaspFlowTask[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [convergence, setConvergence] = useState<VaspFlowConvergence | null>(null);
  const [files, setFiles] = useState<VaspFlowTaskFiles | null>(null);
  const [file, setFile] = useState<VaspFlowFileContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = tasks.find((task) => task.id === selectedId);

  useEffect(() => {
    if (!root && workspace) setRoot(workspace);
  }, [root, workspace]);

  const scan = async () => {
    if (!root.trim() || !serverUrl || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await scanVaspProject(serverUrl, root.trim());
      setTasks(result.tasks);
      setSelectedId(result.tasks[0]?.id ?? null);
      setFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (selectedId === null || !serverUrl) {
      setConvergence(null);
      setFiles(null);
      return;
    }
    let cancelled = false;
    setDetailBusy(true);
    setError(null);
    void Promise.all([
      fetchVaspConvergence(serverUrl, selectedId),
      fetchVaspTaskFiles(serverUrl, selectedId),
    ]).then(([nextConvergence, nextFiles]) => {
      if (cancelled) return;
      setConvergence(nextConvergence);
      setFiles(nextFiles);
      setFile(null);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled) setDetailBusy(false);
    });
    return () => { cancelled = true; };
  }, [selectedId, serverUrl]);

  const openFile = async (name: string) => {
    if (selectedId === null || !serverUrl) return;
    setDetailBusy(true);
    try {
      setFile(await fetchVaspFile(serverUrl, selectedId, name));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDetailBusy(false);
    }
  };

  const openAssistant = () => {
    startDraft();
    setResearchAssistantMode("scientific-assistant");
    setComposerDraft(assistantPrompt(root, selected));
    navigate("/live");
  };

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full max-w-[1680px] flex-col px-5 pb-8 pt-5 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent"><Atom size={14} />{t("vasp.eyebrow")}</div>
            <h1 className="mt-2 font-serif text-[30px] text-text">{t("vasp.title")}</h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{t("vasp.description")}</p>
          </div>
          <button onClick={openAssistant} className="flex items-center gap-2 rounded-input bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"><Bot size={15} />{t("vasp.askAssistant")}</button>
        </header>

        <div className="mt-5 flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4">
          <label className="min-w-[280px] flex-1 text-xs text-muted">{t("vasp.root")}<input value={root} onChange={(event) => setRoot(event.target.value)} className="mt-1 w-full rounded-input border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent" /></label>
          <button onClick={() => void scan()} disabled={busy || runtimeStatus !== "ready" || !root.trim()} className="flex h-9 items-center gap-2 rounded-input bg-text px-4 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" /> : <FolderSearch2 size={15} />}{t("vasp.scan")}</button>
          <div className={cn("flex h-9 items-center gap-2 rounded-input border px-3 text-xs", runtimeStatus === "ready" ? "border-ok/30 bg-ok/10 text-ok" : "border-warning/30 bg-warning/10 text-warning")}>{runtimeStatus === "ready" ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}{t(`vasp.runtime.${runtimeStatus === "ready" ? "ready" : "offline"}`)}</div>
        </div>
        {error && <div className="mt-3 rounded-input border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}

        <div className="mt-4 grid min-h-[660px] flex-1 gap-4 lg:grid-cols-[280px_minmax(460px,1fr)] 2xl:grid-cols-[300px_minmax(520px,1.35fr)_minmax(280px,0.75fr)]">
          <section className="overflow-hidden rounded-card border border-border bg-surface">
            <div className="flex h-11 items-center justify-between border-b border-border px-3"><span className="text-sm font-medium text-text">{t("vasp.tasks")}</span><span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted">{tasks.length}</span></div>
            <div className="max-h-[615px] overflow-y-auto p-2">
              {tasks.length === 0 ? <div className="px-5 py-16 text-center text-sm text-muted">{t("vasp.empty")}</div> : tasks.map((task) => (
                <button key={task.id} onClick={() => setSelectedId(task.id)} className={cn("mb-1 w-full rounded-input border px-3 py-3 text-left", selectedId === task.id ? "border-accent/50 bg-accent/10" : "border-transparent hover:bg-surface-2")}>
                  <div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-medium text-text">{task.label}</span><span className={cn("h-2 w-2 shrink-0 rounded-full", task.is_converged ? "bg-ok" : task.status === "running" ? "bg-warning" : "bg-muted")} /></div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted">{task.rel_path}</div>
                  <div className="mt-2 flex justify-between font-mono text-[10px] text-muted"><span>{task.system}</span><span>{task.final_energy == null ? "—" : `${task.final_energy.toFixed(5)} eV`}</span></div>
                </button>
              ))}
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-surface">
            <div className="flex h-11 items-center justify-between border-b border-border px-3"><div className="min-w-0"><span className="text-sm font-medium text-text">{selected?.label ?? t("vasp.structure")}</span>{selected && <span className="ml-2 font-mono text-[11px] text-muted">#{selected.id}</span>}</div>{detailBusy && <Loader2 size={14} className="animate-spin text-muted" />}</div>
            <div className="min-h-[420px] flex-1">{selectedId !== null && serverUrl ? <VaspFlowStructureView materialId={selected?.rel_path ?? String(selectedId)} taskId={selectedId} serverUrl={serverUrl} /> : <div className="flex h-full items-center justify-center text-sm text-muted">{t("vasp.selectPrompt")}</div>}</div>
            <div className="shrink-0 border-t border-border p-3"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-text"><Activity size={14} />{t("vasp.convergence")}</div><ConvergencePlot data={convergence} /></div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-surface lg:col-span-2 2xl:col-span-1">
            <div className="flex h-11 items-center gap-2 border-b border-border px-3"><FileCode2 size={14} className="text-accent" /><span className="text-sm font-medium text-text">{t("vasp.files")}</span></div>
            <div className="max-h-56 overflow-y-auto border-b border-border p-2">{files?.files.map((item) => <button key={item.name} onClick={() => void openFile(item.name)} className={cn("flex w-full items-center justify-between rounded-input px-2 py-1.5 text-left font-mono text-xs hover:bg-surface-2", file?.name === item.name ? "bg-accent/10 text-accent" : "text-text")}><span className="truncate">{item.name}</span><span className="ml-2 text-[10px] text-muted">{formatBytes(item.size)}</span></button>)}</div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-bg p-3 font-mono text-[11px] leading-relaxed text-text">{file ? `${file.content}${file.truncated ? `\n\n${t("vasp.truncated")}` : ""}` : t("vasp.filePrompt")}</pre>
          </section>
        </div>
      </div>
    </div>
  );
}

function ConvergencePlot({ data }: { data: VaspFlowConvergence | null }) {
  const { t } = useTranslation("pages");
  const values = data?.energies ?? [];
  if (!values.length) return <div className="flex h-24 items-center justify-center rounded-input bg-bg text-xs text-muted">—</div>;
  const width = 600, height = 100, pad = 8;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(max - min, 1e-9);
  const points = values.map((value, index) => `${pad + index / Math.max(values.length - 1, 1) * (width - pad * 2)},${height - pad - (value - min) / span * (height - pad * 2)}`).join(" ");
  return <div className="overflow-hidden rounded-input bg-bg"><svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" preserveAspectRatio="none" aria-label="VASP convergence energy"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-accent" /></svg><div className="flex justify-between px-2 pb-1 font-mono text-[10px] text-muted"><span>{t("vasp.ionicSteps", { count: values.length })}</span><span>{t("vasp.energyValue", { value: values[values.length - 1]?.toFixed(6) })}</span></div></div>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
