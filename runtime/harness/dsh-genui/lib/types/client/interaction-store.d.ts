/**
 * Interaction-state store: durable per-block GenUI interaction state
 * (radio answers, submit lock, input/textarea values) in localStorage.
 *
 * LOCAL-FIRST persistence: a ```dsh-ui block's interactive state survives
 * page refresh and session reopen because it is keyed by
 * `session + block slot + content fingerprint` — replaying the same message
 * (same content) restores the exact state, while NEW content (换题, edited
 * spec) gets a fresh key and thus a clean slate. Different messages never
 * share state because their content fingerprints differ.
 *
 * Bounded: at most MAX_BLOCKS entries, LRU-evicted on write; each block's
 * payload is small (answers map + a few field values).
 * @module @omdsh-dev/dsh-genui/client/interaction-store
 */
/** Durable state of one UI block. */
export interface BlockInteractionState {
    /** group → chosen option label (radio aggregation answers). */
    answers?: Record<string, string>;
    /** True after a local grading: the paper stays graded across refresh. */
    locked?: boolean;
    /** field id → current value (input/textarea with an `id`). */
    fields?: Record<string, string>;
}
/** Load a block's durable state, or null when absent/corrupt. */
export declare function loadBlockState(stateKey: string): BlockInteractionState | null;
/** Save a block's durable state (LRU: touched keys move to the front). */
export declare function saveBlockState(stateKey: string, state: BlockInteractionState): void;
/** Forget a block's durable state (e.g. after a reset-to-empty). */
export declare function clearBlockState(stateKey: string): void;
/**
 * Deterministic content fingerprint (djb2) for a block's raw fence body.
 * Two render passes of the SAME content share a fingerprint (state restores);
 * edited content gets a new one (fresh state). Not a security hash — the
 * store only uses it for equality/identity.
 */
export declare function fingerprint(raw: string): string;
/** Build the durable state key for a fence block: session + fence slot + content fingerprint. */
export declare function fenceStateKey(sessionId: string, fenceKey: number | string, raw: string): string;
/** Build the durable state key for a panel publish (content-keyed). */
export declare function panelStateKey(sessionId: string, raw: string): string;
/** Build the durable state key for a render_ui tool card (call-keyed). */
export declare function toolStateKey(sessionId: string, callId: string): string;
