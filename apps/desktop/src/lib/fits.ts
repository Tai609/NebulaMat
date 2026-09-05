// Minimal, dependency-free FITS reader for the native astronomy viewer (P1-3).
// Parses the primary HDU header (80-char cards in 2880-byte blocks) and its
// data array (big-endian, per BITPIX, with BZERO/BSCALE), returning either a 2-D
// image or a 1-D spectrum. Pure and offline — the file alone drives the viewer.

const BLOCK = 2880;
const CARD = 80;

export interface FitsWcs {
  ctype1?: string;
  ctype2?: string;
  crval1?: number;
  crval2?: number;
  crpix1?: number;
  crpix2?: number;
  cdelt1?: number;
  cdelt2?: number;
}

export interface FitsImage {
  kind: "image";
  width: number;
  height: number;
  /** Physical values (BZERO + BSCALE·raw), row-major, origin bottom-left (FITS). */
  data: Float32Array;
  min: number;
  max: number;
  /** Robust display range (≈1st/99th percentile) for the default stretch. */
  lo: number;
  hi: number;
  bunit?: string;
  object?: string;
  wcs: FitsWcs;
  header: Record<string, string | number | boolean>;
}

export interface FitsSpectrum {
  kind: "spectrum";
  length: number;
  data: Float32Array;
  /** World coordinate of the first sample and the per-sample step (linear). */
  x0: number;
  dx: number;
  ctype1?: string;
  bunit?: string;
  header: Record<string, string | number | boolean>;
}

export type FitsResult = FitsImage | FitsSpectrum;

function ascii(buf: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = 0; i < len && start + i < buf.length; i++) s += String.fromCharCode(buf[start + i]);
  return s;
}

/** Parse one 80-char card into [key, value] where value is string|number|boolean|null. */
function parseCard(card: string): [string, string | number | boolean | null] {
  const key = card.slice(0, 8).trim();
  if (!key || card[8] !== "=") return [key, null];
  let rest = card.slice(10);
  rest = rest.replace(/\/(?=(?:[^']*'[^']*')*[^']*$).*$/, ""); // strip comment outside quotes
  rest = rest.trim();
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1);
    return [key, (end > 0 ? rest.slice(1, end) : rest.slice(1)).trim()];
  }
  if (rest === "T") return [key, true];
  if (rest === "F") return [key, false];
  const num = Number(rest);
  return [key, Number.isFinite(num) && rest !== "" ? num : rest];
}

function readHeader(buf: Uint8Array): {
  header: Record<string, string | number | boolean>;
  dataStart: number;
} {
  const header: Record<string, string | number | boolean> = {};
  let pos = 0;
  let done = false;
  while (!done) {
    if (pos >= buf.length) throw new Error("FITS: no END card found");
    for (let i = 0; i < BLOCK / CARD; i++) {
      const card = ascii(buf, pos + i * CARD, CARD);
      if (card.slice(0, 8).trim() === "END") {
        done = true;
        continue;
      }
      const [key, value] = parseCard(card);
      if (key && value !== null) header[key] = value;
    }
    pos += BLOCK;
  }
  return { header, dataStart: pos };
}

function num(h: Record<string, string | number | boolean>, k: string, def: number): number {
  const v = h[k];
  return typeof v === "number" ? v : def;
}

function readSample(
  view: DataView,
  offset: number,
  bitpix: number,
  i: number,
): number {
  switch (bitpix) {
    case 8:
      return view.getUint8(offset + i);
    case 16:
      return view.getInt16(offset + i * 2, false);
    case 32:
      return view.getInt32(offset + i * 4, false);
    case 64:
      return Number(view.getBigInt64(offset + i * 8, false));
    case -32:
      return view.getFloat32(offset + i * 4, false);
    case -64:
      return view.getFloat64(offset + i * 8, false);
    default:
      throw new Error(`FITS: unsupported BITPIX ${bitpix}`);
  }
}

function percentiles(data: Float32Array): { lo: number; hi: number; min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  // Sample up to ~20k finite values for a robust range without sorting huge arrays.
  const step = Math.max(1, Math.floor(data.length / 20000));
  const sample: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    if (i % step === 0) sample.push(v);
  }
  if (sample.length === 0) return { lo: 0, hi: 1, min: 0, max: 1 };
  sample.sort((a, b) => a - b);
  const at = (p: number) => sample[Math.min(sample.length - 1, Math.max(0, Math.floor(p * (sample.length - 1))))];
  let lo = at(0.01);
  let hi = at(0.99);
  if (lo === hi) {
    lo = min;
    hi = max === min ? min + 1 : max;
  }
  return { lo, hi, min, max };
}

export function parseFits(buffer: ArrayBuffer): FitsResult {
  const bytes = new Uint8Array(buffer);
  if (ascii(bytes, 0, 6) !== "SIMPLE") throw new Error("FITS: missing SIMPLE header");
  const { header, dataStart } = readHeader(bytes);
  const bitpix = num(header, "BITPIX", 0);
  const naxis = num(header, "NAXIS", 0);
  const bzero = num(header, "BZERO", 0);
  const bscale = num(header, "BSCALE", 1);
  const view = new DataView(buffer, dataStart);

  if (naxis < 1) throw new Error("FITS: primary HDU has no data (NAXIS=0)");

  if (naxis === 1) {
    const n = num(header, "NAXIS1", 0);
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = bzero + bscale * readSample(view, 0, bitpix, i);
    const crval = num(header, "CRVAL1", 1);
    const cdelt = num(header, "CDELT1", 1);
    const crpix = num(header, "CRPIX1", 1);
    return {
      kind: "spectrum",
      length: n,
      data,
      x0: crval + (1 - crpix) * cdelt, // world coord at pixel 1 (FITS is 1-based)
      dx: cdelt,
      ctype1: typeof header.CTYPE1 === "string" ? header.CTYPE1 : undefined,
      bunit: typeof header.BUNIT === "string" ? header.BUNIT : undefined,
      header,
    };
  }

  // 2-D (or higher — use the first two axes as the displayed plane).
  const width = num(header, "NAXIS1", 0);
  const height = num(header, "NAXIS2", 0);
  const count = width * height;
  const data = new Float32Array(count);
  const blank = header.BLANK;
  for (let i = 0; i < count; i++) {
    const raw = readSample(view, 0, bitpix, i);
    data[i] = typeof blank === "number" && raw === blank ? NaN : bzero + bscale * raw;
  }
  const { lo, hi, min, max } = percentiles(data);
  return {
    kind: "image",
    width,
    height,
    data,
    min,
    max,
    lo,
    hi,
    bunit: typeof header.BUNIT === "string" ? header.BUNIT : undefined,
    object: typeof header.OBJECT === "string" ? header.OBJECT : undefined,
    wcs: {
      ctype1: typeof header.CTYPE1 === "string" ? header.CTYPE1 : undefined,
      ctype2: typeof header.CTYPE2 === "string" ? header.CTYPE2 : undefined,
      crval1: typeof header.CRVAL1 === "number" ? header.CRVAL1 : undefined,
      crval2: typeof header.CRVAL2 === "number" ? header.CRVAL2 : undefined,
      crpix1: typeof header.CRPIX1 === "number" ? header.CRPIX1 : undefined,
      crpix2: typeof header.CRPIX2 === "number" ? header.CRPIX2 : undefined,
      cdelt1: typeof header.CDELT1 === "number" ? header.CDELT1 : undefined,
      cdelt2: typeof header.CDELT2 === "number" ? header.CDELT2 : undefined,
    },
    header,
  };
}

/** Approximate pixel→world using the linear CDELT terms (FITS pixels 1-based).
 *  Good for a hover readout near the reference pixel; not a full WCS solution. */
export function pixelToWorld(
  wcs: FitsWcs,
  px: number,
  py: number,
): { lon: number; lat: number } | null {
  if (
    wcs.crval1 === undefined ||
    wcs.crval2 === undefined ||
    wcs.crpix1 === undefined ||
    wcs.crpix2 === undefined
  )
    return null;
  const cd1 = wcs.cdelt1 ?? 1;
  const cd2 = wcs.cdelt2 ?? 1;
  const lat = wcs.crval2 + (py + 1 - wcs.crpix2) * cd2;
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1;
  const lon = wcs.crval1 + ((px + 1 - wcs.crpix1) * cd1) / cosLat;
  return { lon, lat };
}
