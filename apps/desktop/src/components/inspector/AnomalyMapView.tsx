import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { divergingColor, parseAnomaly, type AnomalyGrid } from "@/lib/anomaly";

/**
 * Climate-anomaly map (P1-3, earth): renders a gridded `.anom` field on an
 * equirectangular (plate carrée) projection with a zero-centered diverging
 * colormap (blue↔white↔red) and a graticule with °N/°S/°E/°W labels — the
 * correct transform + diverging colormap the discipline expects. Offline, from
 * the file alone; theme-independent like the other scientific viewers.
 */
export function AnomalyMapView({ filename, text }: { filename: string; text: string }) {
  const { t } = useTranslation(["inspector", "common"]);
  const parsed = useMemo<{ grid: AnomalyGrid | null; error: string | null }>(() => {
    try {
      return { grid: parseAnomaly(text), error: null };
    } catch (e) {
      return { grid: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);

  if (parsed.error || !parsed.grid) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-sm items-start gap-2 rounded-card border border-border bg-surface p-4 text-sm text-muted">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
          <span>{t("anomaly.readError", { error: parsed.error ?? t("anomaly.unknownFormat") })}</span>
        </div>
      </div>
    );
  }
  return <Map filename={filename} grid={parsed.grid} />;
}

function fmtLat(v: number): string {
  return v === 0 ? "0°" : `${Math.abs(v)}°${v > 0 ? "N" : "S"}`;
}
function fmtLon(v: number): string {
  const x = ((((v + 180) % 360) + 360) % 360) - 180;
  return x === 0 || Math.abs(x) === 180 ? `${Math.abs(x)}°` : `${Math.abs(x)}°${x > 0 ? "E" : "W"}`;
}
function niceStep(span: number): number {
  for (const s of [10, 15, 30, 45, 60, 90]) if (span / s <= 8) return s;
  return 90;
}

function Map({ filename, grid }: { filename: string; grid: AnomalyGrid }) {
  const { t } = useTranslation(["inspector", "common"]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ lat: number; lon: number; v: number } | null>(null);

  const cols = grid.lons.length;
  const rows = grid.lats.length;
  const lonMin = grid.lons[0];
  const lonMax = grid.lons[cols - 1];
  const latMin = grid.lats[0];
  const latMax = grid.lats[rows - 1];
  const lonSpan = lonMax - lonMin || 1;
  const latSpan = latMax - latMin || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = cols;
    canvas.height = rows;
    const image = ctx.createImageData(cols, rows);
    for (let row = 0; row < rows; row++) {
      const latIdx = rows - 1 - row; // north (max lat) at the top
      for (let col = 0; col < cols; col++) {
        const v = grid.values[latIdx][col];
        const o = (row * cols + col) * 4;
        if (!Number.isFinite(v)) {
          image.data[o] = image.data[o + 1] = image.data[o + 2] = 210;
          image.data[o + 3] = 255;
          continue;
        }
        const [r, g, b] = divergingColor(v / grid.absMax);
        image.data[o] = r;
        image.data[o + 1] = g;
        image.data[o + 2] = b;
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [grid, cols, rows]);

  // SVG overlay coordinate space (independent of canvas pixel size).
  const W = 720;
  const H = Math.max(180, Math.round((W * latSpan) / lonSpan));
  const xAt = (lon: number) => ((lon - lonMin) / lonSpan) * W;
  const yAt = (lat: number) => ((latMax - lat) / latSpan) * H;
  const lonStep = niceStep(lonSpan);
  const latStep = niceStep(latSpan);
  const lonLines: number[] = [];
  for (let l = Math.ceil(lonMin / lonStep) * lonStep; l <= lonMax; l += lonStep) lonLines.push(l);
  const latLines: number[] = [];
  for (let l = Math.ceil(latMin / latStep) * latStep; l <= latMax; l += latStep) latLines.push(l);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const lon = lonMin + ((e.clientX - rect.left) / rect.width) * lonSpan;
    const lat = latMax - ((e.clientY - rect.top) / rect.height) * latSpan;
    // nearest grid cell
    const ci = grid.lons.reduce((best, lo, i) => (Math.abs(lo - lon) < Math.abs(grid.lons[best] - lon) ? i : best), 0);
    const ri = grid.lats.reduce((best, la, i) => (Math.abs(la - lat) < Math.abs(grid.lats[best] - lat) ? i : best), 0);
    setHover({ lat: grid.lats[ri], lon: grid.lons[ci], v: grid.values[ri][ci] });
  };

  return (
    <div className="flex h-full flex-col bg-[#0f1320]">
      <div className="flex items-center gap-2 border-b border-white/10 bg-black/20 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/50">
          {filename} · {cols}×{rows} {t("anomaly.gridLabel")}{grid.unit ? ` · ${grid.unit}` : ""}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="relative w-full max-w-[820px]" style={{ aspectRatio: `${W} / ${H}` }}>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full rounded-sm"
            style={{ imageRendering: "pixelated" }}
          />
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {lonLines.map((l) => (
              <g key={`lon${l}`}>
                <line x1={xAt(l)} y1={0} x2={xAt(l)} y2={H} stroke="#ffffff" strokeOpacity={0.18} strokeWidth={0.75} />
                <text x={xAt(l) + 2} y={H - 4} className="fill-white/55" style={{ fontSize: 10, fontFamily: "monospace" }}>
                  {fmtLon(l)}
                </text>
              </g>
            ))}
            {latLines.map((l) => (
              <g key={`lat${l}`}>
                <line x1={0} y1={yAt(l)} x2={W} y2={yAt(l)} stroke="#ffffff" strokeOpacity={0.18} strokeWidth={0.75} />
                <text x={2} y={yAt(l) - 2} className="fill-white/55" style={{ fontSize: 10, fontFamily: "monospace" }}>
                  {fmtLat(l)}
                </text>
              </g>
            ))}
            {hover && (
              <g>
                <line x1={xAt(hover.lon)} y1={0} x2={xAt(hover.lon)} y2={H} stroke="#fff" strokeOpacity={0.5} strokeWidth={0.6} />
                <line x1={0} y1={yAt(hover.lat)} x2={W} y2={yAt(hover.lat)} stroke="#fff" strokeOpacity={0.5} strokeWidth={0.6} />
              </g>
            )}
          </svg>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-white/10 px-3 py-2">
        <Colorbar absMax={grid.absMax} unit={grid.unit} />
        <div className="ml-auto min-h-[1.25rem] text-right font-mono text-[11px] text-white/70">
          {hover ? (
            <>
              {fmtLat(hover.lat)}, {fmtLon(hover.lon)} ·{" "}
              {Number.isFinite(hover.v) ? `${hover.v > 0 ? "+" : ""}${hover.v.toPrecision(3)}` : t("anomaly.noData")}
            </>
          ) : (
            <span className="text-white/30">{t("anomaly.hoverHint")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Colorbar({ absMax, unit }: { absMax: number; unit?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = (c.width = 180);
    const h = (c.height = 10);
    const img = ctx.createImageData(w, h);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = divergingColor((x / (w - 1)) * 2 - 1);
      for (let y = 0; y < h; y++) {
        const o = (y * w + x) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-white/50">−{absMax.toPrecision(3)}</span>
      <canvas ref={ref} className="h-2.5 w-44 rounded-sm ring-1 ring-white/15" />
      <span className="font-mono text-[10px] text-white/50">
        +{absMax.toPrecision(3)}
        {unit ? ` ${unit}` : ""}
      </span>
    </div>
  );
}
