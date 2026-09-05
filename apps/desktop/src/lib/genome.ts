// Parse common genome annotation formats (BED / bedGraph / GFF3 / GTF / VCF)
// into a uniform feature model for the native track viewer. Pure and offline —
// no reference genome, no network — so it is unit-testable and works on the file
// alone. All coordinates are normalized to 1-based inclusive so the ruler and
// tooltips are consistent regardless of the source format's convention.

import { formatNumber } from "@/i18n/format";

export type GenomeFormat = "bed" | "bedgraph" | "gff" | "gtf" | "vcf";

export interface GenomeFeature {
  chrom: string;
  /** 1-based inclusive start. */
  start: number;
  /** 1-based inclusive end. */
  end: number;
  name?: string;
  strand?: "+" | "-";
  /** Feature type (GFF/GTF col 3), e.g. "gene", "exon". */
  type?: string;
  score?: number;
}

export interface Contig {
  name: string;
  /** Smallest feature start on this contig (1-based). */
  min: number;
  /** Largest feature end on this contig (1-based). */
  max: number;
  count: number;
}

export interface GenomeData {
  format: GenomeFormat;
  features: GenomeFeature[];
  contigs: Contig[];
  /** True if the file had more features than the parse cap. */
  truncated: boolean;
}

/** Cap parsed features so a huge annotation file can't exhaust memory. */
const MAX_FEATURES = 50_000;

/** The annotation format for a file extension, or null if not a track format. */
export function genomeFormat(ext: string): GenomeFormat | null {
  switch (ext.toLowerCase()) {
    case "bed":
      return "bed";
    case "bedgraph":
    case "bdg":
      return "bedgraph";
    case "gff":
    case "gff3":
      return "gff";
    case "gtf":
      return "gtf";
    case "vcf":
      return "vcf";
    default:
      return null;
  }
}

const strandOf = (s: string): "+" | "-" | undefined =>
  s === "+" ? "+" : s === "-" ? "-" : undefined;

const numOr = (s: string | undefined): number | undefined => {
  if (s === undefined || s === "" || s === ".") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** GFF3 attributes: `ID=gene1;Name=BRCA1`. Returns the first present key's value. */
function gffName(attrs: string): string | undefined {
  const map = new Map<string, string>();
  for (const kv of attrs.split(";")) {
    const eq = kv.indexOf("=");
    if (eq > 0) map.set(kv.slice(0, eq).trim().toLowerCase(), decodeURIComponent(kv.slice(eq + 1).trim()));
  }
  for (const k of ["name", "gene_name", "gene", "id"]) {
    const v = map.get(k);
    if (v) return v;
  }
  return undefined;
}

/** GTF attributes: `gene_id "X"; gene_name "BRCA1";`. */
function gtfName(attrs: string): string | undefined {
  const map = new Map<string, string>();
  for (const m of attrs.matchAll(/(\w+)\s+"([^"]*)"/g)) map.set(m[1].toLowerCase(), m[2]);
  for (const k of ["gene_name", "gene_id", "transcript_id"]) {
    const v = map.get(k);
    if (v) return v;
  }
  return undefined;
}

function parseLine(format: GenomeFormat, line: string): GenomeFeature | null {
  // GFF/GTF/VCF are tab-delimited; BED is whitespace-delimited in practice.
  const f = format === "bed" || format === "bedgraph" ? line.split(/\s+/) : line.split("\t");
  switch (format) {
    case "bed": {
      if (f.length < 3) return null;
      const start = numOr(f[1]);
      const end = numOr(f[2]);
      if (start === undefined || end === undefined) return null;
      return {
        chrom: f[0],
        start: start + 1, // BED is 0-based half-open → 1-based inclusive
        end,
        name: f[3] && f[3] !== "." ? f[3] : undefined,
        score: numOr(f[4]),
        strand: f[5] ? strandOf(f[5]) : undefined,
      };
    }
    case "bedgraph": {
      if (f.length < 4) return null;
      const start = numOr(f[1]);
      const end = numOr(f[2]);
      if (start === undefined || end === undefined) return null;
      return { chrom: f[0], start: start + 1, end, score: numOr(f[3]) };
    }
    case "gff":
    case "gtf": {
      if (f.length < 5) return null;
      const start = numOr(f[3]);
      const end = numOr(f[4]);
      if (start === undefined || end === undefined) return null;
      const attrs = f[8] ?? "";
      return {
        chrom: f[0],
        start,
        end,
        type: f[2] && f[2] !== "." ? f[2] : undefined,
        score: numOr(f[5]),
        strand: strandOf(f[6] ?? ""),
        name: format === "gff" ? gffName(attrs) : gtfName(attrs),
      };
    }
    case "vcf": {
      if (f.length < 5) return null;
      const pos = numOr(f[1]);
      if (pos === undefined) return null;
      const ref = f[3] ?? "";
      const alt = f[4] ?? "";
      const id = f[2] && f[2] !== "." ? f[2] : undefined;
      return {
        chrom: f[0],
        start: pos,
        end: pos + Math.max(0, ref.length - 1), // span of the REF allele
        name: id ?? (ref && alt ? `${ref}→${alt}` : undefined),
        score: numOr(f[5]),
        type: "variant",
      };
    }
  }
}

/** Parse annotation text into features grouped by contig (comment/header lines skipped). */
export function parseGenome(text: string, format: GenomeFormat): GenomeData {
  const features: GenomeFeature[] = [];
  let truncated = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#") || line.startsWith("track") || line.startsWith("browser")) continue;
    if (features.length >= MAX_FEATURES) {
      truncated = true;
      break;
    }
    const feat = parseLine(format, line);
    if (feat && feat.end >= feat.start) features.push(feat);
  }

  const byChrom = new Map<string, Contig>();
  for (const f of features) {
    const c = byChrom.get(f.chrom);
    if (c) {
      c.min = Math.min(c.min, f.start);
      c.max = Math.max(c.max, f.end);
      c.count += 1;
    } else {
      byChrom.set(f.chrom, { name: f.chrom, min: f.start, max: f.end, count: 1 });
    }
  }
  // Most features first — the busiest contig is the useful default view.
  const contigs = [...byChrom.values()].sort((a, b) => b.count - a.count);
  return { format, features, contigs, truncated };
}

/** Greedy row packing: place features into the fewest non-overlapping rows so
 *  overlapping annotations stay visible. Returns each feature's row index. */
export function packRows(features: GenomeFeature[]): number[] {
  const rowEnds: number[] = []; // last end placed in each row
  const rows: number[] = [];
  const order = features.map((_, i) => i).sort((a, b) => features[a].start - features[b].start);
  const rowOf = new Array<number>(features.length);
  for (const i of order) {
    const f = features[i];
    let placed = -1;
    for (let r = 0; r < rowEnds.length; r++) {
      if (f.start > rowEnds[r]) {
        placed = r;
        break;
      }
    }
    if (placed === -1) {
      placed = rowEnds.length;
      rowEnds.push(f.end);
    } else {
      rowEnds[placed] = f.end;
    }
    rowOf[i] = placed;
  }
  for (let i = 0; i < features.length; i++) rows.push(rowOf[i]);
  return rows;
}

/** Human-readable base-pair position, e.g. 1_500_000 → "1,500,000". */
export function formatBp(n: number): string {
  return formatNumber(Math.round(n));
}
