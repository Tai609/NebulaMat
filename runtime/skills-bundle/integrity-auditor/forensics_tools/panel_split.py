"""panel_split.py — split a multi-panel figure PNG into individual panel PNGs.

Strategy: whitespace-gutter detection on grayscale projection. For each row
and column, compute the fraction of near-white pixels. Contiguous runs of
"gutter rows" / "gutter columns" longer than a minimum threshold delimit
panel boundaries. The split is done recursively: first row-strips, then
inside each strip a column-split, then optionally another row-split inside
each cell to handle 2×2 sub-panels.

Usage:
    python panel_split.py <figure.png> <out_dir>

Output:
    <out_dir>/<stem>_panel_<NNN>_y<y0>-<y1>_x<x0>-<x1>.png

When this tool works:
    - Figures with clean white gutters between panels (Nature / Cell / Science
      style figures normally have 12-30 px gutters).
    - Panels with non-white interior (microscopy, blots, dark plot backgrounds).

When it does NOT work and the agent must split panels manually:
    - Panels with very thin (< MIN_GUTTER_PX) gutters; lower MIN_GUTTER_PX
      or split by hand.
    - Figures with no internal whitespace (entirely tiled microscopy mosaics).
    - Panels with white interior (e.g., simple bar charts) — the splitter
      may merge multiple white panels into one block or over-split inside
      a single chart. Inspect output and adjust thresholds.

What this tool CANNOT detect even when panel-splitting works:
    - Within-panel image swaps (e.g., a labelled-DAPI sub-image that is
      actually a Merge image). Detecting that requires per-channel color
      analysis, not panel boundaries.
    - Reuse with rotation / flip / crop. Pair this with feature-based
      matching (out of scope for this script).

Single-purpose pure-Python utility. No LLM SDK. Pillow + NumPy only.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.stderr.write("install Pillow first: pip install Pillow\n")
    sys.exit(2)
try:
    import numpy as np
except ImportError:
    sys.stderr.write("install numpy first: pip install numpy\n")
    sys.exit(2)


def _gutter_runs(mask, min_gutter_px: int):
    runs = []
    n = len(mask)
    i = 0
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            if j - i >= min_gutter_px:
                runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def _split_axis(arr, axis: int, white_thresh: int, gutter_frac: float, min_gutter_px: int, min_panel_px: int):
    if axis == 0:
        white = (arr >= white_thresh).mean(axis=1)
    else:
        white = (arr >= white_thresh).mean(axis=0)
    gutter_mask = white >= gutter_frac
    runs = _gutter_runs(gutter_mask, min_gutter_px)
    if not runs:
        return [(0, arr.shape[axis])]
    blocks = []
    last = 0
    for s, e in runs:
        if s - last >= min_panel_px:
            blocks.append((last, s))
        last = e
    if arr.shape[axis] - last >= min_panel_px:
        blocks.append((last, arr.shape[axis]))
    return blocks if blocks else [(0, arr.shape[axis])]


def split_figure(
    arr,
    *,
    white_thresh: int = 240,
    gutter_frac: float = 0.98,
    min_gutter_px: int = 18,
    min_panel_px: int = 80,
    max_depth: int = 4,
):
    """Return list of (y0, y1, x0, x1) bounding boxes for detected panels."""
    out = []

    def recurse(sub, y_off, x_off, depth):
        if depth >= max_depth:
            out.append((y_off, y_off + sub.shape[0], x_off, x_off + sub.shape[1]))
            return
        row_blocks = _split_axis(sub, 0, white_thresh, gutter_frac, min_gutter_px, min_panel_px)
        for y0, y1 in row_blocks:
            strip = sub[y0:y1, :]
            col_blocks = _split_axis(strip, 1, white_thresh, gutter_frac, min_gutter_px, min_panel_px)
            if len(col_blocks) == 1:
                sub_rows = _split_axis(strip, 0, white_thresh, gutter_frac, min_gutter_px, min_panel_px)
                if len(sub_rows) > 1 and depth + 1 < max_depth:
                    for sy0, sy1 in sub_rows:
                        out.append((y_off + y0 + sy0, y_off + y0 + sy1, x_off, x_off + sub.shape[1]))
                else:
                    out.append((y_off + y0, y_off + y1, x_off, x_off + sub.shape[1]))
            else:
                for x0, x1 in col_blocks:
                    cell = strip[:, x0:x1]
                    if depth + 1 < max_depth:
                        recurse(cell, y_off + y0, x_off + x0, depth + 1)
                    else:
                        out.append((y_off + y0, y_off + y1, x_off + x0, x_off + x1))

    recurse(arr, 0, 0, 0)
    # dedupe
    return list(dict.fromkeys(out))


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("input", help="figure image (PNG / JPG)")
    parser.add_argument("out_dir", help="output directory for panel PNGs")
    parser.add_argument("--white-thresh", type=int, default=240)
    parser.add_argument("--gutter-frac", type=float, default=0.98)
    parser.add_argument("--min-gutter-px", type=int, default=18)
    parser.add_argument("--min-panel-px", type=int, default=80)
    parser.add_argument("--max-depth", type=int, default=4)
    args = parser.parse_args()

    img = Image.open(args.input).convert("RGB")
    arr = np.array(img.convert("L"))
    bboxes = split_figure(
        arr,
        white_thresh=args.white_thresh,
        gutter_frac=args.gutter_frac,
        min_gutter_px=args.min_gutter_px,
        min_panel_px=args.min_panel_px,
        max_depth=args.max_depth,
    )
    print(f"{args.input}: image {img.size}, found {len(bboxes)} panels")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(args.input).stem
    for i, (y0, y1, x0, x1) in enumerate(bboxes):
        panel = img.crop((x0, y0, x1, y1))
        if panel.size[0] < args.min_panel_px or panel.size[1] < args.min_panel_px:
            continue
        out = out_dir / f"{stem}_panel_{i:03d}_y{y0}-{y1}_x{x0}-{x1}.png"
        panel.save(out)
        print(f"  -> {out.name}  ({panel.size[0]}x{panel.size[1]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
