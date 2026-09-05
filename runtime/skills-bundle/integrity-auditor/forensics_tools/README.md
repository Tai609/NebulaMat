# forensics_tools/

Deterministic, single-purpose utility scripts used by the integrity-auditor skill.

| Script | Purpose | Deps |
|---|---|---|
| `image_dup.py` | Pairwise perceptual-hash (dHash + aHash) on figure / panel PNGs — untransformed dups | Pillow |
| `image_dup_orb.py` | ORB feature-matching dup detector — catches rotated / flipped / cropped / brightness-shifted dups that perceptual hashing misses | Pillow, OpenCV (cv2) |
| `panel_split.py` | Split a multi-panel figure PNG into individual panel PNGs via whitespace-gutter detection | Pillow, NumPy |
| `channel_check.py` | RGB channel-content classifier for fluorescence sub-images (DAPI / Flag / Merge / other) | Pillow, NumPy |
| `decimal_match.py` | Cross-cell last-N-decimal matching sweeper on source-data XLSX — catches the "many cells share trailing decimals" fabrication pattern (Kang Tiebang whistleblower class) | openpyxl |
| `magnitude_consistency.py` | Supplement-text vs source-data XLSX unit/scale consistency — catches unit-confusion (TWh vs GWh, mM vs µM, Hz vs MHz, etc.) and order-of-magnitude transcription errors. Generic SI-prefix-aware unit taxonomy covers energy / power / mass / length / area / volume / time / voltage / current / frequency / pressure / concentration / amount / force / dose / bp / CO2 / currency. Cross-family pairs rejected. Pair with `bilingual_cn_geography.json`. | openpyxl |
| `xlsx_aggregate_consistency.py` | Cross-XLSX same-quantity sum/row consistency — catches when two source-data tables report the same aggregate quantity but disagree by a small systematic margin. Reuses `magnitude_consistency.py`'s unit taxonomy. | openpyxl |

Typical pipeline (use both together):

```bash
# Split each main-figure PNG into panels first.
for f in $RUN/figures_hires/fig*.png; do
    python forensics_tools/panel_split.py "$f" "$RUN/panels/"
done

# Then run cross-panel duplicate detection.
python forensics_tools/image_dup.py "$RUN"/panels/*.png > "$RUN/findings/image/dhash_pairs.txt"
```

For within-panel sub-image swaps (e.g., a panel showing rows of conditions × columns of fluorescence channels, where one cell is mis-labelled), pair `panel_split.py` with `channel_check.py`:

```bash
# 1. Split figure into panels.
python forensics_tools/panel_split.py "$RUN/figures_hires/fig2.png" "$RUN/panels/"
# 2. Sub-split a multi-cell panel into individual Flag / DAPI / Merge cells.
python forensics_tools/panel_split.py "$RUN/panels/fig2_panel_006_...png" \
    "$RUN/sub_cells/fig2f_minusVal/" --min-gutter-px 6 --min-panel-px 50
# 3. Classify each sub-cell by RGB channel content.
python forensics_tools/channel_check.py "$RUN/sub_cells/fig2f_minusVal/"*.png \
    > "$RUN/findings/image/fig2f_channel_check.txt"
# Look for mismatches: a cell expected to be "DAPI" classified as blue+green, or vice versa.
```

Empirical: on the Wang Ping 2025 Nature audit, 5 main figures split into 56 panels at the default thresholds (panels ranging 175 px × 257 px to 1021 px × 500 px). Whole-figure dHash min was 91 across the 5 figures (no useful signal); after panel split the min cross-panel dHash dropped to 55 — still no admitted-issue dups, but only because (a) the admitted Fig 2f issue is a within-panel label swap, not a cross-panel duplicate, and (b) Extended Data figures sit behind the article paywall. Both limitations are explicitly recorded as audit boundaries.

## Design rules (matches the skill's anti-pattern policy)

1. **No LLM SDK** — never `import anthropic` / `import openai` here.
2. **No "skeleton → enrich" orchestration** — these are pure utilities, the agent drives the workflow.
3. **One file, one purpose** — split into separate scripts rather than growing one big one.
4. **Output to stdout** — agent captures with `python image_dup.py … > $RUN/findings/image/dhash_pairs.txt`.

## When the agent uses these

From `references/01-image-evidence.md` Check 1/2/3, when the audit needs pixel-level pairwise comparison across figures / panels. Typical invocation from inside a run directory:

```bash
python /path/to/integrity-auditor/forensics_tools/image_dup.py \
    figures_hires/*.png panels_correction/*.png \
    > findings/image/dhash_pairs.txt
```

## Adding more tools

For SIFT/ORB feature matching, panel-segmentation by whitespace detection, splice-edge detection, or any other deterministic image-forensic operation: drop a new script in this directory with a one-purpose, < 200-line implementation. Don't extend `image_dup.py` to do everything.

For numerical forensics (GRIM, deterministic-column-pair sweep, last-digit sweep), the recipes live inside `references/02-numerical-evidence.md` rather than as standalone scripts here, because they apply to in-memory data and are short enough to inline. Promote to a standalone script if and when a future audit needs to share the same recipe across multiple sheets in a complex way.
