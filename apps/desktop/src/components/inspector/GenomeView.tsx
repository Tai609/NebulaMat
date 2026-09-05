import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dna, Minus, Plus, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { extOf } from "@/lib/artifacts";
import {
  formatBp,
  genomeFormat,
  packRows,
  parseGenome,
  type GenomeFeature,
} from "@/lib/genome";
import { cn } from "@/lib/cn";

const ROW_H = 15;
const MAX_ROWS = 60; // cap drawn rows so a dense contig can't blow up the DOM
const RULER_H = 26;
const MIN_SPAN = 20; // don't zoom past ~20 bp

/**
 * Native genome-track viewer (P1-3) for annotation files
 * (BED / bedGraph / GFF3 / GTF / VCF). Renders features as horizontal tracks on
 * a base-pair axis — drag to pan, wheel to zoom — entirely locally from the file
 * alone (no reference genome, no service). Colors follow the app's series
 * palette and are theme-aware via CSS tokens.
 */
export function GenomeView({ filename, text }: { filename: string; text: string }) {
  const { t } = useTranslation(["inspector", "common"]);
  const format = useMemo(() => genomeFormat(extOf(filename)), [filename]);
  const data = useMemo(
    () => (format ? parseGenome(text, format) : null),
    [format, text],
  );

  const [contigIdx, setContigIdx] = useState(0);
  const contig = data?.contigs[contigIdx];

  // Features on the selected contig, and a stable row assignment for them.
  const { contigFeatures, rows } = useMemo(() => {
    if (!data || !contig) return { contigFeatures: [] as GenomeFeature[], rows: [] as number[] };
    const cf = data.features.filter((f) => f.chrom === contig.name);
    return { contigFeatures: cf, rows: packRows(cf) };
  }, [data, contig]);

  // Category → color index (by type for GFF/GTF, else by strand).
  const categories = useMemo(() => categorize(contigFeatures, format, t), [contigFeatures, format, t]);

  const [view, setView] = useState<{ start: number; end: number } | null>(null);
  const [width, setWidth] = useState(760);
  const [hover, setHover] = useState<{ f: GenomeFeature; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; startBp: number; span: number } | null>(null);

  // Reset the viewport to the whole contig when the contig changes.
  useEffect(() => {
    if (!contig) return setView(null);
    const pad = Math.max(1, Math.round((contig.max - contig.min) * 0.02));
    setView({ start: Math.max(0, contig.min - pad), end: contig.max + pad });
    setHover(null);
  }, [contig]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 760));
    ro.observe(el);
    setWidth(el.clientWidth || 760);
    return () => ro.disconnect();
  }, []);

  if (!format) return <div className="p-4 text-sm text-muted">{t("genome.notAnnotationFile")}</div>;
  if (!data || data.features.length === 0 || !contig || !view)
    return (
      <div className="p-4 text-sm text-muted">
        {t("genome.noFeaturesFound", { format: format.toUpperCase() })}
      </div>
    );

  const extent = { start: Math.max(0, contig.min - 1), end: contig.max + 1 };
  const span = Math.max(MIN_SPAN, view.end - view.start);
  const xOf = (bp: number) => ((bp - view.start) / span) * width;
  const rowsShown = Math.min(MAX_ROWS, rows.length ? Math.max(...rows) + 1 : 1);
  const bodyH = rowsShown * ROW_H + 8;

  const clampView = (start: number, end: number) => {
    let s = start;
    let e = end;
    const sp = Math.max(MIN_SPAN, Math.min(e - s, extent.end - extent.start));
    if (s < extent.start) {
      s = extent.start;
      e = s + sp;
    }
    if (e > extent.end) {
      e = extent.end;
      s = e - sp;
    }
    return { start: Math.max(extent.start, s), end: e };
  };

  const zoomAt = (factor: number, atX: number) => {
    const cursorBp = view.start + (atX / width) * span;
    const newSpan = Math.max(MIN_SPAN, Math.min(span * factor, extent.end - extent.start));
    const start = cursorBp - (atX / width) * newSpan;
    setView(clampView(start, start + newSpan));
  };

  const visible = contigFeatures
    .map((f, i) => ({ f, row: rows[i] }))
    .filter((d) => d.row < MAX_ROWS && xOf(d.f.end + 1) >= 0 && xOf(d.f.start) <= width);

  // Ruler ticks at "nice" round base-pair intervals.
  const ticks = niceTicks(view.start, view.end, 6);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="flex items-center gap-1 font-medium text-muted">
          <Dna size={13} /> {format.toUpperCase()}
        </span>
        {data.contigs.length > 1 ? (
          <select
            className="select-chrome rounded-input border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:border-accent/50"
            value={contigIdx}
            onChange={(e) => setContigIdx(Number(e.target.value))}
            aria-label={t("genome.contigAria")}
          >
            {data.contigs.map((c, i) => (
              <option key={c.name} value={i}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-text">{contig.name}</span>
        )}
        <span className="text-muted">
          {formatBp(view.start)}–{formatBp(view.end)} ·{" "}
          {t("genome.featureCount", { count: contig.count })}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <IconBtn label={t("genome.zoomIn")} onClick={() => zoomAt(0.6, width / 2)}>
            <Plus size={13} />
          </IconBtn>
          <IconBtn label={t("genome.zoomOut")} onClick={() => zoomAt(1.66, width / 2)}>
            <Minus size={13} />
          </IconBtn>
          <IconBtn
            label={t("genome.resetView")}
            onClick={() => setView({ start: extent.start, end: extent.end })}
          >
            <RotateCcw size={12} />
          </IconBtn>
        </div>
      </div>

      {categories.list.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[11px] text-muted">
          {categories.list.map((c) => (
            <span key={c.label} className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: `var(--series-${c.color})` }}
              />
              {c.label}
            </span>
          ))}
        </div>
      )}

      <div
        ref={boxRef}
        className={cn("relative flex-1 overflow-hidden", dragRef.current ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { x: e.clientX, startBp: view.start, span };
          setHover(null);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const dxBp = ((e.clientX - d.x) / width) * d.span;
          setView(clampView(d.startBp - dxBp, d.startBp - dxBp + d.span));
        }}
        onPointerUp={(e) => {
          dragRef.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onWheel={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          zoomAt(e.deltaY > 0 ? 1.2 : 0.83, e.clientX - rect.left);
        }}
      >
        <svg width={width} height={RULER_H + bodyH} className="block">
          {/* Ruler */}
          <line x1={0} y1={RULER_H - 0.5} x2={width} y2={RULER_H - 0.5} stroke="var(--border)" />
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={xOf(tick)} y1={RULER_H - 5} x2={xOf(tick)} y2={RULER_H} stroke="var(--border)" />
              <text x={xOf(tick) + 3} y={RULER_H - 8} fontSize={10} fill="var(--muted)" fontFamily="ui-monospace, monospace">
                {formatBp(tick)}
              </text>
            </g>
          ))}
          {/* Features */}
          {visible.map(({ f, row }, i) => {
            const x = xOf(f.start);
            const w = Math.max(2, xOf(f.end + 1) - x);
            const y = RULER_H + 4 + row * ROW_H;
            const color = `var(--series-${categories.colorOf(f)})`;
            return (
              <rect
                key={`${f.start}-${f.end}-${i}`}
                x={x}
                y={y}
                width={w}
                height={ROW_H - 4}
                rx={2}
                fill={color}
                opacity={hover?.f === f ? 1 : 0.85}
                onPointerEnter={(e) => {
                  const rect = boxRef.current?.getBoundingClientRect();
                  setHover({ f, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
                }}
                onPointerLeave={() => setHover((h) => (h?.f === f ? null : h))}
              />
            );
          })}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-input border border-border bg-surface px-2.5 py-1.5 text-[11px] shadow-card"
            style={{ left: Math.min(hover.x + 12, width - 200), top: hover.y + 12 }}
          >
            {hover.f.name && <div className="font-medium text-text">{hover.f.name}</div>}
            <div className="font-mono text-muted">
              {hover.f.chrom}:{formatBp(hover.f.start)}–{formatBp(hover.f.end)}
              {hover.f.strand ? ` (${hover.f.strand})` : ""}
            </div>
            {(hover.f.type || hover.f.score !== undefined) && (
              <div className="text-muted">
                {[
                  hover.f.type,
                  hover.f.score !== undefined ? t("genome.scoreLabel", { score: hover.f.score }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-1 text-[11px] text-muted">
        {t("genome.panZoomHint")}
        {rows.length > 0 &&
          Math.max(...rows) + 1 > MAX_ROWS &&
          t("genome.showingRows", { shown: MAX_ROWS, total: Math.max(...rows) + 1 })}
        {data.truncated && t("genome.truncatedNotice")}
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-text"
    >
      {children}
    </button>
  );
}

// Sentinel for "no type/strand on this feature" — distinct from any real data
// value so a grouping key can never collide with a translated display string.
const UNSPECIFIED = Symbol("genome-category-unspecified");
type CategoryKey = string | typeof UNSPECIFIED;

/** Assign each feature a stable palette color (1..8) by type (GFF/GTF) or strand. */
function categorize(features: GenomeFeature[], format: string | null, t: TFunction<["inspector", "common"]>) {
  // Grouping identity comes from the raw, untranslated data (feature type or
  // strand symbol) — never from a t(...) display string, so a locale change
  // can't merge or split groups.
  const keyOf = (f: GenomeFeature): CategoryKey =>
    format === "gff" || format === "gtf" ? f.type ?? UNSPECIFIED : f.strand ?? UNSPECIFIED;
  const labelOf = (k: CategoryKey): string =>
    k === UNSPECIFIED
      ? t("genome.featureLabel")
      : format === "gff" || format === "gtf"
        ? k
        : t("genome.strandLabel", { strand: k });
  const order: CategoryKey[] = [];
  const counts = new Map<CategoryKey, number>();
  for (const f of features) {
    const k = keyOf(f);
    if (!counts.has(k)) order.push(k);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  order.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  const index = new Map(order.map((k, i) => [k, (i % 8) + 1]));
  return {
    list: order.map((k) => ({ label: labelOf(k), color: index.get(k)! })),
    colorOf: (f: GenomeFeature) => index.get(keyOf(f)) ?? 1,
  };
}

/** Round tick positions across [start,end] at a 1/2/5×10ⁿ interval. */
function niceTicks(start: number, end: number, target: number): number[] {
  const span = end - start;
  if (span <= 0) return [start];
  const rough = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = rough / mag <= 1 ? mag : rough / mag <= 2 ? 2 * mag : rough / mag <= 5 ? 5 * mag : 10 * mag;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t);
  return ticks;
}
