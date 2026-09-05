#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["ovito"]
# ///
"""Run a small OVITO analysis pipeline and write per-frame JSON summaries.

Run with `uv run ovito_analyze.py ...` so the dependency above resolves into an
isolated, cached environment (no global install needed).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def parse_frames(spec: str | None, default_count: int) -> list[int]:
    if not spec:
        return [0]
    if ":" in spec:
        parts = [int(p) if p else None for p in spec.split(":")]
        while len(parts) < 3:
            parts.append(None)
        start = 0 if parts[0] is None else parts[0]
        stop = default_count if parts[1] is None else parts[1]
        step = 1 if parts[2] is None else parts[2]
        return list(range(start, stop, step))
    return [int(x) for x in spec.split(",") if x.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Structure or trajectory file")
    parser.add_argument("output", help="JSON output path")
    parser.add_argument("--modifier", choices=["none", "cna", "ptm", "coordination"], default="none")
    parser.add_argument("--cutoff", type=float, default=3.5, help="Coordination cutoff in input length units")
    parser.add_argument("--bins", type=int, default=200, help="RDF bins for coordination analysis")
    parser.add_argument("--frames", help="Frame list like 0,10,20 or slice start:stop:step")
    args = parser.parse_args()

    try:
        import ovito
        from ovito.io import import_file
        from ovito.modifiers import (
            CommonNeighborAnalysisModifier,
            CoordinationAnalysisModifier,
            PolyhedralTemplateMatchingModifier,
        )
    except Exception as exc:
        print(f"failed to import OVITO Python module: {exc}", file=sys.stderr)
        print("run via `uv run ovito_analyze.py ...`, install it in this interpreter, or use ovitos", file=sys.stderr)
        return 2

    input_path = Path(args.input).resolve()
    if not input_path.is_file():
        print(f"input file not found: {input_path}", file=sys.stderr)
        return 2

    pipeline = import_file(str(input_path), multiple_frames=True)
    if args.modifier == "cna":
        pipeline.modifiers.append(CommonNeighborAnalysisModifier())
    elif args.modifier == "ptm":
        pipeline.modifiers.append(PolyhedralTemplateMatchingModifier())
    elif args.modifier == "coordination":
        pipeline.modifiers.append(CoordinationAnalysisModifier(cutoff=args.cutoff, number_of_bins=args.bins))

    frame_count = getattr(pipeline.source, "num_frames", 1)
    frames = parse_frames(args.frames, frame_count)
    rows = []
    for frame in frames:
        if frame < 0 or frame >= frame_count:
            print(f"frame out of range: {frame} (num_frames={frame_count})", file=sys.stderr)
            return 2
        data = pipeline.compute(frame)
        attrs = {
            key: value
            for key, value in data.attributes.items()
            if isinstance(value, (str, int, float, bool))
        }
        rows.append(
            {
                "frame": frame,
                "particles": int(data.particles.count) if data.particles is not None else 0,
                "attributes": attrs,
            }
        )

    payload = {
        "ovito_version": getattr(ovito, "version_string", "unknown"),
        "input": str(input_path),
        "modifier": args.modifier,
        "cutoff": args.cutoff if args.modifier == "coordination" else None,
        "frames": rows,
    }
    Path(args.output).write_text(json.dumps(payload, indent=2, sort_keys=True))
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
