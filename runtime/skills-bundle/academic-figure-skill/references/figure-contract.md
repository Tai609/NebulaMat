# Figure Contract

A publication-quality scientific figure is a visual argument, not an isolated plot. Before any code, color, or layout: articulate the scientific claim, map the evidence, and check for review risks. This contract must be established before Step 1 (Analyze the Request) in the Hub workflow.

## The Five-Point Contract

For every figure request, establish these five items before generating code:

### 1. Core Conclusion

Write the **one-sentence claim** the figure must defend. This is the answer to: "If the reader looks at this figure for 3 seconds, what should they conclude?"

- Good: "Knockout of Gene X reduces tumor growth by 60% in the PDX model, and this effect is rescued by WT re-expression."
- Bad: "This figure shows the results of the tumor growth experiment."

The conclusion determines what data is essential and what is noise. If you can't write the one-sentence conclusion, the figure isn't ready to be designed.

### 2. Evidence Chain

Map each planned panel to its unique contribution to the core conclusion. **Drop any panel that does not carry unique evidence.**

```
Panel a: [what it shows] → contributes [what unique evidence] to the conclusion
Panel b: [what it shows] → contributes [what unique evidence] to the conclusion
...
```

If two panels show the same data in different forms (e.g., bar chart + pie chart of the same values), merge or drop one. Redundancy signals weak narrative design to reviewers.

### 3. Figure Archetype

Classify the figure into one of four archetypes. The archetype determines layout strategy, hero panel rules, and narrative rhythm:

| Archetype | Description | Typical Layout |
|-----------|-------------|----------------|
| `quantitative grid` | Regular grid of data panels (boxplots, bars, heatmaps) | Even grid, consistent panel size, shared axes |
| `schematic-led composite` | A schematic/model panel leads, supported by data panels | Large schematic (1/3 width) + 2-3 data panels |
| `image plate + quant` | Microscopy/images paired with quantification | Image panels (larger) + adjacent quantification panels |
| `asymmetric mixed-modality` | Non-uniform layout mixing schematics, images, and data | Custom gridspec, variable panel sizes |

If unsure, default to `quantitative grid`. Most CNS figures fall into this archetype.

### 4. Journal / Export Contract

Set the target before styling:
- **Target journal:** [journal name or "Nature-family standard"]
- **Layout:** single-column (89mm) or double-column (183mm)
- **Export format:** vector master (PDF/SVG) + 300dpi PNG preview
- **Color mode:** RGB
- **Font:** Arial/Helvetica, ≥5pt at print size

### 5. Review Risk Assessment

Identify what a reviewer might challenge before they see it:

- **Statistics:** Are statistical tests clearly defined? Are error bars labeled (SD/SEM/CI)? Are p-values reported with exact values?
- **Sample size:** Is n clearly stated? Are individual data points visible for small n (<10)?
- **Color accessibility:** Is the figure interpretable in greyscale? Are red-green only pairs avoided?
- **Data traceability:** Can every data point be traced to source data?
- **Image integrity:** For microscopy/blot images — are scale bars present? Are contrast adjustments documented?

Flag any risks explicitly. A flagged risk is a checklist item; an unflagged risk becomes a reviewer comment.

## Contract Establishment Protocol

### When to Use the Contract

- **Full contract (all 5 points):** New figure from scratch, major revision, or when the user says "I want to make a figure for my paper."
- **Abbreviated contract (conclusion + evidence only):** Quick refinement of an existing figure, or when the user provides clear specifications.
- **Skip contract:** The user explicitly asks for a quick cosmetic fix ("change the color of this bar to blue") — cosmetic-only changes don't need a new contract.

### How to Present

When establishing the contract, present it conversationally, one point at a time if the user is unsure. For experienced users who know what they want, present all 5 points at once and ask for confirmation.

### Relation to Hub Workflow

The contract is established **before** Hub Step 1 (Analyze Request). After the contract is confirmed, proceed to the normal Hub workflow:

```
Figure Contract (5 points)
    │
    ▼
Hub Step 1: Analyze Request (figure type, tool, journal)
    │
    ▼
Hub Step 2: Route or Handle
    │
    ▼
... (continue normal workflow)
```

The contract keeps the figure honest. The Hub workflow makes it beautiful. Both are needed.
