import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parseFits, pixelToWorld, type FitsImage, type FitsResult } from "@/lib/fits";
import { cn } from "@/lib/cn";

/**
 * Native FITS viewer for astronomy (P1-3): renders a 2-D image HDU to a canvas
 * with a scientific colormap and a choice of stretch, or a 1-D spectrum as a
 * line chart — offline, from the file bytes alone. Chatbots can't depict these;
 * a real renderer is the differentiator. Theme-independent like the molecule /
 * mesh viewers (an astronomical image reads the same in light or dark).
 */

type Cmap = "magma" | "viridis" | "gray";
type Stretch = "linear" | "log" | "asinh";

// Compact perceptually-ordered colormaps (control points, 0→1 interpolated).
const CMAPS: Record<Cmap, [number, number, number][]> = {
  magma: [
    [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99],
    [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 253, 191],
  ],
  viridis: [
    [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
  ],
  gray: [[0, 0, 0], [255, 255, 255]],
};

function sampleCmap(stops: [number, number, number][], frac: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, frac)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[Math.min(stops.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function applyStretch(frac: number, mode: Stretch): number {
  const c = Math.min(1, Math.max(0, frac));
  if (mode === "log") return Math.log1p(1000 * c) / Math.log1p(1000);
  if (mode === "asinh") return Math.asinh(10 * c) / Math.asinh(10);
  return c;
}

function fmtCoord(lon: number, lat: number): string {
  const ra = ((lon % 360) + 360) % 360;
  return `RA ${ra.toFixed(4)}°, Dec ${lat >= 0 ? "+" : ""}${lat.toFixed(4)}°`;
}

export function FitsView({ filename, bytes }: { filename: string; bytes: ArrayBuffer }) {
  const { t } = useTranslation(["inspector", "common"]);
  const parsed = useMemo<{ result: FitsResult | null; error: string | null }>(() => {
    try {
      return { result: parseFits(bytes), error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [bytes]);

  if (parsed.error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-sm items-start gap-2 rounded-card border border-border bg-surface p-4 text-sm text-muted">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
          <span>{t("fits.readError", { error: parsed.error })}</span>
        </div>
      </div>
    );
  }
  if (!parsed.result) return null;
  if (parsed.result.kind === "spectrum") {
    return <SpectrumView filename={filename} spec={parsed.result} />;
  }
  return <ImageView filename={filename} img={parsed.result} />;
}

function ImageView({ filename, img }: { filename: string; img: FitsImage }) {
  const { t } = useTranslation(["inspector", "common"]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cmap, setCmap] = useState<Cmap>("magma");
  const [stretch, setStretch] = useState<Stretch>("linear");
  const [hover, setHover] = useState<{ x: number; y: number; v: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, data, lo, hi } = img;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = width;
    canvas.height = height;
    const image = ctx.createImageData(width, height);
    const stops = CMAPS[cmap];
    const span = hi - lo || 1;
    for (let row = 0; row < height; row++) {
      // FITS data origin is bottom-left; canvas is top-left → flip vertically.
      const srcRow = height - 1 - row;
      for (let col = 0; col < width; col++) {
        const v = data[srcRow * width + col];
        const o = (row * width + col) * 4;
        if (!Number.isFinite(v)) {
          image.data[o] = image.data[o + 1] = image.data[o + 2] = 0;
          image.data[o + 3] = 255;
          continue;
        }
        const [r, g, b] = sampleCmap(stops, applyStretch((v - lo) / span, stretch));
        image.data[o] = r;
        image.data[o + 1] = g;
        image.data[o + 2] = b;
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [img, cmap, stretch]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * img.width);
    const rowFromTop = Math.floor(((e.clientY - rect.top) / rect.height) * img.height);
    const fitsY = img.height - 1 - rowFromTop; // data row (bottom-left origin)
    if (col < 0 || col >= img.width || fitsY < 0 || fitsY >= img.height) {
      setHover(null);
      return;
    }
    setHover({ x: col, y: fitsY, v: img.data[fitsY * img.width + col] });
  };

  const world = hover ? pixelToWorld(img.wcs, hover.x, hover.y) : null;

  return (
    <div className="flex h-full flex-col bg-[#0f0f14]">
      <Toolbar
        left={
          <span className="truncate font-mono text-[11px] text-white/50">
            {filename} · {img.width}×{img.height}
            {img.bunit ? ` · ${img.bunit}` : ""}
          </span>
        }
      >
        <Segmented
          value={stretch}
          onChange={(v) => setStretch(v as Stretch)}
          options={["linear", "log", "asinh"]}
          labelFor={(v) => t(`fits.stretch.${v as Stretch}`)}
        />
        <Segmented
          value={cmap}
          onChange={(v) => setCmap(v as Cmap)}
          options={["magma", "viridis", "gray"]}
          labelFor={(v) => t(`fits.colormap.${v as Cmap}`)}
        />
      </Toolbar>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <canvas
          ref={canvasRef}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          className="max-h-full max-w-full object-contain shadow-lg"
          style={{ imageRendering: "pixelated", aspectRatio: `${img.width} / ${img.height}` }}
        />
      </div>

      <div className="flex items-center gap-3 border-t border-white/10 px-3 py-2">
        <Colorbar cmap={cmap} stretch={stretch} lo={img.lo} hi={img.hi} unit={img.bunit} />
        <div className="ml-auto min-h-[2.25rem] text-right font-mono text-[11px] text-white/70">
          {hover ? (
            <>
              <div>
                {t("fits.pixelValue", { x: hover.x, y: hover.y, value: hover.v.toPrecision(5) })}
              </div>
              {world && <div className="text-white/45">{fmtCoord(world.lon, world.lat)}</div>}
            </>
          ) : (
            <span className="text-white/30">{t("fits.hoverHintImage")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Colorbar({
  cmap,
  stretch,
  lo,
  hi,
  unit,
}: {
  cmap: Cmap;
  stretch: Stretch;
  lo: number;
  hi: number;
  unit?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = (c.width = 160);
    const h = (c.height = 10);
    const img = ctx.createImageData(w, h);
    const stops = CMAPS[cmap];
    for (let x = 0; x < w; x++) {
      const [r, g, b] = sampleCmap(stops, applyStretch(x / (w - 1), stretch));
      for (let y = 0; y < h; y++) {
        const o = (y * w + x) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [cmap, stretch]);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-white/50">{lo.toPrecision(3)}</span>
      <canvas ref={ref} className="h-2.5 w-40 rounded-sm ring-1 ring-white/15" />
      <span className="font-mono text-[10px] text-white/50">
        {hi.toPrecision(3)}
        {unit ? ` ${unit}` : ""}
      </span>
    </div>
  );
}

function SpectrumView({ filename, spec }: { filename: string; spec: import("@/lib/fits").FitsSpectrum }) {
  const { t } = useTranslation(["inspector", "common"]);
  const { data, x0, dx, length, ctype1, bunit } = spec;
  const W = 640;
  const H = 320;
  const pad = { l: 56, r: 16, t: 16, b: 40 };
  const [hover, setHover] = useState<{ i: number } | null>(null);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const v of data) {
    if (v < yMin) yMin = v;
    if (v > yMax) yMax = v;
  }
  const ySpan = yMax - yMin || 1;
  const xAt = (i: number) => pad.l + (i / (length - 1 || 1)) * (W - pad.l - pad.r);
  const yAt = (v: number) => H - pad.b - ((v - yMin) / ySpan) * (H - pad.t - pad.b);
  const path = Array.from(data, (v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - pad.l) / (W - pad.l - pad.r)) * (length - 1));
    setHover(i >= 0 && i < length ? { i } : null);
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <Toolbar
        left={
          <span className="truncate font-mono text-[11px] text-muted">
            {filename} · {t("fits.spectrumSummary", { count: length })}
          </span>
        }
      />
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto max-h-full w-full max-w-[720px]"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = yMin + f * ySpan;
            const y = yAt(v);
            return (
              <g key={f}>
                <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="currentColor" className="text-border" strokeWidth={1} />
                <text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-muted font-mono text-[10px]">
                  {v.toPrecision(3)}
                </text>
              </g>
            );
          })}
          <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={1.6} />
          {hover && (
            <g>
              <line x1={xAt(hover.i)} y1={pad.t} x2={xAt(hover.i)} y2={H - pad.b} stroke="var(--series-1)" strokeWidth={0.75} strokeDasharray="3 3" />
              <circle cx={xAt(hover.i)} cy={yAt(data[hover.i])} r={3} fill="var(--series-1)" />
            </g>
          )}
          <text x={(W) / 2} y={H - 6} textAnchor="middle" className="fill-muted font-mono text-[10px]">
            {ctype1 ?? t("fits.axisSampleFallback")} {dx !== 1 ? `(${x0.toPrecision(4)} + ${dx}·i)` : ""}
          </text>
          <text x={14} y={H / 2} textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`} className="fill-muted font-mono text-[10px]">
            {bunit ?? t("fits.value")}
          </text>
        </svg>
      </div>
      <div className="border-t border-border px-3 py-2 text-right font-mono text-[11px] text-muted">
        {hover ? (
          <>
            {/* eslint-disable-next-line i18next/no-literal-string -- "x" is a default axis-name fallback (scientific notation), not prose */}
            {ctype1 ?? "x"} = {(x0 + dx * hover.i).toPrecision(6)} · {t("fits.value")} ={" "}
            {data[hover.i].toPrecision(5)}
          </>
        ) : (
          <span className="text-muted/50">{t("fits.hoverHintSpectrum")}</span>
        )}
      </div>
    </div>
  );
}

function Toolbar({ left, children }: { left: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/10 bg-black/20 px-3 py-2">
      <div className="min-w-0 flex-1">{left}</div>
      {children}
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
    <div className="flex overflow-hidden rounded-md ring-1 ring-white/15">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "px-2 py-1 text-[11px] font-medium capitalize transition-colors",
            value === o ? "bg-white/20 text-white" : "bg-transparent text-white/50 hover:text-white/80",
          )}
        >
          {labelFor ? labelFor(o) : o}
        </button>
      ))}
    </div>
  );
}
