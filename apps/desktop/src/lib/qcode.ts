// Parser + segmentation for qualitative-coding traceback files (P1-3, social
// science). A `.qcode` file is JSON: source documents, a codebook, and
// annotations that bind a code to an exact [start, end) character span of a
// source. The viewer highlights those spans — every quote is sliced straight
// from the source text, so a code can never point at an invented quote.

export interface QCodeSource {
  id: string;
  title?: string;
  text: string;
}

export interface QCode {
  name: string;
  /** Optional explicit color; otherwise assigned from the app palette by index. */
  color?: string;
  description?: string;
}

export interface QAnnotation {
  source: string;
  code: string;
  start: number;
  end: number;
  memo?: string;
}

export interface QCodeDoc {
  sources: QCodeSource[];
  codes: QCode[];
  annotations: QAnnotation[];
}

/** A contiguous run of source text and the set of codes covering it. */
export interface Segment {
  text: string;
  start: number;
  end: number;
  codes: string[];
}

export interface QCodeParsed extends QCodeDoc {
  /** Annotations that referenced a missing source/code or an out-of-range span. */
  warnings: string[];
  /** Exact quote text for each valid annotation (sliced from the source). */
  quoteOf: (a: QAnnotation) => string;
  countByCode: Record<string, number>;
}

export function parseQCode(text: string): QCodeParsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw !== "object") throw new Error("expected a JSON object");
  const obj = raw as Record<string, unknown>;
  const sources = Array.isArray(obj.sources) ? (obj.sources as QCodeSource[]) : [];
  const codes = Array.isArray(obj.codes) ? (obj.codes as QCode[]) : [];
  const annotations = Array.isArray(obj.annotations) ? (obj.annotations as QAnnotation[]) : [];
  if (sources.length === 0) throw new Error("no sources — a .qcode file needs a `sources` array");

  const srcById = new Map(sources.map((s) => [s.id, s]));
  const codeNames = new Set(codes.map((c) => c.name));
  const warnings: string[] = [];
  const countByCode: Record<string, number> = {};

  for (const a of annotations) {
    const s = srcById.get(a.source);
    if (!s) {
      warnings.push(`annotation references unknown source "${a.source}"`);
      continue;
    }
    if (!codeNames.has(a.code)) {
      warnings.push(`annotation uses code "${a.code}" not in the codebook`);
    }
    if (
      typeof a.start !== "number" ||
      typeof a.end !== "number" ||
      a.start < 0 ||
      a.end > s.text.length ||
      a.start >= a.end
    ) {
      warnings.push(
        `annotation on "${a.source}" has an out-of-range span [${a.start}, ${a.end}) (source length ${s.text.length})`,
      );
      continue;
    }
    countByCode[a.code] = (countByCode[a.code] ?? 0) + 1;
  }

  return {
    sources,
    codes,
    annotations,
    warnings,
    countByCode,
    quoteOf: (a) => srcById.get(a.source)?.text.slice(a.start, a.end) ?? "",
  };
}

/** Split a source's text into contiguous segments at every annotation boundary,
 *  so overlapping codes are rendered without losing any of them. Only valid
 *  in-range annotations for this source are considered. */
export function segmentsFor(doc: QCodeDoc, sourceId: string): Segment[] {
  const source = doc.sources.find((s) => s.id === sourceId);
  if (!source) return [];
  const text = source.text;
  const spans = doc.annotations.filter(
    (a) =>
      a.source === sourceId &&
      typeof a.start === "number" &&
      typeof a.end === "number" &&
      a.start >= 0 &&
      a.end <= text.length &&
      a.start < a.end,
  );
  const bounds = new Set<number>([0, text.length]);
  for (const a of spans) {
    bounds.add(a.start);
    bounds.add(a.end);
  }
  const points = [...bounds].sort((x, y) => x - y);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (start >= end) continue;
    const codes = spans.filter((a) => a.start <= start && a.end >= end).map((a) => a.code);
    segments.push({ text: text.slice(start, end), start, end, codes: [...new Set(codes)] });
  }
  return segments;
}
