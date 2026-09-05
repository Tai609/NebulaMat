/**
 * The dsh-ui fence render pipeline, shared by both render channels:
 *
 * - **Registry channel** (contract hosts): the host's MarkdownText resolves
 *   ```dsh-ui fences through the fence-registry extension point and calls
 *   {@link renderGenuiFence} with a session-scoped context (sessionId + the
 *   settled source identity). An unrepairable body renders {@link FenceFallback}.
 * - **DOM channel** (pristine hosts, no extension point): the DOM observer
 *   (`dom-fence.ts`) finds stock code blocks labelled `dsh-ui` and mounts
 *   {@link renderResolvedFenceNode} into its own React root, wrapped in the
 *   plugin-owned action context. An unrepairable body returns `null` so the
 *   stock code block stays visible.
 *
 * Structural types are declared locally on purpose: the context contract is
 * a data shape, and pristine hosts do not export the host-side type names.
 */
import { type Key, type ReactNode } from 'react';
import type { GenuiSpec } from './spec.ts';
/** Settled fence source identity (data shape, host-independent). */
export interface GenuiFenceSource {
    /** Stable structural id, e.g. `['assistant', seq, block, fence]` or `dom:<anchor>:<i>`. */
    readonly id: string;
    /** Three-part order: [messageSeq, textBlockIndex, fenceIndex]. */
    readonly order: readonly [number, number, number];
}
/** Context a fence renderer receives beside the raw source and React key. */
export interface GenuiFenceContext {
    /** Owning session route; absent outside a session-scoped render. */
    readonly sessionId?: string;
    /** Present only for settled/interrupted renders with a stable identity. */
    readonly source?: GenuiFenceSource;
}
/**
 * Resolve a raw fence body to a guarded spec.
 *
 * - Tier-1 repair (quote escape + trailing commas): safe at any time —
 *   adopted only when the whole body parses, so a still-growing streaming
 *   half keeps falling back to the code block, never flashing a banner.
 * - Tier-2 completion (missing quotes/brackets): settled renders only —
 *   `context.source` exists exclusively once the message finished, so
 *   streaming halves are never completed early.
 */
export declare function resolveGenuiSpec(raw: string, context?: GenuiFenceContext): GenuiSpec | null;
/**
 * The resolved fence render for the DOM channel: `null` when the body is
 * unrepairable (the stock code block stays visible), otherwise the panel
 * publisher (`panel:true`; renders nothing in the flow — mounted as an empty
 * root so the taken-over block is hidden) or the inline GenuiBlock tree.
 * Shared verbatim by both channels.
 */
export declare function renderResolvedFenceNode(raw: string, key: Key, context?: GenuiFenceContext): ReactNode | null;
/**
 * Registry-channel fence renderer (contract hosts): like the resolved node,
 * but an unrepairable body renders the fallback code block + settled
 * diagnostic — the host replaced its own block with our output — and an
 * unpublishable `panel:true` fence renders `null` (nothing in the flow).
 */
export declare function renderGenuiFence(raw: string, key: Key, context?: GenuiFenceContext): ReactNode;
