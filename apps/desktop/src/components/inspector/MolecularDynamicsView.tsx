import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import { Activity, Gauge, Pause, Play, SkipBack, SkipForward, Snowflake, Thermometer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileRoot } from "@ai4s/shared";
import { previewUrl, readArtifact } from "@/lib/artifactFile";
import { cn } from "@/lib/cn";
import {
  nearestFrameIndexForStep,
  parseExtxyzTrajectory,
  parseUmaThermoCsv,
  thermoRowForFrame,
  type UmaThermoRow,
} from "@/lib/mdTrajectory";
import { isGatewayWeb } from "@/lib/webMode";
import { VaspFlowStructureView } from "./VaspFlowStructureView";

type ChartMode = "temperature" | "energy" | "distance" | "force";

export function MolecularDynamicsView({
  materialId,
  path,
  text,
  thermoText,
  manifestText,
  root,
  workspaceDirectory,
}: {
  materialId: string;
  path: string;
  text: string;
  thermoText?: string;
  manifestText?: string;
  root?: FileRoot;
  workspaceDirectory?: string;
}) {
  const { t } = useTranslation("inspector");
  const trajectory = useMemo(() => parseExtxyzTrajectory(text, materialId), [materialId, text]);
  const structures = useMemo(() => trajectory.frames.map((frame) => frame.structure), [trajectory.frames]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [chartMode, setChartMode] = useState<ChartMode>("temperature");
  const [thermoRows, setThermoRows] = useState<UmaThermoRow[]>([]);
  const [targetTemperature, setTargetTemperature] = useState<number | undefined>();
  const [manifestAdsorbateAtomCount, setManifestAdsorbateAtomCount] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    setPlaying(false);
  }, [path, text]);

  useEffect(() => {
    if (thermoText !== undefined || manifestText !== undefined) {
      setThermoRows(thermoText ? parseUmaThermoCsv(thermoText) : []);
      const metadata = readManifestMetadata(manifestText ?? null);
      setTargetTemperature(metadata.targetTemperature);
      setManifestAdsorbateAtomCount(metadata.adsorbateAtomCount);
      return;
    }
    if (!isTrajectoryFilename(path)) {
      setThermoRows([]);
      setTargetTemperature(undefined);
      setManifestAdsorbateAtomCount(0);
      return;
    }
    let cancelled = false;
    const trajectoryDirectory = parentPath(path);
    const runDirectory = parentPath(trajectoryDirectory);
    void Promise.all([
      readOptionalText(joinPath(trajectoryDirectory, "thermo.csv"), root, workspaceDirectory),
      readOptionalText(joinPath(runDirectory, "md-manifest.json"), root, workspaceDirectory),
    ]).then(([thermo, manifest]) => {
      if (cancelled) return;
      setThermoRows(thermo ? parseUmaThermoCsv(thermo) : []);
      const metadata = readManifestMetadata(manifest);
      setTargetTemperature(metadata.targetTemperature);
      setManifestAdsorbateAtomCount(metadata.adsorbateAtomCount);
    });
    return () => {
      cancelled = true;
    };
  }, [manifestText, path, root, thermoText, workspaceDirectory]);

  useEffect(() => {
    if (!playing || trajectory.frames.length < 2) return;
    const interval = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % trajectory.frames.length);
    }, Math.round(125 / speed));
    return () => window.clearInterval(interval);
  }, [playing, speed, trajectory.frames.length]);

  const activeFrame = trajectory.frames[frameIndex];
  const thermo = thermoRowForFrame(activeFrame, frameIndex, trajectory.frames.length, thermoRows);
  const fixedAtomCount = activeFrame?.structure.sites.filter((site) => site.properties?.fixed === true).length ?? 0;
  const explicitAdsorbateAtomCount = activeFrame?.structure.sites.filter((site) => site.properties?.role === "adsorbate").length ?? 0;
  const adsorbateAtomCount = explicitAdsorbateAtomCount || manifestAdsorbateAtomCount;
  const phase = activeFrame?.phase ?? thermo?.phase;
  const phaseLabel = phase === "equilibration"
    ? t("structureWorkflow.mdPhase.equilibration")
    : phase === "production"
      ? t("structureWorkflow.mdPhase.production")
      : phase;
  const selectThermoStep = useCallback((step: number) => {
    setPlaying(false);
    setFrameIndex(nearestFrameIndexForStep(trajectory.frames, step));
  }, [trajectory.frames]);

  if (!trajectory.frames.length) {
    return <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center text-sm text-muted">{t("structureWorkflow.trajectoryEmpty")}</div>;
  }
  if (trajectory.frames.length === 1 && !isTrajectoryFilename(path)) {
    return <VaspFlowStructureView materialId={materialId} trajectoryStructures={structures} />;
  }

  return (
    <div className="flex h-full min-h-[600px] w-full flex-col overflow-hidden bg-surface">
      <div className="min-h-[320px] flex-[1_1_auto]">
        <VaspFlowStructureView
          materialId={materialId}
          trajectoryStructures={structures}
          trajectoryFrame={frameIndex}
        />
      </div>
      <section className="shrink-0 border-t border-border bg-surface px-3 pb-3 pt-2.5">
        <div className="flex min-h-8 items-center gap-1.5">
          <IconButton
            label={t("structureWorkflow.firstFrame")}
            onClick={() => { setPlaying(false); setFrameIndex(0); }}
            disabled={frameIndex === 0}
          >
            <SkipBack size={14} />
          </IconButton>
          <IconButton
            label={playing ? t("structureWorkflow.pause") : t("structureWorkflow.play")}
            onClick={() => setPlaying((value) => !value)}
            active={playing}
          >
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </IconButton>
          <IconButton
            label={t("structureWorkflow.lastFrame")}
            onClick={() => { setPlaying(false); setFrameIndex(trajectory.frames.length - 1); }}
            disabled={frameIndex === trajectory.frames.length - 1}
          >
            <SkipForward size={14} />
          </IconButton>
          <input
            className="min-w-0 flex-1 accent-accent"
            type="range"
            min={0}
            max={trajectory.frames.length - 1}
            value={frameIndex}
            aria-label={t("structureWorkflow.frame")}
            onChange={(event) => {
              setPlaying(false);
              setFrameIndex(Number(event.target.value));
            }}
          />
          <span className="w-[68px] text-right font-mono text-[11px] tabular-nums text-muted">
            {frameIndex + 1}/{trajectory.frames.length}
          </span>
          <label className="flex h-7 items-center gap-1 rounded-input border border-border bg-surface px-1.5 text-[11px] text-muted">
            <Gauge size={12} />
            <span className="sr-only">{t("structureWorkflow.speed")}</span>
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="bg-transparent font-mono text-[11px] text-text outline-none"
              aria-label={t("structureWorkflow.speed")}
            >
              {/* eslint-disable-next-line i18next/no-literal-string -- conventional playback multiplier notation */}
              {[0.25, 0.5, 1, 2].map((value) => <option key={value} value={value}>{value}x</option>)}
            </select>
          </label>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-y border-border/70 py-2 sm:grid-cols-4">
          <Metric label={t("structureWorkflow.metric.temperature")} value={formatMetric(thermo?.temperatureK, "K")} icon={<Thermometer size={12} />} />
          <Metric label={t("structureWorkflow.metric.totalEnergy")} value={formatMetric(thermo?.totalEnergyEv, "eV")} icon={<Activity size={12} />} />
          <Metric label={t("structureWorkflow.metric.minDistance")} value={formatMetric(thermo?.minimumDistanceAngstrom, "\u00c5")} icon={<Gauge size={12} />} />
          <Metric label={t("structureWorkflow.metric.maxForce")} value={formatMetric(thermo?.maxForceEvPerAngstrom, "eV/\u00c5")} icon={<Activity size={12} />} />
        </div>

        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          <span className="font-mono text-text">
            {t("structureWorkflow.stepValue", { step: activeFrame.step ?? thermo?.step ?? activeFrame.sourceIndex })}
          </span>
          <span>{formatTime(activeFrame.timeFs ?? thermo?.timeFs, t("structureWorkflow.timeUnknown"))}</span>
          {phaseLabel && <span className="rounded bg-surface-2 px-1.5 py-0.5">{phaseLabel}</span>}
          {fixedAtomCount > 0 && <span className="flex items-center gap-1"><Snowflake size={11} />{t("structureWorkflow.fixedAtoms", { count: fixedAtomCount })}</span>}
          {adsorbateAtomCount > 0 && <span>{t("structureWorkflow.adsorbateAtoms", { count: adsorbateAtomCount })}</span>}
          {trajectory.sampled && <span className="tabular-nums sm:ml-auto">{t("structureWorkflow.previewFrames", { shown: trajectory.frames.length, total: trajectory.totalFrames })}</span>}
        </div>

        {thermoRows.length > 1 && (
          <div className="mt-2">
            <div className="flex items-center gap-1" role="tablist" aria-label={t("structureWorkflow.chart")}> 
              {/* eslint-disable-next-line i18next/no-literal-string -- internal chart mode ids; visible labels are translated */}
              {(["temperature", "energy", "distance", "force"] as ChartMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={chartMode === mode}
                  onClick={() => setChartMode(mode)}
                  className={cn(
                    "h-6 rounded px-2 text-[11px] font-medium",
                    chartMode === mode ? "bg-text text-surface" : "text-muted hover:bg-surface-2 hover:text-text",
                  )}
                >
                  {t(`structureWorkflow.chartMode.${mode}`)}
                </button>
              ))}
            </div>
            <MolecularDynamicsChart
              rows={thermoRows}
              current={thermo}
              mode={chartMode}
              targetTemperature={targetTemperature}
              onSelectStep={selectThermoStep}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function MolecularDynamicsChart({
  rows,
  current,
  mode,
  targetTemperature,
  onSelectStep,
}: {
  rows: readonly UmaThermoRow[];
  current?: UmaThermoRow;
  mode: ChartMode;
  targetTemperature?: number;
  onSelectStep: (step: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const selectRef = useRef(onSelectStep);
  const optionRef = useRef<EChartsOption>({});
  const { t } = useTranslation("inspector");
  selectRef.current = onSelectStep;
  optionRef.current = chartOptions(rows, current, mode, targetTemperature, t);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    void import("echarts").then((echarts) => {
      if (cancelled || !hostRef.current) return;
      const chart = echarts.init(hostRef.current, undefined, { renderer: "canvas" });
      chartRef.current = chart;
      chart.on("click", (params) => {
        const index = typeof params.dataIndex === "number" ? params.dataIndex : -1;
        if (index >= 0 && rows[index]) selectRef.current(rows[index].step);
      });
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(hostRef.current);
      chart.setOption(optionRef.current, { notMerge: true });
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [rows, t]);

  useEffect(() => {
    chartRef.current?.setOption(chartOptions(rows, current, mode, targetTemperature, t), { notMerge: true });
  }, [current, mode, rows, targetTemperature, t]);

  return <div ref={hostRef} data-testid="md-thermo-chart" className="h-32 w-full" />;
}

function chartOptions(
  rows: readonly UmaThermoRow[],
  current: UmaThermoRow | undefined,
  mode: ChartMode,
  targetTemperature: number | undefined,
  t: ReturnType<typeof useTranslation<"inspector">>["t"],
): EChartsOption {
  const style = getComputedStyle(document.documentElement);
  const text = style.getPropertyValue("--text-muted").trim() || "#69747d";
  const border = style.getPropertyValue("--border").trim() || "#d9dee2";
  const accent = style.getPropertyValue("--accent").trim() || "#137a67";
  const red = "#c94a3f";
  const x = rows.map((row) => row.timeFs / 1000);
  const series: NonNullable<EChartsOption["series"]> = [];
  const addSeries = (name: string, values: Array<number | undefined>, color: string, dashed = false) => {
    (series as Array<Record<string, unknown>>).push({
      name,
      type: "line",
      data: values.map((value, index) => [x[index], value ?? null]),
      symbol: "none",
      connectNulls: false,
      lineStyle: { width: 1.5, color, type: dashed ? "dashed" : "solid" },
      itemStyle: { color },
      animation: false,
      markLine: current ? {
        silent: true,
        symbol: "none",
        label: { show: false },
        lineStyle: { color: text, width: 1, type: "dotted" },
        data: [{ xAxis: current.timeFs / 1000 }],
      } : undefined,
    });
  };
  if (mode === "temperature") {
    addSeries(t("structureWorkflow.chartSeries.temperature"), rows.map((row) => row.temperatureK), accent);
    if (targetTemperature !== undefined) addSeries(t("structureWorkflow.chartSeries.target"), rows.map(() => targetTemperature), red, true);
  } else if (mode === "energy") {
    addSeries(t("structureWorkflow.chartSeries.potentialEnergy"), rows.map((row) => row.potentialEnergyEv), accent);
    addSeries(t("structureWorkflow.chartSeries.totalEnergy"), rows.map((row) => row.totalEnergyEv), red);
  } else if (mode === "distance") {
    addSeries(t("structureWorkflow.chartSeries.minimumDistance"), rows.map((row) => row.minimumDistanceAngstrom), accent);
  } else {
    addSeries(t("structureWorkflow.chartSeries.maximumForce"), rows.map((row) => row.maxForceEvPerAngstrom), red);
  }
  return {
    animation: false,
    grid: { left: 44, right: 10, top: 24, bottom: 24 },
    tooltip: { trigger: "axis", confine: true },
    legend: { top: 0, left: 0, textStyle: { color: text, fontSize: 10 }, itemWidth: 12, itemHeight: 6 },
    xAxis: {
      type: "value",
      name: "ps",
      nameTextStyle: { color: text, fontSize: 10 },
      axisLabel: { color: text, fontSize: 10 },
      axisLine: { lineStyle: { color: border } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { lineStyle: { color: border, opacity: 0.55 } },
    },
    series,
  };
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="min-w-0">
    <div className="flex items-center gap-1 text-[10px] text-muted">{icon}<span className="truncate">{label}</span></div>
    <div className="mt-0.5 truncate font-mono text-xs font-medium tabular-nums text-text">{value}</div>
  </div>;
}

function IconButton({ children, label, onClick, disabled, active }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30", active && "bg-surface-2 text-accent")}
  >{children}</button>;
}

function formatMetric(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 1 : magnitude >= 10 ? 2 : 3;
  return `${value.toFixed(digits)} ${unit}`;
}

function formatTime(timeFs: number | undefined, fallback: string): string {
  if (timeFs === undefined || !Number.isFinite(timeFs)) return fallback;
  return timeFs >= 1000 ? `${(timeFs / 1000).toFixed(3)} ps` : `${timeFs.toFixed(1)} fs`;
}

function isTrajectoryFilename(path: string): boolean {
  return /(?:^|[\\/])trajectory(?:-preview)?\.extxyz$/i.test(path);
}

function parentPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex < 0 ? "" : path.slice(0, separatorIndex);
}

function joinPath(directory: string, filename: string): string {
  if (!directory) return filename;
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]$/, "")}${separator}${filename}`;
}

async function readOptionalText(path: string, root?: FileRoot, workspaceDirectory?: string): Promise<string | null> {
  try {
    if (isGatewayWeb) {
      const url = await previewUrl(path, root, workspaceDirectory);
      const response = url ? await fetch(url) : null;
      return response?.ok ? response.text() : null;
    }
    const file = await readArtifact(path, root, workspaceDirectory);
    return file?.encoding === "utf8" ? file.data : null;
  } catch {
    return null;
  }
}

function readManifestMetadata(text: string | null): { targetTemperature?: number; adsorbateAtomCount: number } {
  if (!text) return { adsorbateAtomCount: 0 };
  try {
    const manifest = JSON.parse(text) as {
      protocol?: { temperature_k?: unknown };
      input?: { adsorbate_natoms?: unknown };
    };
    const targetTemperature = Number(manifest.protocol?.temperature_k);
    const adsorbateAtomCount = Number(manifest.input?.adsorbate_natoms);
    return {
      targetTemperature: Number.isFinite(targetTemperature) ? targetTemperature : undefined,
      adsorbateAtomCount: Number.isInteger(adsorbateAtomCount) && adsorbateAtomCount > 0 ? adsorbateAtomCount : 0,
    };
  } catch {
    return { adsorbateAtomCount: 0 };
  }
}
