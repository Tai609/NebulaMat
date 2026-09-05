export interface PlotSeriesParam {
    name: string;
    value: number;
    min?: number | undefined;
    max?: number | undefined;
    step?: number | undefined;
    /** v1.5: animate this parameter from its initial value to this target. */
    animateTo?: number | undefined;
    /** Animation duration in ms (default 4000). */
    durationMs?: number | undefined;
    /** Loop the animation (default false). */
    loop?: boolean | undefined;
}
export interface PlotSeries {
    /** Math expression in x. */
    expr: string;
    /** Optional label shown in a legend row. */
    label?: string | undefined;
    /** Stroke color; defaults to the accent token (multi-series auto-assign). */
    color?: string | undefined;
    /** v2.9 draw shape: line (default), area (fill to baseline), scatter. */
    kind?: 'line' | 'area' | 'scatter' | undefined;
    /** v2: adjustable parameters, one slider each, live re-render. */
    params?: PlotSeriesParam[] | undefined;
}
/** Categorical palette for multi-series plots: host static tokens only
 * (design system v2 — same families as the chart/avatar palettes in
 * GenuiBlock, no off-theme hexes). CSS custom properties resolve inside
 * inline `style` on SVG strokes and legend swatches. */
export declare const PLOT_COLORS: string[];
export interface PlotBlockProps {
    /** Functions to draw, in draw order. */
    series: PlotSeries[];
    /** Horizontal range, inclusive. */
    xMin?: number | undefined;
    xMax?: number | undefined;
    /** Vertical bounds; omitted = auto-fit to the sampled data. */
    yMin?: number | undefined;
    yMax?: number | undefined;
    /** Chart title. */
    title?: string | undefined;
}
/** Render one plot: grid, axes, one polyline per series, legend, sliders. */
export declare const PlotBlock: import("react").NamedExoticComponent<PlotBlockProps>;
