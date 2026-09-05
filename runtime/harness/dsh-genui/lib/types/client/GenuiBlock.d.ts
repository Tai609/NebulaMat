import type { GenuiBlockProps } from './blocks/state.ts';
export declare const GENUI_ACTION_DEBOUNCE_MS = 300;
/**
 * Render a GenUI spec as an inline block. Falls back to nothing when the spec
 * carries no items (the fence renderer already refused non-specs before us).
 */
export declare const GenuiBlock: import("react").NamedExoticComponent<GenuiBlockProps>;
