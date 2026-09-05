---
name: publication-figures
description: Use whenever you generate or review a chart, plot, table, or paper figure in this workspace, including work delegated by paper-writing, literature-survey, and experiment skills. Applies the Open Science publication style, enforces readable final-size layout for figures and tables, and rejects generic diagram-tool output as a publication figure. Interactive Plotly/HTML may be used for exploration, but paper delivery requires a static publication-ready export.
---

# Publication Figures and Tables

Make generated figures **publication-grade and on-system by default**. Every
figure you produce with matplotlib must use the bundled Open Science style, so a
figure in a report and a stat tile in the app read as one design system.
When a paper/survey skill or target venue specifies its own publication palette
and physical type scale, that more specific standard overrides this palette;
the final-size, collision, and figure-form rules below still apply.

## Apply the style (always, before plotting)

The style file `openscience.mplstyle` sits next to this SKILL.md. Load it by
absolute path at the top of any figure script:

```python
import matplotlib.pyplot as plt
from pathlib import Path

# This skill's directory — the style ships beside SKILL.md.
STYLE = Path(__file__).resolve().parent / "openscience.mplstyle" if "__file__" in dir() else None
# In a notebook/agent cell, use the skill's deployed path directly:
plt.style.use(str(STYLE)) if STYLE and STYLE.exists() else plt.style.use("default")
```

If you cannot resolve the path, set the palette inline (same hexes as below).

## Choose a paper-appropriate form

- Use matplotlib/seaborn for quantitative evidence; use a purpose-built
  TikZ/SVG/PDF schematic for a method or architecture; use scientific image
  panels only with source, crop, scale, and processing provenance.
- Do not use Mermaid, PlantUML, generic flowchart/mind-map output, diagram-editor
  screenshots, or notebook/UI screenshots as a final paper figure. They may be
  scratch aids only. Graphviz is acceptable only when the graph itself is the
  analysed data, not as a shortcut for a generic process diagram.
- Every figure must make evidence, a mechanism, or an experimental design easier
  to understand. Decorative roadmaps, funnels, icon collages, and stock process
  diagrams do not belong in a paper.

## The shared palette (single source of truth)

These are the exact hues the app's native charts use. Assign categorical series
in this fixed order — never a different order, never a cycled 9th hue.

| Slot | Hue | Light hex |
|------|-----|-----------|
| 1 | blue | `#2a78d6` |
| 2 | aqua | `#1baf7a` |
| 3 | yellow | `#eda100` |
| 4 | green | `#008300` |
| 5 | violet | `#4a3aa7` |
| 6 | red | `#e34948` |
| 7 | magenta | `#e87ba4` |
| 8 | orange | `#eb6834` |

Sequential (magnitude, one hue light→dark): `#cde2fb #9ec5f4 #6da7ec #3987e5
#256abf #184f95 #104281`. Diverging: blue ↔ red with a neutral gray midpoint.

## Rules (from the app's dataviz standard)

- **One y-axis.** Never two scales on one plot — use two charts or index to a
  common base.
- **Categorical color = identity, assigned in slot order; sequential = one hue
  by magnitude; diverging = two hues + gray midpoint.** Never a rainbow.
- **Thin marks, recessive chrome:** 2px lines, ≥6pt markers, hairline y-grid
  only, no top/right spines (the style sets these).
- **Label selectively** — the endpoint or the extreme, never a number on every
  point. A legend is present for ≥2 series; a single series needs none (the
  title names it).
- **Text stays in ink**, never the series color. Identity comes from the mark.
- **Fit by design, not tiny type.** Size for the final column/page first. When
  labels compete for space, enlarge the canvas, wrap/shorten labels, show fewer
  ticks, move the legend, use a horizontal chart, or split panels. Do not shrink
  any text below 7 pt at final size.
- **No collisions.** Labels, ticks, legends, annotations, watermarks, panel
  letters, and data marks may not overlap or be clipped. Use constrained layout
  where appropriate, but always inspect the rendered result; an automatic
  layout call is not proof.
- **Save clean:** `plt.savefig(path, bbox_inches="tight")` (the style sets dpi).

## Keep paper tables readable

- Design every table for its final column or page width. Body text must remain at
  least 8 pt at final size.
- Resolve an over-wide table in this order: shorten or wrap headings and move
  units/details into the caption or notes; use flexible text columns and aligned
  numeric columns; split the table or move secondary columns to an appendix; use
  landscape for a genuinely wide appendix table; reduce cell padding last.
- Do not solve width by scaling the entire table until it fits. If scaling would
  make text smaller than 8 pt, redesign or split the table.
- Keep precision purposeful, repeat units once, and avoid dense vertical rules.
- Render the containing PDF or page to an image at the intended output size and
  inspect it. A table fails if it crosses margins, clips content, overlaps text,
  or is readable only by zooming.

## Final-size inspection

For PDF output, rasterize the actual final artifact before delivery:

```bash
pdftoppm -png -r 180 paper.pdf /tmp/paper-check/page
```

Inspect every page containing a generated figure or table. Source dimensions,
`tight_layout`, `constrained_layout`, and a successful compile are not evidence
that the rendered result is readable.

## Checklist before returning a figure or table

1. Style applied (palette + chrome from `openscience.mplstyle`).
2. Series colors assigned in slot order; ≤8 series (else group into "Other").
3. Single y-axis; legend iff ≥2 series; axis labels + units present.
4. Figure form is appropriate for a paper; no Mermaid/PlantUML/generic diagram.
5. Table fits by structure rather than tiny type; final body text is at least
   8 pt.
6. Final PDF/page was rasterized and visually inspected: readable text, no
   overlap, clipping, or margin overflow.
7. Saved to the workspace and referenced by path so it surfaces as an artifact.
