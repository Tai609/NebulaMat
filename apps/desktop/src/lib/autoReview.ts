// Auto-review on turn completion (#72): when a turn actually changed workspace
// files, the bundled `reviewer` agent gets one read-only turn in an isolated
// child session. Only its public summary and ```review block are mirrored into
// the parent thread.
//
// Off by default. It costs a second model turn per file-changing turn, so it is
// the user's call — and the gates below exist so it never doubles that cost on
// turns where there is nothing to review.

/** Audit role label for the reviewer module. The child is a DSH fork, so it
 *  inherits the parent's preset and receives the review contract as a prompt. */
export const REVIEWER_AGENT = "reviewer";

export const AUTO_REVIEW_KEY = "ai4s.autoReview.v1";

/** The turn the app sends on the session's behalf. Stable text: the thread and
 *  reloaded history recognize it by exact match and hide it, so the user sees
 *  the findings appear after their own work rather than a prompt they never
 *  wrote. */
export const AUTO_REVIEW_PROMPT =
  "Review the work just completed in this workspace and report findings. " +
  "Follow your output contract exactly: a short summary, then one `review` " +
  "fenced block as the last thing in the message.";

/** The model receives the same prompt plus private prepared context. Keep the
 * synthetic turn hidden from the transcript in both the legacy exact-text
 * form and the prepared form. */
export function isAutoReviewPrompt(text: string): boolean {
  return text === AUTO_REVIEW_PROMPT || text.startsWith(`${AUTO_REVIEW_PROMPT}\n\n[NEBULAMAT_INTERNAL_`);
}

/** Tools whose success means a workspace file changed. `bash` is deliberately
 *  absent: a command that happens to write a file is indistinguishable here from
 *  `ls`, and treating every shell step as a change would review every turn. */
const MUTATING_TOOLS = new Set([
  "write",
  "create",
  "edit",
  "str_replace_editor",
  "apply_patch",
  "patch",
  "multiedit",
]);

export function isMutatingTool(tool: string, status: string): boolean {
  return status === "success" && MUTATING_TOOLS.has(tool.toLowerCase());
}

export interface AutoReviewGate {
  /** The user turned auto-review on. */
  enabled: boolean;
  /** The finished turn wrote or edited a workspace file. */
  changedFiles: boolean;
  /** The finished turn WAS a review — reviewing a review never ends. */
  wasReview: boolean;
  /** A subagent's session: its parent's turn is what gets reviewed. */
  isSubagent: boolean;
  /** The runtime exposes the reviewer agent (a custom profile or an older
   *  sidecar may not) — without it the send would fail with "Agent not found". */
  hasReviewer: boolean;
}

/**
 * Whether a just-finished turn earns a review. Every gate is a case where
 * reviewing would be waste or a loop: a read-only turn has nothing to audit, a
 * review's own turn would trigger the next one, and a subagent session is
 * reviewed through its parent.
 */
export function shouldAutoReview(gate: AutoReviewGate): boolean {
  return (
    gate.enabled &&
    gate.changedFiles &&
    gate.hasReviewer &&
    !gate.wasReview &&
    !gate.isSubagent
  );
}
