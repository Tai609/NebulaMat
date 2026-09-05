import type { FindingLevel, ReviewCheck, ReviewerBlock } from "@ai4s/shared";

const FENCE = /```review\s*\n([\s\S]*?)\n```/;
const LEVELS: FindingLevel[] = ["ok", "warn", "error"];
const CHECKS: ReviewCheck[] = ["citation", "number", "figure", "domain", "integrity"];

/**
 * Extract a structured reviewer result the agent was asked to emit as a
 * ```review fenced JSON block. Returns the markdown without the fence plus
 * the parsed block, or review: null when absent/malformed.
 */
export function splitReview(markdown: string): { clean: string; review: ReviewerBlock | null } {
  const m = FENCE.exec(markdown);
  if (!m) return { clean: markdown, review: null };
  let review: ReviewerBlock | null = null;
  try {
    const parsed = JSON.parse(m[1]) as {
      findings?: Array<{
        level?: string;
        title?: string;
        evidence?: string;
        check?: string;
        tag?: string;
      }>;
      note?: string;
      decision?: string;
    };
    const findings = (parsed.findings ?? [])
      .filter((f) => f.title)
      .map((f) => ({
        level: (LEVELS as string[]).includes(f.level ?? "") ? (f.level as FindingLevel) : "warn",
        title: String(f.title),
        evidence: f.evidence ? String(f.evidence) : undefined,
        check: (CHECKS as string[]).includes(f.check ?? "") ? (f.check as ReviewCheck) : undefined,
        tag: f.tag ? String(f.tag) : undefined,
      }));
    if (findings.length > 0 || parsed.note || parsed.decision) {
      review = {
        kind: "reviewer",
        findings,
        note: parsed.note,
        ...(["approve", "revise", "reject"].includes(parsed.decision ?? "")
          ? { decision: parsed.decision as "approve" | "revise" | "reject" }
          : {}),
      };
    }
  } catch {
    return { clean: markdown, review: null }; // malformed JSON: leave the text as-is
  }
  const clean = review ? markdown.replace(FENCE, "").trim() : markdown;
  return { clean, review };
}
