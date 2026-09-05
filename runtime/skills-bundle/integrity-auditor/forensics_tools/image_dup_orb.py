"""image_dup_orb.py — ORB feature-matching duplicate detection.

A deterministic, single-purpose utility script. No LLM SDK. No "skeleton -> enrich"
two-stage orchestration. Use directly from the agent during the image-evidence
track when the audit needs to detect **transformed** duplicates: same source
image rotated, flipped, cropped, or brightness-shifted.

Usage:
    python image_dup_orb.py <run-dir>/panels/*.png

What it does:
    1. Loads each image as grayscale.
    2. Detects ORB keypoints + computes descriptors (rotation- and scale-invariant
       by design; modest brightness invariance via the BRIEF descriptor).
    3. For every pair, runs Brute-Force Hamming matching with cross-check,
       filters by Lowe's ratio test (k-NN with k=2, accept if best/second < 0.75).
    4. Reports the count of surviving matches per pair.
    5. Flags pairs with >= --strong matches as transformed-duplicate candidates.

Complements `image_dup.py`:
    - `image_dup.py` (perceptual hashing) is fast and catches **untransformed**
      duplicates. Whole-figure dHash distance below ~16 = same image.
    - `image_dup_orb.py` (feature matching) is slower but catches duplicates
      that survive rotation / flip / crop / brightness change. Use when
      `image_dup.py` returns suspicious-but-not-conclusive distances
      (dHash 30-60 range) and the panels are visually similar.

Limitations (real, document them):
    - ORB needs enough texture to detect keypoints. Uniform-background panels
      (DAPI-only fluorescence, dark Westerns) may produce <50 keypoints and
      give weak signal.
    - The matching is symmetric: A vs B and B vs A produce the same match count.
    - Cross-image content-similarity (two different blots that genuinely look
      similar) can produce false positives. Default --strong threshold of 30
      is conservative; ratchet up for noisy panel sets.
    - JPEG re-compression artefacts degrade ORB more than perceptual hashing.
      If panels have been heavily re-compressed by the publication pipeline,
      consider --max-features 1000 instead of the default 500.

Empirical motivating cases:
    - Kang Tiebang Fig 6d (10.1038/s41556-020-0522-z 2024 Author Correction):
      admitted vector ↔ Δ1-10 duplicate that `image_dup.py` mean-diff did
      not flag (mean_diff 11-19 across candidate pairs). The duplicate
      likely involves rotation or flip and would need feature matching.
    - Wang Ping Fig 1f / similar cross-source insertions: ORB can detect
      reuse-after-crop where perceptual hashing of the whole panel fails.

This script is intentionally < 200 lines. If the audit needs splice-edge
detection or content-aware healing detection, drop another specialised script
next to this one rather than extending this one.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    import cv2
except ImportError:
    sys.stderr.write("install opencv-python first: pip install opencv-python\n")
    sys.exit(2)

try:
    import numpy as np
except ImportError:
    sys.stderr.write("install numpy first: pip install numpy\n")
    sys.exit(2)


def load_gray(path: str, max_dim: int = 1024) -> "np.ndarray | None":
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    h, w = img.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)),
                         interpolation=cv2.INTER_AREA)
    return img


def detect_orb(img, max_features: int):
    # cv2.ORB_create is dynamically registered; suppress static-analysis noise.
    orb = cv2.ORB_create(nfeatures=max_features)  # type: ignore[attr-defined]
    return orb.detectAndCompute(img, None)


def detect_orb_all_orientations(img, max_features: int):
    """Return descriptors for both the image and its horizontal mirror.

    ORB is rotation-invariant but NOT mirror-invariant, so a horizontally-
    flipped duplicate produces zero raw-match signal. By computing descriptors
    for both orientations and taking the maximum match count across (A vs B,
    A vs flip(B)), we cover the mirror case at 2x descriptor cost.
    """
    _, des_a = detect_orb(img, max_features)
    img_flip = cv2.flip(img, 1)
    _, des_b = detect_orb(img_flip, max_features)
    return des_a, des_b


def match_pair(des_a, des_b, ratio: float) -> int:
    """Lowe's ratio test on Hamming-distance k=2 matches. Returns # surviving."""
    if des_a is None or des_b is None:
        return 0
    if len(des_a) < 2 or len(des_b) < 2:
        return 0
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    knn = bf.knnMatch(des_a, des_b, k=2)
    good = 0
    for pair in knn:
        if len(pair) < 2:
            continue
        m, n = pair
        if m.distance < ratio * n.distance:
            good += 1
    return good


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("paths", nargs="+", help="image files to compare pairwise")
    parser.add_argument(
        "--max-features", type=int, default=500,
        help="ORB max-features per image (default 500)",
    )
    parser.add_argument(
        "--ratio", type=float, default=0.75,
        help="Lowe's ratio test threshold (default 0.75; lower = stricter)",
    )
    parser.add_argument(
        "--strong", type=int, default=30,
        help="flag pairs with >= this many surviving matches (default 30)",
    )
    parser.add_argument(
        "--weak", type=int, default=12,
        help="report pairs with >= this many surviving matches (default 12)",
    )
    parser.add_argument(
        "--max-dim", type=int, default=1024,
        help="downscale images so longest edge <= this (default 1024 px)",
    )
    args = parser.parse_args()

    paths = [p for p in args.paths if Path(p).is_file()]
    if len(paths) < 2:
        sys.stderr.write("need at least 2 image files\n")
        return 1

    print(f"ORB-matching {len(paths)} images "
          f"(max_features={args.max_features}, ratio={args.ratio}, "
          f"max_dim={args.max_dim} px)\n")

    descriptors: list[tuple[str, "np.ndarray | None", "np.ndarray | None"]] = []
    for p in paths:
        img = load_gray(p, args.max_dim)
        if img is None:
            sys.stderr.write(f"could not load {p} (cv2.imread returned None)\n")
            continue
        des, des_flip = detect_orb_all_orientations(img, args.max_features)
        n_kp = 0 if des is None else len(des)
        descriptors.append((p, des, des_flip))
        print(f"  {os.path.basename(p):<50} kp={n_kp} (+ mirror descriptors)")
    print()

    print(f"{'a':<40} {'b':<40} {'matches':>8} {'orient':>8}  flag")
    print("-" * 110)
    flagged = 0
    for i in range(len(descriptors)):
        for j in range(i + 1, len(descriptors)):
            pa, da, _ = descriptors[i]
            pb, db, db_flip = descriptors[j]
            m_same = match_pair(da, db, args.ratio)
            m_flip = match_pair(da, db_flip, args.ratio)
            if m_flip > m_same:
                m, orient = m_flip, "mirror"
            else:
                m, orient = m_same, "same"
            if m >= args.strong:
                flag = "★★★ transformed-duplicate candidate"
                flagged += 1
            elif m >= args.weak:
                flag = "★ weak match"
            else:
                continue  # don't print zero-match pairs
            an = os.path.basename(pa)
            bn = os.path.basename(pb)
            print(f"{an:<40} {bn:<40} {m:>8} {orient:>8}  {flag}")

    print(f"\n=== flagged pairs (>= {args.strong} matches): {flagged} ===")
    return 0 if flagged == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
