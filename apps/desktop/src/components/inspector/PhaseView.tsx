import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parsePhaseDiagram, type PhaseDiagram } from "@/lib/phase";

/**
 * Binary phase-diagram viewer (P1-3, materials): plots formation energy per atom
 * vs composition from a `.phase` file, draws the convex-hull tie-lines, and
 * marks stable phases (on the hull) vs metastable ones (above it, with their
 * energy above hull). Completes the materials trio with the DOS + band viewers.
 * Offline, from the file alone; uses the app chart palette.
 */
export function PhaseView({ filename, text }: { filename: string; text: string }) {
  const { t } = useTranslation(["inspector", "common"]);
  const parsed = useMemo<{ pd: PhaseDiagram | null; error: string | null }>(() => {
    try {
      return { pd: parsePhaseDiagram(text), error: null };
    } catch (e) {
      return { pd: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);

  const [hover, setHover] = useState<string | null>(null);

  if (parsed.error || !parsed.pd) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-sm items-start gap-2 rounded-card border border-border bg-surface p-4 text-sm text-muted">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
          <span>{t("phase.readError", { error: parsed.error ?? t("phase.unknownFormat") })}</span>
        </div>
      </div>
    );
  }

  const pd = parsed.pd;
  const W = 680;
  const H = 380;
  const pad = { l: 60, r: 20, t: 20, b: 44 };
  const ys = pd.entries.map((e) => e.y);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const ySpan = yMax - yMin || 1;
  const xAt = (x: number) => pad.l + x * (W - pad.l - pad.r);
  const yAt = (y: number) => pad.t + ((yMax - y) / ySpan) * (H - pad.t - pad.b);

  const hullPath = pd.hull
    .map((h, i) => `${i === 0 ? "M" : "L"}${xAt(h.x).toFixed(1)},${yAt(h.y).toFixed(1)}`)
    .join(" ");

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          {filename} · {pd.elements[0]}–{pd.elements[1]} · {t("phase.phaseCount", { count: pd.entries.length })} ·{" "}
          {t("phase.stableCount", { count: pd.entries.filter((e) => e.stable).length })}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-full w-full max-w-[760px]">
          {/* y gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = yMin + f * ySpan;
            const yy = yAt(y);
            return (
              <g key={f}>
                <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="currentColor" className="text-border" strokeWidth={y === 0 ? 1.25 : 0.75} strokeOpacity={y === 0 ? 1 : 0.6} />
                <text x={pad.l - 6} y={yy + 3} textAnchor="end" className="fill-muted font-mono text-[10px]">
                  {y.toFixed(2)}
                </text>
              </g>
            );
          })}
          {/* convex hull tie-lines */}
          <path d={hullPath} fill="none" stroke="var(--series-1)" strokeWidth={1.5} />
          {/* entries */}
          {pd.entries.map((e) => {
            const on = hover === e.formula;
            return (
              <g
                key={e.formula}
                onMouseEnter={() => setHover(e.formula)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "default" }}
              >
                <circle
                  cx={xAt(e.x)}
                  cy={yAt(e.y)}
                  r={e.stable ? 5 : 3.5}
                  fill={e.stable ? "var(--series-1)" : "var(--surface)"}
                  stroke={e.stable ? "var(--series-1)" : "var(--series-6)"}
                  strokeWidth={1.5}
                  fillOpacity={e.stable ? 1 : 0.9}
                />
                {(e.stable || on) && (
                  <text
                    x={xAt(e.x)}
                    y={yAt(e.y) - 9}
                    textAnchor="middle"
                    className="fill-text font-mono text-[10px]"
                  >
                    {e.formula}
                  </text>
                )}
              </g>
            );
          })}
          {/* x labels: pure endpoints */}
          <text x={xAt(0)} y={H - pad.b + 16} textAnchor="middle" className="fill-muted font-mono text-[11px]">
            {pd.elements[0]}
          </text>
          <text x={xAt(1)} y={H - pad.b + 16} textAnchor="middle" className="fill-muted font-mono text-[11px]">
            {pd.elements[1]}
          </text>
          <text x={W / 2} y={H - 6} textAnchor="middle" className="fill-muted font-mono text-[10px]">
            {t("phase.xAxisLabel", { element: pd.elements[1] })}
          </text>
          <text x={16} y={H / 2} textAnchor="middle" transform={`rotate(-90 16 ${H / 2})`} className="fill-muted font-mono text-[10px]">
            {t("phase.yAxisLabel")}
          </text>
        </svg>
      </div>

      <div className="border-t border-border px-3 py-2 text-right font-mono text-[11px] text-muted">
        {hover ? (
          (() => {
            const e = pd.entries.find((x) => x.formula === hover)!;
            return (
              <span>
                {/* eslint-disable-next-line i18next/no-literal-string -- physics notation/units ("E_f =", "eV/atom"), not prose; consistent with the rest of this inspector family */}
                <span className="text-text">{e.formula}</span> · E_f = {e.y.toFixed(3)} eV/atom ·{" "}
                {e.stable
                  ? t("phase.stableOnHull")
                  : t("phase.aboveHull", { value: e.eAboveHull.toFixed(3) })}
              </span>
            );
          })()
        ) : (
          <span className="text-muted/50">{t("phase.hoverDefaultHint")}</span>
        )}
      </div>
    </div>
  );
}
