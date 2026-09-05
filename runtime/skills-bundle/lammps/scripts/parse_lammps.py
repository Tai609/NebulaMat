#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# ///
"""Summarize a LAMMPS log file (stdlib only).

Usage: parse_lammps.py [log.lammps]

Reports: run segments completed, last thermo state, errors/lost atoms,
and total-energy drift across each segment (NVE stability indicator).
Exit code: 0 clean, 1 finished-with-issues, 2 error/incomplete.
"""
import sys


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "log.lammps"
    lines = open(path, errors="ignore").read().splitlines()
    issues, segments = [], []
    header, rows = None, []
    in_run = False

    for ln in lines:
        if ln.startswith("ERROR"):
            issues.append(ln.strip())
        if "Lost atoms" in ln:
            issues.append(ln.strip())
        toks = ln.split()
        if toks and toks[0] == "Step":
            header, rows, in_run = toks, [], True
            continue
        if in_run:
            if toks and toks[0] == "Loop":
                segments.append((header, rows, True))
                in_run = False
            else:
                try:
                    rows.append([float(t) for t in toks])
                except ValueError:
                    if rows:  # thermo block ended without 'Loop' = interrupted
                        segments.append((header, rows, False))
                    in_run = False

    if in_run and rows:
        segments.append((header, rows, False))

    if not segments:
        print("no thermo output found - run did not start or log is elsewhere")
        sys.exit(2)

    print(f"run segments: {len(segments)} "
          f"({sum(1 for *_, done in segments if done)} completed)")
    for i, (hdr, rows, done) in enumerate(segments):
        if not rows:
            continue
        first, last = rows[0], rows[-1]
        cols = {name: j for j, name in enumerate(hdr)}
        msg = f"  segment {i}: steps {int(first[0])} -> {int(last[0])}" \
              + ("" if done else "  [INTERRUPTED]")
        if "Temp" in cols:
            msg += f", T={last[cols['Temp']]:.1f}"
        if "Press" in cols:
            msg += f", P={last[cols['Press']]:.1f}"
        print(msg)
        if "TotEng" in cols and len(rows) > 1:
            e0, e1 = first[cols["TotEng"]], last[cols["TotEng"]]
            drift = abs(e1 - e0) / max(abs(e0), 1e-12)
            print(f"    TotEng drift: {e1 - e0:+.4g} ({drift:.2e} relative)")
        if not done:
            issues.append(f"segment {i} interrupted (no 'Loop time' footer)")

    for i in issues:
        print(f"ISSUE: {i}")
    if any(s.startswith("ERROR") or "Lost atoms" in s for s in issues):
        sys.exit(2)
    sys.exit(1 if issues else 0)


if __name__ == "__main__":
    main()
