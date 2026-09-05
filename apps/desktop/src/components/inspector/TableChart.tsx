import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { analyzeColumns, defaultChartSpec, type ChartType } from "@/lib/tableChart";
import type { ParsedTable } from "@/lib/csv";
import { cn } from "@/lib/cn";

/**
 * Native chart for a parsed table (P1-5): plots numeric columns with the app's
 * shared chart palette (the same hues generated matplotlib figures use), so a
 * dataset the user opens gets a beautiful chart by default — line, bar, or
 * scatter — with X/Y column pickers. Renders identically in light and dark
 * (palette tokens are theme-aware). Offline, from the parsed rows alone.
 */
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

export function TableChart({ table }: { table: ParsedTable }) {
  const { t } = useTranslation(["inspector", "common"]);
  const cols = useMemo(() => analyzeColumns(table), [table]);
  const def = useMemo(() => defaultChartSpec(cols), [cols]);
  const [type, setType] = useState<ChartType>(def?.type ?? "line");
  const [xIndex, setXIndex] = useState<number>(def?.xIndex ?? -1);
  const [ys, setYs] = useState<number[]>(def?.yIndexes ?? []);

  if (!def) {
    return <div className="p-4 text-sm text-muted">{t("tableChart.noNumericColumns")}</div>;
  }

  const numericCols = cols.filter((c) => c.numeric);
  const xIsValue = type !== "bar" && xIndex >= 0 && (cols[xIndex]?.numeric ?? false);
  const n = table.rows.length;

  // X positions + labels.
  const xVals: number[] = [];
  const xLabels: string[] = [];
  for (let i = 0; i < n; i++) {
    if (xIsValue) xVals.push(cols[xIndex].values[i] ?? NaN);
    else xVals.push(i);
    xLabels.push(xIndex >= 0 ? (table.rows[i][xIndex] ?? "") : String(i + 1));
  }
  const xMin = xIsValue ? Math.min(...xVals.filter(Number.isFinite)) : 0;
  const xMax = xIsValue ? Math.max(...xVals.filter(Number.isFinite)) : Math.max(1, n - 1);
  const xSpan = xMax - xMin || 1;

  // Y range across selected series.
  let yMin = type === "bar" ? 0 : Infinity;
  let yMax = -Infinity;
  for (const s of ys) {
    for (const v of cols[s].values) {
      if (v === null) continue;
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (!Number.isFinite(yMin)) yMin = 0;
  if (!Number.isFinite(yMax)) yMax = 1;
  if (yMin === yMax) yMax = yMin + 1;
  const ySpan = yMax - yMin;

  const W = 680;
  const H = 360;
  const pad = { l: 56, r: 16, t: 16, b: 52 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const xAt = (i: number) =>
    xIsValue ? pad.l + ((xVals[i] - xMin) / xSpan) * plotW : pad.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => pad.t + ((yMax - v) / ySpan) * plotH;

  const toggleY = (idx: number) =>
    setYs((cur) => (cur.includes(idx) ? cur.filter((y) => y !== idx) : [...cur, idx].slice(0, 8)));

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
        <Segmented
          value={type}
          onChange={(v) => setType(v as ChartType)}
          options={["line", "bar", "scatter"]}
          labelFor={(v) => t(`tableChart.chartType.${v as ChartType}`)}
        />
        <label className="flex items-center gap-1 text-muted">
          {t("tableChart.xAxisFieldLabel")}
          <select
            value={xIndex}
            onChange={(e) => setXIndex(Number(e.target.value))}
            className="select-chrome rounded-input border border-border bg-surface-2 px-1.5 py-1 text-[12px] text-text"
          >
            <option value={-1}>{t("tableChart.rowIndexOption")}</option>
            {cols.map((c) => (
              <option key={c.index} value={c.index}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1">
          {numericCols.map((c) => {
            const on = ys.includes(c.index);
            return (
              <button
                key={c.index}
                onClick={() => toggleY(c.index)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] ring-1 transition-colors",
                  on ? "text-text ring-border" : "text-muted/60 ring-transparent hover:text-muted",
                )}
                style={on ? { background: "var(--surface-2)" } : undefined}
                title={on ? t("tableChart.toggleSeries.hide") : t("tableChart.toggleSeries.show")}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: on ? SERIES[ys.indexOf(c.index) % 8] : "var(--border)" }}
                />
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-full w-full max-w-[760px]">
          {/* y gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = yMin + f * ySpan;
            const y = yAt(v);
            return (
              <g key={f}>
                <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="currentColor" className="text-border" strokeWidth={0.75} strokeOpacity={0.6} />
                <text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-muted font-mono text-[10px]">
                  {v.toPrecision(3)}
                </text>
              </g>
            );
          })}

          {/* series */}
          {ys.map((sIdx, si) => {
            const color = SERIES[si % 8];
            const vals = cols[sIdx].values;
            if (type === "bar") {
              const groupW = (plotW / Math.max(1, n)) * 0.8;
              const barW = groupW / ys.length;
              return (
                <g key={sIdx}>
                  {vals.map((v, i) => {
                    if (v === null) return null;
                    const cx = xAt(i) - groupW / 2 + si * barW;
                    const y = yAt(v);
                    const zeroY = yAt(Math.max(0, yMin));
                    return <rect key={i} x={cx} y={Math.min(y, zeroY)} width={Math.max(1, barW - 1)} height={Math.abs(zeroY - y)} fill={color} fillOpacity={0.85} />;
                  })}
                </g>
              );
            }
            const pts = vals
              .map((v, i) => (v === null || (xIsValue && !Number.isFinite(xVals[i])) ? null : { x: xAt(i), y: yAt(v) }))
              .filter((p): p is { x: number; y: number } => p !== null);
            return (
              <g key={sIdx}>
                {type === "line" && pts.length > 1 && (
                  <path d={pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={1.75} />
                )}
                {pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={type === "scatter" ? 3 : 2.2} fill={color} />
                ))}
              </g>
            );
          })}

          {/* x labels (thinned to ~8) */}
          {xLabels.map((lab, i) => {
            const step = Math.ceil(n / 8);
            if (i % step !== 0 && i !== n - 1) return null;
            return (
              <text key={i} x={xAt(i)} y={H - pad.b + 16} textAnchor="middle" className="fill-muted font-mono text-[9.5px]">
                {lab.length > 8 ? lab.slice(0, 7) + "…" : lab}
              </text>
            );
          })}
          <text x={pad.l + plotW / 2} y={H - 6} textAnchor="middle" className="fill-muted font-mono text-[10px]">
            {xIndex >= 0 ? cols[xIndex].name : t("tableChart.rowLabel")}
          </text>
        </svg>
      </div>

      <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px]">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {ys.map((sIdx, si) => (
            <span key={sIdx} className="inline-flex items-center gap-1 text-muted">
              <span className="h-2 w-3 rounded-sm" style={{ background: SERIES[si % 8] }} />
              {cols[sIdx].name}
            </span>
          ))}
        </div>
        {ys.length === 0 && <span className="text-muted/50">{t("tableChart.selectSeriesHint")}</span>}
      </div>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
  labelFor,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labelFor?: (v: string) => string;
}) {
  return (
    <div className="flex overflow-hidden rounded-md ring-1 ring-border">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "px-2 py-1 text-[11px] font-medium capitalize transition-colors",
            value === o ? "bg-surface-2 text-text" : "text-muted hover:text-text",
          )}
        >
          {labelFor ? labelFor(o) : o}
        </button>
      ))}
    </div>
  );
}
