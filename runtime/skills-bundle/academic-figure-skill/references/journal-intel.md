# Journal-Specific Unwritten Preferences

This file captures tacit editorial and reviewer preferences — things that are NOT in the official author guidelines but that experienced authors learn through submission and revision. Content is structured by journal.

---

## Nature Genetics

**Overall Figure Style:**
- Strong preference for multi-panel, information-dense figures (Nature Genetics readers expect comprehensive genetic evidence per figure)
- Each main figure typically tells one complete genetic story arc: discovery → validation → mechanism → clinical relevance
- Panel labels (a, b, c...) should follow a clear reading order — the narrative line between panels should be obvious without reading the caption

**Color Preferences:**
- Favor cool-toned palettes (blues, teals, purples) for primary data. Warm colors (red, orange) reserved for emphasis
- Manhattans: prefer dark blue alternating chromosomes, never rainbow chromosomes
- GWAS/heatmap: use diverging blue-white-red (RdBu or custom equivalent), but the red extreme should be muted (not pure #FF0000)

**Figure Caption Expectations:**
- More technical detail expected than other Nature journals. Define every abbreviation, every statistical test used, every data transformation

**Common Desk Reject Triggers:**
- Figures that tell multiple unrelated stories in one composite (sign of weak narrative focus)
- Manhattan plots without clear significance threshold line and annotation of top hits
- Heatmaps where row/column labels are illegible from overcrowding

---

## Nature Plants

**Overall Figure Style:**
- Photographic panels (plant phenotypes, micrographs, tissue sections) must share visual language with data panels
- If a figure mixes photos and data plots, the photo panels typically come first (left to right, top to bottom), establishing the biological context before the quantitative analysis

**Unwritten Rules for Micrographs:**
- Scale bars: minimum length of ~10% of the image width; white or black depending on background; always described in caption
- Magnification must be stated in caption, not just scale bar length
- Fluorescence merge panels: always include individual channel panels alongside the merge (not just the merge in main figure and channels in supplement)

**Figure Caption Expectation:**
- Similar technical rigor to Nature Genetics, but emphasis on describing the biological material (genotype, growth conditions, developmental stage)

**Common Desk Reject Triggers:**
- Microscopy images without scale bars (instant rejection from reviewers)
- Data plots using default Excel/Prism styling (Nature Plants expects polished, custom-styled figures)
- Inconsistent color mapping for the same treatment across different panels

---

## Cell Systems

**Overall Figure Style:**
- Computation/modeling-focused journal — figures must communicate both biological insight AND computational methodology clearly
- Cartoon/schematic diagrams are expected and encouraged (unlike Nature Genetics where they're secondary)
- Schematic panels typically use muted non-data colors (greys, light blues) distinct from data panel colors

**Unwritten Rules:**
- Network and interactome diagrams: node size and edge thickness must be mapped to quantitative properties (never arbitrary), with the mapping explained in caption
- t-SNE/UMAP figures: color scales must be perceptually uniform; label clusters with biologically meaningful names, not numbers
- Model performance plots (ROC, PR curves): include AUROC/AUPR values on the plot; show both training and test set performance

**Common Desk Reject Triggers:**
- Figure overload — trying to cram data + schematic + model diagram into one undersized panel set
- Default R plotting aesthetics (base R plot() output clearly visible)
- Missing statistical details in methods/models described in figures

---

## Adding New Journals

When adding a new journal entry, follow this template:

```markdown
## [Journal Name]

**Overall Figure Style:**
[2-3 sentences about what characterizes this journal's visual style]

**Unwritten Rules:**
- [Specific rule with rationale]

**Common Desk Reject Triggers:**
- [Trigger item]

**Figure Caption Expectation:**
[Any special expectations for captions]
```

Sources: accumulated from published papers, editorial guidelines, and author experiences. Update as new patterns emerge from revision cases (see `revision-cases.md`).
