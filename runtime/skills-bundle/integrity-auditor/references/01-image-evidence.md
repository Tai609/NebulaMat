# Image Evidence — What to Look For and How to Record It

## What this track audits

Biomedical and ML papers carry image evidence: Western blots, immunofluorescence, microscopy, flow cytometry, tissue slices, animal photos, model architecture diagrams, training-curve plots. Image misuse is the most common integrity failure because two superficially different panels can share the same random texture, background noise, or band shape — and that is provable from the pixels alone.

The auditor inspects pixels and records what was found. The auditor does **not** declare manipulation; it records "panel X and panel Y share region R after transformation T".

## The four checks

### Check 1 — Within-figure duplicates

Take every panel inside one figure (Figure 2 panels A–F, for example). Compare each pair. Real experimental images do not share random noise, background grain, or cell positions across different conditions. If two panels look identical or share a sub-region, that is a flag.

Practical reading rules:

- Look at the corners and the empty background, not the headline structure. Real noise differs even when conditions look similar.
- For Western blots, scan the gel background between bands. Each lane and each blot has its own noise pattern.
- For microscopy, look at out-of-focus debris and edge artefacts. These are random across captures.

### Check 2 — Cross-figure duplicates

Same as Check 1, but compare panels across different figures. Common findings include "loading control band in Figure 2 reused as loading control in Figure 5". For a local paper-writer slug audit, also compare against the `output/experiment-suite/<slug>/latest/figures/` directory — the paper should not contain figures that are not in the experiment-suite manifest.

### Check 3 — Transformation reuse

Some duplicates are not direct copies. They are rotated, flipped, scaled, brightness-adjusted, or partially cropped. The auditor must check:

- horizontal flip
- vertical flip
- 90 / 180 / 270 degree rotation
- crop of a larger region
- brightness / contrast adjustment that preserves texture structure

When a pixel-level dup is suspected, sketch the alignment in the finding file: "Figure 2A upper-left 200×80 region matches Figure 5C lower-right 200×80 region after horizontal flip".

For perceptual hashing, use `forensics_tools/image_dup.py` (sits at the skill root). Invocation from inside a run directory:

```bash
python /path/to/integrity-auditor/forensics_tools/image_dup.py \
    figures_hires/*.png panels_correction/*.png panels/*.png \
    > findings/image/dhash_pairs.txt
```

Important limitation: **whole-figure dHash rarely catches panel reuse**. Use `forensics_tools/panel_split.py` to split each figure into panels first, then run `image_dup.py` against the per-panel directory:

```bash
for f in $RUN/figures_hires/fig*.png; do
    python /path/to/forensics_tools/panel_split.py "$f" "$RUN/panels/"
done
python /path/to/forensics_tools/image_dup.py "$RUN"/panels/*.png > "$RUN/findings/image/dhash_pairs.txt"
```

For **transformed duplicates** (rotation / flip / crop / brightness change) that survive phash distance > 30, use `forensics_tools/image_dup_orb.py`. ORB feature matching is rotation- and crop-invariant by design, and the script's mirror-augmentation pass also catches flipped duplicates:

```bash
python /path/to/integrity-auditor/forensics_tools/image_dup_orb.py \
    "$RUN"/panels/*.png \
    --strong 30 --weak 12 \
    > "$RUN/findings/image/orb_pairs.txt"
```

When to use ORB vs perceptual hash:

| Distance signal | Diagnosis | Next step |
|---|---|---|
| dHash < 16 | Untransformed dup | confirm visually; file finding |
| dHash 16–30 | Likely transformed dup or very similar texture | run `image_dup_orb.py`; if ORB matches ≥ 30, confirm visually |
| dHash 30–60 | Could be transformed dup (rotation / crop / flip) | run `image_dup_orb.py`; phash alone insufficient |
| dHash > 60 | Probably independent | optional ORB sanity-check on visually-suspect pairs only |

Empirical motivation: the Kang Tiebang Fig 6d admitted vector ↔ Δ1-10 duplicate produced mean-diff 11–19 across candidate pairs in `image_dup.py` — high enough that phash did not flag, low enough to be suspicious. The duplicate likely involves rotation or flip; ORB matching is the right complementary signal.

Even with panel splitting and ORB, two classes of issue stay outside both phash and ORB reach and need different evidence:

1. **Within-panel sub-image swaps** (e.g., a labelled "DAPI" sub-image that is actually a Merge image — the Wang Ping Fig 2f case). Each sub-image is correctly drawn but mislabeled. Use `forensics_tools/channel_check.py`:

   ```bash
   # Sub-split a fluorescence panel into per-channel sub-cells.
   python /path/to/forensics_tools/panel_split.py \
       "$RUN/panels/<panel>.png" "$RUN/sub_cells/<panel>/" \
       --min-gutter-px 6 --min-panel-px 50
   # Classify each cell by RGB content.
   python /path/to/forensics_tools/channel_check.py \
       "$RUN/sub_cells/<panel>/"*.png > "$RUN/findings/image/<panel>_channel_check.txt"
   ```

   Interpret: a cell expected to be "DAPI" classified as `blue+green` (G/B > 0.5) is an ALARM — the cell contains green-channel signal that DAPI alone cannot produce. Symmetrically a "Merge" cell classified as `blue-only` (G/B < 0.3) is also an ALARM. The validated thresholds (Wang Ping Fig 2f) are: DAPI G/B ≤ 0.20, Merge G/B 0.5–0.9.

2. **Inaccessible figure regions** — Nature's Extended Data figures sit behind the article paywall; the supplementary CDN does not expose an `ExtFig<N>_HTML.png` endpoint (verified empirically on Wang Ping). If the audit needs ED figures the user must supply article-PDF access.

Record both classes explicitly in `findings/image/_panel-split-and-phash-no-dups.md` (or `_channel-check-<figid>.md` for channel-check results) so the audit's boundary is clear to a reader.

### Check 4 — Local manipulation

Within a single panel, look for:

- band edges that are unnaturally sharp against the background (suggests pasting)
- background gradient that changes abruptly at a band boundary
- a feature that does not match the lane noise around it
- excessive local brightening that erases nearby signal

Record the panel id and the suspected region.

## Recording format — one anomaly per file

`$RUN/findings/image/<short-id>.md`:

```markdown
# Finding: <one-line summary>

- Paper: <DOI or slug>
- Figure(s) / Panel(s): Figure 2A, Figure 5C
- Page(s) in PDF: p. 4, p. 8
- Source artefact: panels/page-018-002.png, panels/page-031-001.png
- Check that fired: cross-figure duplicate after transformation

## What was observed

Figure 2A upper-left region (approx. x=40–240, y=20–100) is pixel-aligned with Figure 5C lower-right region after horizontal flip. Background grain, edge artefact at x=80, and band silhouette all coincide.

## Why this should not happen under independent experiments

The figure captions describe different experimental conditions (Figure 2A: vehicle control, Figure 5C: shRNA-treated). Two independent Western-blot exposures cannot share identical random gel background.

## Transformation

Horizontal flip; possible 5–10% brightness reduction; no scaling.

## Requested raw data

- Original uncropped blot image for both panels (TIFF preferred).
- Metadata: capture date / instrument / exposure time.
- The lab notebook page referencing each panel.

## Level (per 04-evidence-grading.md)

Level <1–4>, see audit_report.md "Findings summary".
```

## Recording absence of findings

If a full pass over all panels turns up nothing, write `$RUN/findings/image/_clean.md`:

```markdown
# Image track — no anomalies after first-pass inspection

- Panels reviewed: <count>
- Checks executed: within-figure dup, cross-figure dup, transformation reuse, local manipulation
- Tools used: visual inspection (and `forensics_tools/*` if any)
- Caveat: no source TIFFs were available; if raw images are produced, re-audit recommended.
```

Absence is a result. Document it.

## What a local paper-writer slug audit gets for free

When the input is a local paper-writer slug, the auditor can cross-check:

- Every figure cited in the paper has a corresponding entry in `output/experiment-suite/<slug>/latest/figures/manifest.json`. A figure in the paper that is **not** in the manifest is a Level 2 finding by itself ("figure has no production trail in the paper-writer run").
- The `manifest.json` stores basenames. If the paper's `\includegraphics{figures/X}` references a basename not in the manifest, flag it.

## Heuristics worth knowing

- Same-author, same-lab papers reuse loading controls frequently. This is not always misconduct (legitimate same-blot re-publication with disclosure), but it must be disclosed in the paper. A finding here is "loading control reused, undisclosed".
- Cosmetic edits (cropping out lane labels, adjusting brightness uniformly) are not findings on their own. The finding is "edit applied selectively to one region" or "edit hides a band".
- A heavily compressed JPEG can look like a manipulation. If pixel artefacts look like JPEG block boundaries rather than splice edges, lower the level to 1 and note the compression hypothesis.

## Anti-patterns

- ✗ "This image looks fishy" without a panel coordinate and a transformation description.
- ✗ Declaring "fabrication" — the auditor records observations, not verdicts.
- ✗ Marking every loading control reuse as Level 4 — most are disclosed or benign; require an actual misuse mechanism before raising the level.
- ✗ Comparing only headline structure (band positions). Always check the background noise too.
