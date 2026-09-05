import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parseDoscar, type DosData } from "@/lib/dos";
import { cn } from "@/lib/cn";

/**
 * Native density-of-states viewer for materials (P1-3): renders a VASP DOSCAR
 * total DOS as a filled curve — spin-polarized files show spin-up above the
 * axis and spin-down mirrored below (the canonical presentation) — with the
 * Fermi level marked. Offline, from the file alone; uses the app chart palette.
 */
export function DosView({ filename, bytes }: { filename: string; bytes: ArrayBuffer }) {
  const { t } = useTranslation(["inspector", "common"]);
  const parsed = useMemo<{ dos: DosData | null; error: string | null }>(() => {
    try {
      return { dos: parseDoscar(new TextDecoder().decode(bytes)), error: null };
    } catch (e) {
      return { dos: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [bytes]);

  const [alignFermi, setAlignFermi] = useState(true);
  const [hover, setHover] = useState<{ i: number } | null>(null);

  if (parsed.error || !parsed.dos) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-sm items-start gap-2 rounded-card border border-border bg-surface p-4 text-sm text-muted">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
          <span>{t("dos.readError", { error: parsed.error ?? t("dos.unknownFormat") })}</span>
        </div>
      </div>
    );
  }

  const dos = parsed.dos;
  const W = 680;
  const H = 340;
  const pad = { l: 56, r: 16, t: 16, b: 40 };
  const shift = alignFermi ? dos.efermi : 0;
  const xs = dos.energies.map((e) => e - shift);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;
  const upMax = Math.max(1e-9, ...dos.up);
  const downMax = dos.down ? Math.max(1e-9, ...dos.down) : 0;
  const yMax = Math.max(upMax, downMax);

  const xAt = (e: number) => pad.l + ((e - xMin) / xSpan) * (W - pad.l - pad.r);
  const zeroY = dos.spin ? (H - pad.b + pad.t) / 2 : H - pad.b; // baseline
  const yUp = (v: number) => zeroY - (v / yMax) * (zeroY - pad.t);
  const yDown = (v: number) => zeroY + (v / yMax) * (H - pad.b - zeroY);

  const areaUp =
    `M${xAt(xs[0])},${zeroY} ` +
    xs.map((e, i) => `L${xAt(e).toFixed(1)},${yUp(dos.up[i]).toFixed(1)}`).join(" ") +
    ` L${xAt(xs[xs.length - 1])},${zeroY} Z`;
  const areaDown = dos.down
    ? `M${xAt(xs[0])},${zeroY} ` +
      xs.map((e, i) => `L${xAt(e).toFixed(1)},${yDown(dos.down![i]).toFixed(1)}`).join(" ") +
      ` L${xAt(xs[xs.length - 1])},${zeroY} Z`
    : null;

  const fermiX = xAt(alignFermi ? 0 : dos.efermi);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    // nearest energy sample to the cursor
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xAt(xs[i]) - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover({ i: best });
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          {filename} · {t("dos.viewLabel")} · {t("dos.pointCount", { count: dos.nedos })}
          {dos.spin ? t("dos.spinPolarizedSuffix") : ""}
        </span>
        <button
          onClick={() => setAlignFermi((v) => !v)}
          className={cn(
            "rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition-colors",
            alignFermi
              ? "bg-accent/15 text-accent ring-accent/30"
              : "bg-surface-2 text-muted ring-border hover:text-text",
          )}
        >
          {alignFermi ? t("dos.axisToggle.relative") : t("dos.axisToggle.absolute")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto max-h-full w-full max-w-[760px]"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* y baseline */}
          <line x1={pad.l} y1={zeroY} x2={W - pad.r} y2={zeroY} className="text-border" stroke="currentColor" strokeWidth={1} />
          {/* filled DOS areas */}
          <path d={areaUp} fill="var(--series-1)" fillOpacity={0.85} stroke="var(--series-1)" strokeWidth={1} />
          {areaDown && (
            <path d={areaDown} fill="var(--series-6)" fillOpacity={0.8} stroke="var(--series-6)" strokeWidth={1} />
          )}
          {/* Fermi level */}
          <line x1={fermiX} y1={pad.t} x2={fermiX} y2={H - pad.b} stroke="var(--series-3)" strokeWidth={1.25} strokeDasharray="4 3" />
          <text x={fermiX + 4} y={pad.t + 10} className="fill-muted font-mono text-[10px]">
            E_F
          </text>
          {/* hover marker */}
          {hover && (
            <line x1={xAt(xs[hover.i])} y1={pad.t} x2={xAt(xs[hover.i])} y2={H - pad.b} stroke="currentColor" className="text-muted" strokeWidth={0.6} strokeDasharray="2 2" />
          )}
          {/* x ticks */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const e = xMin + f * xSpan;
            return (
              <text key={f} x={xAt(e)} y={H - pad.b + 16} textAnchor="middle" className="fill-muted font-mono text-[10px]">
                {e.toFixed(1)}
              </text>
            );
          })}
          {dos.spin && (
            <>
              <text x={pad.l + 4} y={pad.t + 10} className="fill-muted font-mono text-[10px]">{t("dos.spinUpLabel")}</text>
              <text x={pad.l + 4} y={H - pad.b - 4} className="fill-muted font-mono text-[10px]">{t("dos.spinDownLabel")}</text>
            </>
          )}
          <text x={W / 2} y={H - 4} textAnchor="middle" className="fill-muted font-mono text-[10px]">
            {alignFermi ? t("dos.axisLabel.relative") : t("dos.axisLabel.absolute")}
          </text>
          <text x={14} y={H / 2} textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`} className="fill-muted font-mono text-[10px]">
            {t("dos.yAxisLabel")}
          </text>
        </svg>
      </div>

      <div className="border-t border-border px-3 py-2 text-right font-mono text-[11px] text-muted">
        {hover ? (
          /* eslint-disable i18next/no-literal-string -- physics notation/units ("E =", "(rel. E_F)", "eV", "DOS↑/↓ ="), not prose; consistent with the rest of this inspector family. Scoped to this one hover-notation fragment only, re-enabled right below. */
          <>
            E = {xs[hover.i].toFixed(3)}{alignFermi ? " (rel. E_F)" : ""} eV · DOS↑ = {dos.up[hover.i].toPrecision(4)}
            {dos.down ? ` · DOS↓ = ${dos.down[hover.i].toPrecision(4)}` : ""}
          </>
          /* eslint-enable i18next/no-literal-string */
        ) : (
          <span className="text-muted/50">{t("dos.emptyHint")}</span>
        )}
      </div>
    </div>
  );
}
