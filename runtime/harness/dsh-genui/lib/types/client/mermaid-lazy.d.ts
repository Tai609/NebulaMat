export { assertSafeSvg, repairMermaidSource } from './mermaid-safe.ts';
/**
 * Render mermaid source to an SVG string (engine loaded on demand).
 * @param code - the mermaid diagram source.
 * @returns the rendered SVG markup (verified free of script/event handlers).
 * @throws when the asset cannot load, the kind is not whitelisted, rendering
 *   fails, or the output fails the sanitization check.
 */
export declare function renderMermaid(code: string): Promise<string>;
