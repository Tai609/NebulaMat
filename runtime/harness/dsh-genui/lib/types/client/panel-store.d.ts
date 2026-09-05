/**
 * Session GenUI panel store: folds stable per-source panel operations into
 * one read-only snapshot per session. The toolview and the settled-fence
 * publisher submit operations (`replace`/`append`) carrying a stable
 * sourceId and a three-part order; the store deduplicates by source, sorts
 * by order, applies a deterministic fold under a node/append budget, and
 * notifies subscribers only when the folded snapshot actually changes.
 *
 * Ordering: no "last caller wins", no Infinity. Operations from DIFFERENT
 * sources always both apply; replays of the same source are idempotent; a
 * later replace resets everything earlier; an append beyond the budget is
 * remembered as an overflow barrier so an out-of-order earlier replace can
 * re-fold deterministically. A local `/panel` override (default panel or
 * clear) is the fold base and blocks every replay at/below the highest
 * message seq seen so far — old history can never resurrect the panel.
 *
 * Scale limits live in `PANEL_LIMITS` (adjustable defaults, not law — see
 * docs/plans/2026-08-12-dsh-genui-design-optimization.md). Budget
 * rejections are DETERMINISTIC (no LRU eviction: eviction would make the
 * fold depend on arrival order).
 *
 */
import type { GenuiSpec } from './spec.ts';
/** Panel scale limits — adjustable defaults (design doc: scale limits are
 *  configurable, not law). Folds read the CURRENT limits, so tuning applies
 *  from the next operation on. */
export declare const PANEL_LIMITS: {
    /** Max nodes in the folded panel snapshot. */
    readonly maxNodes: 200;
    /** Max append operations kept after the latest replace. */
    readonly maxAppends: 200;
};
type PanelLimits = {
    maxNodes: number;
    maxAppends: number;
};
/** Override the panel limits (operator tuning / tests). Applied at the next fold. */
export declare function setPanelLimits(next: Partial<PanelLimits>): void;
/** Three-part stable order: [messageSeq, textBlockIndex, fenceIndex]. */
export type PanelOrder = readonly [number, number, number];
/** One persistent panel operation from a settled source. */
export interface PanelOperation {
    /** Stable source identity (fence source id or `['render_ui', callId]`). */
    sourceId: string;
    order: PanelOrder;
    mode: 'replace' | 'append';
    spec: GenuiSpec;
}
export type PanelOperationStatus = 'accepted' | 'idempotent' | 'blocked' | 'overflow';
/**
 * Submit one panel operation. Idempotent per sourceId; ordering and budget
 * per the module doc. Returns the outcome so callers can diagnose once per
 * source (e.g. "panel at its node/appends budget — send a replace").
 */
export declare function applyPanelOperation(sessionId: string, op: PanelOperation): PanelOperationStatus;
/**
 * Apply the local `/panel` override: `spec` (the default panel) or null
 * (clear) becomes the fold base, and every operation at/below the highest
 * message seq seen so far is dead — old history replays cannot resurrect
 * the panel. A later real operation (order[0] > barrier) replaces or merges
 * into the override as usual.
 */
export declare function setLocalPanel(sessionId: string, spec: GenuiSpec | null): void;
/** Log one budget-overflow diagnostic per source (replays stay silent). */
export declare function diagnosePanelBudget(sessionId: string, sourceId: string): void;
/** Tear down a session's panel state (session destroy / hard clear). Memory
 * only: drops the in-memory record, the session's expand token, and overflow
 * diagnostics, so a long-lived app never accumulates per-session state for
 * closed sessions. The localStorage entry SURVIVES — reopening the session
 * restores the panel instantly (that is the persistence feature); an explicit
 * user clear goes through setLocalPanel(null), which persists the cleared
 * state + barrier. */
export declare function clearSessionPanel(sessionId: string): void;
/** Current folded spec for a session (useSyncExternalStore getSnapshot).
 * Lazily hydrates from localStorage on first access after a reload. */
export declare function getPanelSpec(sessionId: string): GenuiSpec | null;
/** Subscribe to panel changes. Returns the disposer. */
export declare function subscribePanel(listener: () => void): () => void;
/**
 * Merge an `append` spec into the current panel spec:
 * - both sides single-tabs containers → merge BY TAB LABEL: items of
 *   same-labelled tabs are appended, new labels are added (order preserved);
 * - otherwise → plain item lists are appended to the tail.
 * The previous title wins unless it was absent. `next` is returned as-is when
 * there is nothing to merge into. Export for tests.
 */
export declare function mergePanelSpecs(prev: GenuiSpec | null, next: GenuiSpec): GenuiSpec;
/** Request the panel dock to expand for a session (e.g. the /panel command). */
export declare function requestPanelExpand(sessionId: string): void;
/** Current expand token for a session (useSyncExternalStore getSnapshot). */
export declare function getPanelExpandToken(sessionId: string): number;
/** Subscribe to expand requests. Returns the disposer. */
export declare function subscribePanelExpand(listener: () => void): () => void;
export {};
