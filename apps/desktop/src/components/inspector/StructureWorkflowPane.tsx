import { useEffect, useMemo, useState } from "react";
import { Atom, ChevronLeft, ChevronRight, CircleDot, Loader2, Play, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { previewUrl, readArtifact } from "@/lib/artifactFile";
import {
  collectStructureWorkflowSteps,
  isAbsoluteStructurePath,
  type StructureWorkflowStep,
} from "@/lib/structureWorkflow";
import { parseLammpsDumpFrames, parseXdatcarFrames, type CrystalStructure } from "@/lib/crystal";
import { cn } from "@/lib/cn";
import { isGatewayWeb } from "@/lib/webMode";
import { VaspFlowStructureView } from "./VaspFlowStructureView";
import { MolecularDynamicsView } from "./MolecularDynamicsView";
import { PaneTitlebarInset } from "./RightPane";

export function StructureWorkflowPane({
  blocks,
  discoveredPaths = [],
  discoveryComplete = true,
  workspaceDirectory,
  onClose,
  controls,
}: {
  blocks: Parameters<typeof collectStructureWorkflowSteps>[0];
  discoveredPaths?: string[];
  discoveryComplete?: boolean;
  workspaceDirectory?: string;
  onClose: () => void;
  controls?: React.ReactNode;
}) {
  const { t } = useTranslation("inspector");
  const steps = useMemo(() => {
    // Transcript-referenced paths are already trusted by the scoped artifact
    // reader and can render immediately. Discovery only contributes files the
    // agent did not mention explicitly, so a slow workspace scan never blanks
    // the workflow pane.
    return collectStructureWorkflowSteps(blocks, discoveredPaths);
  }, [blocks, discoveredPaths]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(0, steps.findIndex((step) => step.id === selectedId));
  const selected = steps[selectedIndex];

  useEffect(() => {
    if (!steps.length) setSelectedId(null);
    else if (!steps.some((step) => step.id === selectedId)) setSelectedId(steps[0].id);
  }, [selectedId, steps]);

  return (
    <div className="flex h-full min-w-0 flex-col border-l border-border bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <PaneTitlebarInset />
        <Atom size={15} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
          {t("structureWorkflow.title")}
        </span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-muted">
          {steps.length}
        </span>
        {controls}
        <button className="text-text hover:opacity-60" aria-label={t("structureWorkflow.close")} onClick={onClose}>
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>

      {selected ? (
        <>
          <div className="border-b border-border bg-surface px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30"
                aria-label={t("structureWorkflow.previous")}
                disabled={selectedIndex === 0}
                onClick={() => setSelectedId(steps[selectedIndex - 1]?.id ?? selected.id)}
              >
                <ChevronLeft size={15} />
              </button>
              <div className="min-w-0 text-center">
                <div className="truncate font-mono text-xs font-medium text-text">{selected.filename}</div>
                <div className="mt-0.5 text-[11px] text-muted">
                  {t(`structureWorkflow.phase.${selected.phase}`)} · {t(`structureWorkflow.source.${selected.source}`)}
                </div>
              </div>
              <button
                type="button"
                className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30"
                aria-label={t("structureWorkflow.next")}
                disabled={selectedIndex === steps.length - 1}
                onClick={() => setSelectedId(steps[selectedIndex + 1]?.id ?? selected.id)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
              {steps.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setSelectedId(step.id)}
                  className={cn(
                    "flex h-7 shrink-0 items-center gap-1.5 rounded-input px-2 text-[11px] transition-colors",
                    step.id === selected.id
                      ? "bg-text text-surface"
                      : "bg-surface-2 text-muted hover:text-text",
                  )}
                  title={step.path}
                >
                  <CircleDot size={10} />
                  <span className="tabular-nums">{index + 1}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <StructureStepViewer
              key={selected.id}
              step={selected}
              workspaceDirectory={workspaceDirectory}
            />
          </div>
        </>
      ) : !discoveryComplete ? (
        <PaneState icon={<Loader2 size={16} className="animate-spin" />} text={t("structureWorkflow.loading")} />
      ) : (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-muted">
          {t("structureWorkflow.empty")}
        </div>
      )}
    </div>
  );
}

function StructureStepViewer({
  step,
  workspaceDirectory,
}: {
  step: StructureWorkflowStep;
  workspaceDirectory?: string;
}) {
  const { t } = useTranslation("inspector");
  const [text, setText] = useState(step.artifact.content ?? null);
  const [loading, setLoading] = useState(step.artifact.content === undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(step.artifact.content ?? null);
    setLoading(step.artifact.content === undefined);
    setError(null);
    if (step.artifact.content !== undefined) return () => { cancelled = true; };
    const load = async () => {
      const absolute = isAbsoluteStructurePath(step.path);
      const root = absolute ? "base" as const : undefined;
      const directory = absolute ? undefined : workspaceDirectory;
      if (isGatewayWeb) {
        const url = await previewUrl(step.path, root, directory);
        const response = url ? await fetch(url) : null;
        return response?.ok ? response.text() : null;
      }
      const file = await readArtifact(step.path, root, directory);
      return file?.encoding === "utf8" ? file.data : null;
    };
    void load()
      .then((file) => {
        if (cancelled) return;
        if (file !== null) setText(file);
        else setError(t("structureWorkflow.readError"));
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [step, t, workspaceDirectory]);

  if (loading) return <PaneState icon={<Loader2 size={16} className="animate-spin" />} text={t("structureWorkflow.loading")} />;
  if (error || text === null) return <PaneState text={error ?? t("structureWorkflow.readError")} />;
  return <StructureFrames step={step} text={text} workspaceDirectory={workspaceDirectory} />;
}

function StructureFrames({ step, text, workspaceDirectory }: { step: StructureWorkflowStep; text: string; workspaceDirectory?: string }) {
  if (step.filename.toLowerCase().endsWith(".extxyz")) {
    return <MolecularDynamicsView
      materialId={step.path}
      path={step.path}
      text={text}
      root={isAbsoluteStructurePath(step.path) ? "base" : undefined}
      workspaceDirectory={isAbsoluteStructurePath(step.path) ? undefined : workspaceDirectory}
    />;
  }
  return <ConventionalTrajectoryFrames step={step} text={text} />;
}

function ConventionalTrajectoryFrames({ step, text }: { step: StructureWorkflowStep; text: string }) {
  const { t } = useTranslation("inspector");
  const frames = useMemo(() => parseTrajectory(step, text), [step, text]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setFrame(0);
    setPlaying(false);
  }, [step.id]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % frames.length), 450);
    return () => window.clearInterval(timer);
  }, [frames.length, playing]);

  const activeFrame = frames[frame];
  const materialId = activeFrame?.materialId ?? step.path;
  return (
    <div className="relative h-full min-h-[320px]">
      <VaspFlowStructureView
        materialId={materialId}
        text={activeFrame ? undefined : text}
        trajectoryStructures={frames.length ? frames : undefined}
        trajectoryFrame={frame}
      />
      {frames.length > 1 && (
        <div className="absolute bottom-14 left-4 right-4 z-10 flex items-center gap-2 rounded-input border border-border/80 bg-white/95 px-2.5 py-2 shadow-card backdrop-blur">
          <button
            type="button"
            className={cn("rounded p-1 text-muted hover:bg-surface-2 hover:text-text", playing && "text-accent")}
            aria-label={playing ? t("structureWorkflow.pause") : t("structureWorkflow.play")}
            onClick={() => setPlaying((value) => !value)}
          >
            <Play size={13} fill={playing ? "currentColor" : "none"} />
          </button>
          <input
            className="min-w-0 flex-1 accent-accent"
            type="range"
            min={0}
            max={frames.length - 1}
            value={frame}
            aria-label={t("structureWorkflow.frame")}
            onChange={(event) => {
              setPlaying(false);
              setFrame(Number(event.target.value));
            }}
          />
          <span className="w-14 text-right font-mono text-[11px] tabular-nums text-muted">
            {frame + 1}/{frames.length}
          </span>
        </div>
      )}
    </div>
  );
}

function parseTrajectory(step: StructureWorkflowStep, text: string): CrystalStructure[] {
  const filename = step.filename.toLowerCase();
  if (filename === "xdatcar" || filename.endsWith(".xdatcar")) return parseXdatcarFrames(text, step.path);
  if (filename.endsWith(".lammpstrj") || filename.endsWith(".dump")) return parseLammpsDumpFrames(text, step.path);
  return [];
}

function PaneState({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return <div className="flex h-full items-center justify-center gap-2 px-8 text-center text-sm text-muted">{icon}{text}</div>;
}
