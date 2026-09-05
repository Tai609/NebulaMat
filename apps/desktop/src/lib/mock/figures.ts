// Deterministic SVG placeholders that read as scientific scatter figures,
// encoded as data URIs. No network assets — offline-friendly.

// Small seeded PRNG so figures are stable across renders and builds.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

interface Cluster {
  cx: number;
  cy: number;
  color: string;
  spread: number;
  n: number;
}

function scatter(width: number, height: number, clusters: Cluster[], seed: number): string {
  const rng = makeRng(seed);
  const dots: string[] = [];
  for (const c of clusters) {
    for (let i = 0; i < c.n; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = rng() * c.spread;
      const x = (c.cx + Math.cos(angle) * radius).toFixed(1);
      const y = (c.cy + Math.sin(angle) * radius).toFixed(1);
      const r = (1.2 + rng() * 1.3).toFixed(1);
      dots.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${c.color}" opacity="0.72"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${dots.join(
    "",
  )}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const HERO = {
  neuron: "#5b9bd5",
  muscle: "#bcbd22",
  immune: "#2ca02c",
  ciliated: "#17becf",
  germline: "#e377c2",
  progenitor: "#ff7f0e",
};

export const umapAtlas = scatter(
  640,
  420,
  [
    { cx: 250, cy: 260, color: HERO.neuron, spread: 130, n: 420 },
    { cx: 470, cy: 300, color: HERO.muscle, spread: 70, n: 150 },
    { cx: 500, cy: 150, color: HERO.immune, spread: 55, n: 120 },
    { cx: 300, cy: 180, color: HERO.progenitor, spread: 45, n: 90 },
    { cx: 360, cy: 250, color: HERO.germline, spread: 40, n: 70 },
    { cx: 330, cy: 320, color: HERO.ciliated, spread: 40, n: 70 },
  ],
  7,
);

export const umapBySite = scatter(
  320,
  260,
  [
    { cx: 150, cy: 130, color: "#9aa0a6", spread: 100, n: 300 },
    { cx: 210, cy: 90, color: "#9aa0a6", spread: 40, n: 60 },
  ],
  11,
);

export const umapByType = scatter(
  320,
  260,
  [
    { cx: 120, cy: 150, color: "#4c78a8", spread: 55, n: 120 },
    { cx: 210, cy: 110, color: "#f58518", spread: 45, n: 90 },
    { cx: 180, cy: 190, color: "#54a24b", spread: 45, n: 90 },
    { cx: 100, cy: 90, color: "#e45756", spread: 35, n: 70 },
    { cx: 240, cy: 180, color: "#b279a2", spread: 35, n: 70 },
  ],
  13,
);

export const citationScatter = scatter(
  360,
  300,
  [
    { cx: 120, cy: 90, color: "#8c8c8c", spread: 60, n: 80 },
    { cx: 230, cy: 200, color: "#3b6ea5", spread: 40, n: 30 },
  ],
  17,
);

// App categorical palette (light) — keeps mock figures on-brand with the real
// chart colors (packages/shared CHART_PALETTE_LIGHT).
const CAT = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const INK = "#202124";
const MUT = "#5f6368";

function svgUri(width: number, height: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, Segoe UI, Roboto, sans-serif"><rect width="${width}" height="${height}" fill="#ffffff"/>${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A Chrome-like window framing a page — reads instantly as "the agent is
 *  driving a browser". `rows` are result cards with a coloured subfield tag. */
export function browserShot(
  url: string,
  heading: string,
  rows: { tag: string; color: string; title: string }[],
): string {
  const W = 640;
  const H = 430;
  const bar = 40;
  const lights = ["#ff5f57", "#febc2e", "#28c840"]
    .map((c, i) => `<circle cx="${22 + i * 20}" cy="${bar / 2}" r="6" fill="${c}"/>`)
    .join("");
  const addr = `<rect x="92" y="11" width="${W - 112}" height="18" rx="9" fill="#ffffff" stroke="#dfe1e5"/><text x="104" y="24" font-size="11" fill="${MUT}">${url}</text>`;
  const rowH = 50;
  const top = bar + 46;
  const cards = rows
    .map((r, i) => {
      const y = top + i * rowH;
      const tagW = 8 + r.tag.length * 6.4;
      return (
        `<rect x="24" y="${y}" width="${tagW}" height="16" rx="8" fill="${r.color}" opacity="0.16"/>` +
        `<text x="${24 + tagW / 2}" y="${y + 12}" font-size="10" fill="${r.color}" text-anchor="middle" font-weight="600">${r.tag}</text>` +
        `<text x="${34 + tagW}" y="${y + 12}" font-size="12.5" fill="${INK}">${r.title}</text>` +
        `<text x="${34 + tagW}" y="${y + 30}" font-size="10.5" fill="${MUT}">bioRxiv · posted this week · CC-BY</text>` +
        (i < rows.length - 1 ? `<line x1="24" y1="${y + rowH - 8}" x2="${W - 24}" y2="${y + rowH - 8}" stroke="#eef0f2"/>` : "")
      );
    })
    .join("");
  const body =
    `<rect x="0" y="0" width="${W}" height="${bar}" fill="#f1f3f4"/>${lights}${addr}` +
    `<text x="24" y="${bar + 30}" font-size="16" font-weight="700" fill="${INK}">${heading}</text>` +
    `<text x="${W - 24}" y="${bar + 30}" font-size="11" fill="${MUT}" text-anchor="end">Showing 60 of 60</text>` +
    cards +
    `<rect x="${W / 2 - 52}" y="${H - 34}" width="104" height="24" rx="12" fill="#2a78d6"/>` +
    `<text x="${W / 2}" y="${H - 18}" font-size="11.5" fill="#ffffff" text-anchor="middle" font-weight="600">Load more</text>`;
  return svgUri(W, H, body);
}

/** Clean vertical bar chart — used for the subfield mix. */
export function barChart(title: string, bars: { label: string; value: number }[]): string {
  const W = 540;
  const H = 320;
  const L = 40;
  const R = 20;
  const T = 40;
  const B = 62;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const base = H - B;
  const max = Math.max(...bars.map((b) => b.value));
  const slot = plotW / bars.length;
  const bw = slot * 0.56;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = base - f * plotH;
      return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#eef0f2"/><text x="${L - 6}" y="${y + 3}" font-size="9" fill="${MUT}" text-anchor="end">${Math.round(f * max)}</text>`;
    })
    .join("");
  const cols = bars
    .map((b, i) => {
      const h = (b.value / max) * plotH;
      const x = L + i * slot + (slot - bw) / 2;
      const y = base - h;
      const c = CAT[i % CAT.length];
      return (
        `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="3" fill="${c}"/>` +
        `<text x="${x + bw / 2}" y="${y - 5}" font-size="10" fill="${INK}" text-anchor="middle" font-weight="600">${b.value}</text>` +
        `<text x="${x + bw / 2}" y="${base + 15}" font-size="9.5" fill="${MUT}" text-anchor="middle">${b.label}</text>`
      );
    })
    .join("");
  const body =
    `<text x="${L}" y="24" font-size="13" font-weight="700" fill="${INK}">${title}</text>` +
    grid +
    `<line x1="${L}" y1="${base}" x2="${W - R}" y2="${base}" stroke="#c8ccd1"/>` +
    cols;
  return svgUri(W, H, body);
}

/** Line curve with an optional dashed reference (e.g. the published value). */
export function lineCurve(
  title: string,
  ylabel: string,
  points: number[],
  opts: { yMin: number; yMax: number; reference?: { value: number; label: string } },
): string {
  const W = 540;
  const H = 320;
  const L = 46;
  const R = 22;
  const T = 40;
  const B = 46;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const base = H - B;
  const { yMin, yMax } = opts;
  const px = (i: number) => L + (i / (points.length - 1)) * plotW;
  const py = (v: number) => base - ((v - yMin) / (yMax - yMin)) * plotH;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const v = yMin + f * (yMax - yMin);
      const y = base - f * plotH;
      return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#eef0f2"/><text x="${L - 6}" y="${y + 3}" font-size="9" fill="${MUT}" text-anchor="end">${v.toFixed(2)}</text>`;
    })
    .join("");
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const dots = points
    .map((v, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="2.4" fill="#2a78d6"/>`)
    .join("");
  const ref = opts.reference
    ? `<line x1="${L}" y1="${py(opts.reference.value)}" x2="${W - R}" y2="${py(opts.reference.value)}" stroke="#e34948" stroke-width="1.2" stroke-dasharray="5 4"/>` +
      `<text x="${W - R}" y="${py(opts.reference.value) - 5}" font-size="9.5" fill="#e34948" text-anchor="end">${opts.reference.label}</text>`
    : "";
  const body =
    `<text x="${L}" y="24" font-size="13" font-weight="700" fill="${INK}">${title}</text>` +
    `<text x="12" y="${T + plotH / 2}" font-size="10" fill="${MUT}" transform="rotate(-90 12 ${T + plotH / 2})" text-anchor="middle">${ylabel}</text>` +
    grid +
    `<line x1="${L}" y1="${base}" x2="${W - R}" y2="${base}" stroke="#c8ccd1"/>` +
    ref +
    `<path d="${path}" fill="none" stroke="#2a78d6" stroke-width="2"/>` +
    dots +
    `<text x="${W - R}" y="${base + 16}" font-size="9" fill="${MUT}" text-anchor="end">epoch</text>`;
  return svgUri(W, H, body);
}

// ---- Derived figures for the new example sessions ----

export const biorxivShot = browserShot(
  "biorxiv.org/collection/neuroscience",
  "bioRxiv · Neuroscience · new this week",
  [
    { tag: "Systems", color: CAT[0], title: "Thalamocortical loops shape cortical state transitions" },
    { tag: "Cellular", color: CAT[1], title: "Astrocyte calcium waves gate synaptic pruning in vivo" },
    { tag: "Circuits", color: CAT[2], title: "A midbrain circuit for approach–avoidance decisions" },
    { tag: "Computation", color: CAT[4], title: "Predictive coding emerges in recurrent spiking networks" },
    { tag: "Developmental", color: CAT[5], title: "Timed neurogenesis sets interneuron ratios in cortex" },
  ],
);

export const subfieldBars = barChart("New neuroscience preprints by subfield · this week", [
  { label: "Systems", value: 14 },
  { label: "Cellular", value: 11 },
  { label: "Circuits", value: 9 },
  { label: "Cognitive", value: 8 },
  { label: "Comput.", value: 7 },
  { label: "Develop.", value: 5 },
  { label: "Molecular", value: 4 },
  { label: "Disease", value: 2 },
]);

export const ariCurve = lineCurve(
  "scVI integration · ARI vs. epoch (batch = sample_id)",
  "ARI",
  [0.41, 0.52, 0.6, 0.66, 0.71, 0.745, 0.767, 0.778, 0.785, 0.788, 0.79],
  { yMin: 0.3, yMax: 0.9, reference: { value: 0.8, label: "published 0.80" } },
);
