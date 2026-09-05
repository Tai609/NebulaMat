"""image_dup.py — perceptual-hash image duplicate detection.

A deterministic, single-purpose utility script. No LLM SDK. No "skeleton -> enrich"
two-stage orchestration. Use directly from the agent during the image-evidence
track when the audit needs pixel-level pairwise comparison.

Usage:
    python image_dup.py <run-dir>/figures_hires/*.png [<run-dir>/panels/*.png ...]

What it does:
    1. Loads each image, computes a difference hash (dHash) and an average hash (aHash)
       at 16x16 (= 256-bit) resolution.
    2. Reports pairwise Hamming distances between every image pair.
    3. Flags pairs with dHash distance < 16 as "★★★ strong duplicate candidate"
       and < 32 as "★ similar".

Limitations (real, document them):
    - Whole-figure hashing rarely catches panel reuse — different figures will be
      dissimilar at the figure level even when they share one reused panel.
      For panel-level dup detection, split each figure into panels first
      (whitespace-gutter detection or manual annotation), then re-run image_dup
      against the per-panel directory.
    - Western-blot band-level reuse is below the resolution of a 16x16 hash;
      use higher resolution (64x64) or template matching for that case.
    - JPEG re-compression artefacts can suppress dHash matches; if PDF figures
      went through JPEG re-compression in the publication pipeline, originals
      may dHash differently from the published PDF versions.

This script is intentionally < 100 lines. If a particular paper needs deeper
forensics (SIFT/ORB feature matching, affine-aware alignment, splice-edge
detection), drop a more specialized script next to this one rather than
extending this one.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.stderr.write("install Pillow first: pip install Pillow\n")
    sys.exit(2)

# Pillow >= 10 prefers Image.Resampling.LANCZOS; older versions expose Image.LANCZOS.
_LANCZOS = getattr(getattr(Image, "Resampling", None), "LANCZOS", None) or getattr(Image, "LANCZOS", 1)


def dhash(path: str, size: int = 16) -> int:
    img = Image.open(path).convert("L").resize((size + 1, size), _LANCZOS)
    px = list(img.getdata())  # type: ignore[arg-type]
    bits = 0
    for row_i in range(size):
        row_start = row_i * (size + 1)
        row = px[row_start : row_start + size + 1]
        for col_i in range(size):
            bits = (bits << 1) | (1 if row[col_i] > row[col_i + 1] else 0)
    return bits


def ahash(path: str, size: int = 16) -> int:
    img = Image.open(path).convert("L").resize((size, size), _LANCZOS)
    px = list(img.getdata())  # type: ignore[arg-type]
    avg = sum(px) / len(px)
    bits = 0
    for v in px:
        bits = (bits << 1) | (1 if v >= avg else 0)
    return bits


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("paths", nargs="+", help="image files to compare pairwise")
    parser.add_argument(
        "--strong",
        type=int,
        default=16,
        help="dHash hamming distance below this = strong duplicate candidate",
    )
    parser.add_argument(
        "--similar",
        type=int,
        default=32,
        help="dHash hamming distance below this = similar",
    )
    args = parser.parse_args()

    paths = [p for p in args.paths if Path(p).is_file()]
    if len(paths) < 2:
        sys.stderr.write("need at least 2 image files\n")
        return 1

    print(f"hashing {len(paths)} images (16x16 dHash, 16x16 aHash)\n")
    hashes = [(p, dhash(p), ahash(p)) for p in paths]

    print(f"{'a':<40} {'b':<40} {'dHash':>6} {'aHash':>6}  flag")
    print("-" * 110)
    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            d = hamming(hashes[i][1], hashes[j][1])
            a = hamming(hashes[i][2], hashes[j][2])
            if d < args.strong:
                flag = "★★★ strong duplicate"
            elif d < args.similar:
                flag = "★ similar"
            else:
                flag = ""
            an = os.path.basename(hashes[i][0])
            bn = os.path.basename(hashes[j][0])
            print(f"{an:<40} {bn:<40} {d:>6} {a:>6}  {flag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
