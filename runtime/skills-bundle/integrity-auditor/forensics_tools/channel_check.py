"""channel_check.py — RGB channel-content classifier for fluorescence micrographs.

Use this to detect the class of within-panel mis-labelings where a sub-image
shown as "DAPI" (a nuclear stain that fluoresces in the blue channel only) is
actually a "Merge" (DAPI + Flag-tagged protein in the green channel). Cross-panel
perceptual-hash duplicate detection cannot catch this kind of error because each
sub-image is correctly drawn — only its label is wrong.

The tool reads each image, computes mean R / G / B over the "signal" pixels
(excluding near-white background and near-black border), and classifies the
sub-image as one of:

    blue-only          — DAPI-like (B dominant; G low)
    green-only         — Flag / GFP / phalloidin-like (G dominant; B low)
    blue+green         — Merge of DAPI + green channel
    other              — mixed / red-channel-present / unclassifiable

Usage:
    python channel_check.py <sub_image_1.png> <sub_image_2.png> ...

Output:
    one row per image: filename, n_signal_pixels, mean R, mean G, mean B,
    G/B ratio, B/G ratio, classification.

Suggested workflow:
    1. Use panel_split.py to extract panel-level PNGs.
    2. For panels that are themselves grids of sub-images (e.g., a Western
       blot grid, or an IF panel with rows of conditions and columns of
       channels), sub-split them — either with panel_split.py at smaller
       thresholds, or by manual offsets — into per-channel sub-images.
    3. Run channel_check.py against the sub-images. Compare the classification
       against the figure's stated channel labels (e.g., "DAPI" column should
       all be blue-only; "Merge" column should all be blue+green). Discrepancies
       are candidate within-panel mis-labelings.

Threshold defaults assume 8-bit per channel. They are tuned to fluorescence
micrographs with mostly black backgrounds and bright stained regions. For
brightfield / colorimetric images use --signal-min lower and re-classify.

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


def analyze(
    path: str,
    *,
    background_max: int = 235,   # pixels with all channels >= this = white background; skip
    signal_min: int = 25,         # pixels with all channels <= this = black border; skip
    pure_thresh: float = 0.30,    # G/B < this (or B/G < this) = single-channel-only
    mixed_thresh: float = 0.50,   # G/B > this AND B/G > this = both channels co-present
) -> dict:
    img = Image.open(path).convert("RGB")
    arr = np.array(img, dtype=np.int32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]

    near_white = (r >= background_max) & (g >= background_max) & (b >= background_max)
    near_black = (r <= signal_min) & (g <= signal_min) & (b <= signal_min)
    signal = ~near_white & ~near_black

    n_signal = int(signal.sum())
    if n_signal < 200:
        return {"path": path, "n_signal": n_signal, "classification": "too-few-signal-pixels"}

    rm, gm, bm = float(r[signal].mean()), float(g[signal].mean()), float(b[signal].mean())
    gb = gm / bm if bm > 0 else float("inf")
    bg = bm / gm if gm > 0 else float("inf")
    rg = rm / max(gm, 1.0)
    rb = rm / max(bm, 1.0)

    # Direct G/B threshold classification.
    # The G/B ratio is the headline metric: it cleanly separates DAPI columns
    # (B-dominant, G suppressed) from Merge columns (B and G both present).
    if rg > 1.2 or rb > 1.2:
        cls = "other"  # red-heavy; out of DAPI/Flag/Merge scope
    elif bm > gm and gb < pure_thresh:
        cls = "blue-only"            # DAPI-like
    elif gm > bm and bg < pure_thresh:
        cls = "green-only"           # Flag / GFP-like
    elif gb >= mixed_thresh and bg >= mixed_thresh:
        cls = "blue+green"           # Merge-like (both channels co-present)
    else:
        cls = "ambiguous-mix"        # one channel weakly dominant; not confidently classified

    return {
        "path": path,
        "n_signal": n_signal,
        "R": round(rm, 1),
        "G": round(gm, 1),
        "B": round(bm, 1),
        "G/B": round(gb, 3),
        "B/G": round(bg, 3),
        "classification": cls,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("paths", nargs="+", help="sub-image PNG / JPG files")
    parser.add_argument("--background-max", type=int, default=235)
    parser.add_argument("--signal-min", type=int, default=25)
    parser.add_argument("--pure-thresh", type=float, default=0.30,
                        help="G/B (or B/G) below this = single-channel-only")
    parser.add_argument("--mixed-thresh", type=float, default=0.50,
                        help="G/B AND B/G above this = both channels co-present")
    args = parser.parse_args()

    paths = [p for p in args.paths if Path(p).is_file()]
    if not paths:
        sys.stderr.write("no input files\n")
        return 1

    print(f"{'image':<60} {'n_sig':>8} {'R':>5} {'G':>5} {'B':>5} {'G/B':>6} {'class':<22}")
    print("-" * 120)
    for p in paths:
        r = analyze(
            p,
            background_max=args.background_max,
            signal_min=args.signal_min,
            pure_thresh=args.pure_thresh,
            mixed_thresh=args.mixed_thresh,
        )
        if r.get("classification") == "too-few-signal-pixels":
            print(f"{Path(p).name:<60} {r['n_signal']:>8} {'-':>5} {'-':>5} {'-':>5} {'-':>6} {'too-few-signal':<22}")
        else:
            print(
                f"{Path(p).name:<60} {r['n_signal']:>8} {r['R']:>5} {r['G']:>5} {r['B']:>5} {r['G/B']:>6} {r['classification']:<22}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
