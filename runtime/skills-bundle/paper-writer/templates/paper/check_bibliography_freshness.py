#!/usr/bin/env python3
"""Check bibliography year coverage against an explicit search profile."""

from __future__ import annotations

import argparse
import re
from collections import Counter
from datetime import date
from pathlib import Path


PROFILE_MINIMUMS = {
    "recency-led": 70.0,
    "fast-moving": 60.0,
    "balanced": 40.0,
    "timeline-spanning": 0.0,
}
ENTRY_RE = re.compile(
    r"(?ms)^@(?P<kind>\w+)\s*\{(?P<body>.*?)(?=^@\w+\s*\{|\Z)"
)
YEAR_RE = re.compile(r"\byear\s*=\s*[{\"']?\s*((?:19|20)\d{2})", re.I)


def parse_args() -> argparse.Namespace:
    today = date.today()
    parser = argparse.ArgumentParser()
    parser.add_argument("bibliography", type=Path)
    parser.add_argument("--profile", choices=PROFILE_MINIMUMS, required=True)
    parser.add_argument("--current-year", type=int, default=today.year)
    parser.add_argument("--current-month", type=int, default=today.month)
    parser.add_argument("--start-year", type=int)
    parser.add_argument("--end-year", type=int)
    parser.add_argument("--minimum-percent", type=float)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    text = args.bibliography.read_text(encoding="utf-8")
    entries = [
        match.group("body")
        for match in ENTRY_RE.finditer(text)
        if match.group("kind").lower() not in {"comment", "preamble", "string"}
    ]
    if not entries:
        raise SystemExit("FAIL: bibliography has no BibTeX entries")

    years: list[int] = []
    missing = 0
    for entry in entries:
        match = YEAR_RE.search(entry)
        if match:
            years.append(int(match.group(1)))
        else:
            missing += 1
    if missing:
        raise SystemExit(f"FAIL: {missing}/{len(entries)} entries have no four-digit year")

    future = sorted(year for year in years if year > args.current_year)
    if future:
        raise SystemExit(
            f"FAIL: bibliography contains future publication years: {future[:10]}"
        )

    start = args.start_year
    end = args.end_year
    if args.profile == "recency-led" and (start is None or end is None):
        raise SystemExit(
            "FAIL: recency-led requires --start-year and --end-year from the request"
        )
    if start is None:
        start = args.current_year - 2
    if end is None:
        end = args.current_year
    if start > end:
        raise SystemExit("FAIL: --start-year must not exceed --end-year")

    minimum = (
        args.minimum_percent
        if args.minimum_percent is not None
        else PROFILE_MINIMUMS[args.profile]
    )
    in_window = sum(start <= year <= end for year in years)
    percent = 100.0 * in_window / len(years)
    histogram = " ".join(
        f"{year}:{count}" for year, count in sorted(Counter(years).items())
    )

    print(
        f"profile={args.profile} total={len(years)} "
        f"window={start}-{end} in_window={in_window} "
        f"percent={percent:.1f} minimum={minimum:.1f}"
    )
    print(f"years={histogram}")

    failures: list[str] = []
    if percent + 1e-9 < minimum:
        failures.append(
            f"window share {percent:.1f}% is below required {minimum:.1f}%"
        )

    current_count = sum(year == args.current_year for year in years)
    current_percent = 100.0 * current_count / len(years)
    if (
        args.current_month >= 4
        and args.profile in {"recency-led", "fast-moving"}
        and end == args.current_year
        and current_percent + 1e-9 < 5.0
    ):
        failures.append(
            f"current-year share {current_percent:.1f}% is below required 5.0%"
        )

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1

    print("PASS: bibliography freshness profile satisfied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
