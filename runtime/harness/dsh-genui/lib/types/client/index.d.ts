/**
 * dsh-genui browser half: the ```dsh-ui fence renderer, the keyed toolview
 * for the `render_ui` tool, and the session panel dock.
 *
 * Fence rendering is dual-mode, chosen at boot:
 * - **Registry channel** (contract hosts): the host's MarkdownText resolves
 *   ```dsh-ui fences through the fence-registry extension point; this package
 *   registers `renderGenuiFence`. Action callbacks ride the host-installed
 *   GenuiActionContext.
 * - **DOM channel** (pristine hosts): no extension point exists, so
 *   `dom-fence.ts` observes the conversation DOM, finds settled stock code
 *   blocks labelled `dsh-ui`, and mounts the same render pipeline in its own
 *   React roots — wrapped in the plugin-owned GenuiActionContext that relays
 *   `[genui-action]` through the scoped conversation send. Either way the
 *   deployment is the STOCK DSH snapshot plus this plugin.
 *
 * The renderer parses the fence body with the partial parser: while the reply
 * streams, every FINISHED component appears the moment its JSON object
 * closes, so the UI assembles top-down before the fence (or reply) completes.
 * A body with no finished component yet falls back to a plain code block.
 * @module @omdsh-dev/dsh-genui/client
 */
import type { Context } from '@deepseek-ai/cordis';
import { renderGenuiFence } from './fence-render.tsx';
/** Add low-priority prefetch links for the lazy engine assets (mermaid/three).
 * Browser-dependent: some engines ignore `<link rel=prefetch>`; harmless
 * either way — the on-demand loader still covers a cache miss. Exported for
 * tests. */
export declare function prefetchGenuiAssets(): void;
/** Cordis client entry: register the fence renderer on boot, the keyed
 * toolview for the render_ui tool, and the session panel dock; returning the
 * disposers lets cordis tear all registrations down on plugin unload. */
export declare function apply(ctx: Context): () => void;
export declare const inject: string[];
export { renderGenuiFence };
export type { GenuiFenceContext } from './fence-render.tsx';
