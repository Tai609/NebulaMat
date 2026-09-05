# Published CNS Figure Deconstructions

Reverse analysis of published figures from Nature/Cell/Science — what makes them work and what techniques can be reused.

Each entry follows: **Source → Figure Type → Why It Works → Reusable Techniques → What to Avoid Copying**.

---

## Deconstruction 1: Multi-Omics Heatmap with Annotations

**Source:** Nature 2023, Vol. 619, "Multi-omics profiling of the tumor microenvironment" (representative example pattern)
**Figure Type:** Complex heatmap with row/column annotations

**Why It Works:**
- The main heatmap body uses a diverging blue-white-red colormap with smooth transition
- Row annotations (pathway membership, significance level) provide immediate biological context without reading the caption
- Column annotations (sample group, batch) are visually subordinate to the data — narrow bars, muted colors
- The dendrogram is compressed (narrow width allocation) so it doesn't compete with the data for space
- Only 30-50 key genes are labeled by name; the rest are shown as rows without labels

**Reusable Techniques:**
1. `colorRamp2` with explicitly defined breakpoints for smooth color transitions
2. Compressed dendrograms: `row_dend_width = unit(8, "mm")`
3. Annotation bar hierarchy: biological annotations (wider, richer colors) > technical annotations (narrower, grey)
4. Selective row labeling: label only genes of interest, not all
5. Merged legend via `draw(ht, merge_legend = TRUE)`

**What to Avoid Copying:**
- Don't blindly use the same color scale for a completely different data type
- The specific annotation layout is tailored to this dataset; adapt to your data structure

---

## Deconstruction 2: Multi-Panel Figure 1 (Discovery Arc)

**Source:** Cell 2024, Vol. 187, "CRISPR screen identifies regulators of..." (representative example pattern)
**Figure Type:** 6-panel composite: volcano (a) → heatmap (b) → validation scatter (c-d) → mechanism model (e) → clinical correlation (f)

**Why It Works:**
- The 6 panels tell a complete story: discovery → validation → mechanism → relevance
- Panel a (volcano) uses clean grey/blue/red color coding to establish the "hit" visual vocabulary used throughout the figure
- Panels c-d share an identical y-axis scale, making cross-panel comparison effortless
- Panel e (mechanism model) uses a simplified schematic with colors matching the data panels
- Panel f (clinical) directly connects the discovery to translational relevance

**Reusable Techniques:**
1. Consistent color coding across all panels (same color = same gene/pathway throughout)
2. Shared axis scales between related data panels
3. Panel layout follows reading direction (left-right, top-bottom narrative)
4. Schematic colors echo data panel colors
5. Panel labels (a-f) in consistent position with sufficient whitespace around each

**What to Avoid Copying:**
- Don't force a 6-panel format on a story that only needs 3-4 panels
- The specific layout is driven by the biological narrative, not the other way around

---

## Deconstruction 3: Single-Cell UMAP with Expression Overlay

**Source:** Science 2023, Vol. 382, "Single-cell atlas of..." (representative example pattern)
**Figure Type:** UMAP with cluster coloring (a) + feature expression overlay (b-d) + proportion bar charts (e)

**Why It Works:**
- Panel a establishes the cellular landscape with a discrete qualitative palette (8-12 clusters)
- Panels b-d use a perceptually uniform sequential colormap (viridis or custom blue-yellow) for gene expression overlay
- Point size is very small (s=0.5-1) with low alpha, so density patterns (not individual points) drive perception
- Panel e translates the visual patterns into quantitative comparisons that can be cited in the text
- The figure answers three questions in sequence: what cell types exist? what genes mark them? how do proportions differ?

**Reusable Techniques:**
1. Small point size (s=0.5-1) with transparency for >10K cells
2. Discrete palette for clusters, sequential palette for expression — never mix these roles
3. Quantitative summary panel (bar chart, boxplot) alongside visual exploration panels
4. Cluster labels placed at centroid positions, not in a distant legend
5. Consider `rasterized=True` for the scatter layer when point count exceeds 50K

**What to Avoid Copying:**
- The specific UMAP parameters are data-dependent; do not copy perplexity/n_neighbors blindly
- Feature expression color scale max should be set per gene, not globally

---

## Deconstruction 4: GWAS Manhattan Plot with Regional Zoom

**Source:** Nature Genetics 2024, Vol. 56, "GWAS of..." (representative example pattern)
**Figure Type:** Manhattan plot (a) + regional association plot / LocusZoom (b) + gene structure track (c)

**Why It Works:**
- Panel a uses alternating chromosome colors (dark blue / light blue, NOT rainbow) for genome-wide view
- The significance threshold line (genome-wide p < 5e-8) is a distinct red dashed line, immediately visible
- Top hits are annotated with the nearest gene name at an angle
- Panel b zooms into the lead SNP region, showing LD structure (r² colors) and recombination rate overlay
- Panel c adds functional context: which genes are in the region, their exon/intron structure

**Reusable Techniques:**
1. Alternating two-color scheme for chromosomes (never rainbow)
2. Red dashed significance threshold line, clearly labeled with p-value
3. Gene labels rotated 45-60 degrees for readability or placed with leader lines
4. Regional zoom panel with LD information (LocusZoom style)
5. Three-tier information density: genome-wide overview → regional detail → functional annotation

**What to Avoid Copying:**
- The specific genomic region depends entirely on the data
- Gene track panel may not be needed if no eQTL/functional data is available

---

## Deconstruction 5: Protein Structure with Binding Interface Detail

**Source:** Nature 2024, Vol. 628, "Cryo-EM structure of..." (representative example pattern)
**Figure Type:** Overall structure (a) + binding interface zoom (b) + mutagenesis validation (c) + sequence alignment (d)

**Why It Works:**
- Panel a shows the overall structure in surface representation with each subunit in a distinct, muted color
- Panel b zooms into the interface, switching to cartoon representation to show secondary structure, with key residues as sticks
- Panel c validates the structural findings with functional mutagenesis data (bar chart)
- Panel d provides evolutionary context with sequence conservation mapped onto the structure colors
- A consistent color scheme ties all panels together: the same subunit colors appear in structure, interface, and alignment

**Reusable Techniques:**
1. Surface representation for overview (subunit coloring), cartoon for detail (secondary structure visible)
2. Key residues shown as sticks with atom-colored heteroatoms (N blue, O red, S yellow)
3. Mutagenesis validation panel positioned adjacent to the structural detail it validates
4. Conservation coloring in alignment matches the subunit coloring in structure
5. Figure answers: what does it look like? how do they interact? does it matter functionally? is it conserved?

**What to Avoid Copying:**
- Structure visualization requires PyMOL/ChimeraX expertise; the rendering parameters are tool-specific
- The specific viewing angles are chosen to highlight this particular interface

---

## Using These Deconstructions

When a user requests a figure type that matches one of these patterns:
1. Reference the relevant deconstruction for composition and technique guidance
2. Adapt the reusable techniques to the user's specific data and narrative
3. Warn about the "what to avoid" items specific to that figure type

When you encounter a particularly well-executed published figure worth deconstructing, add it using the same format.
