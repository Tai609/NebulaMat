#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# ///
"""CP2K preflight: conservative checks for one input file.

Usage: check_inputs.py input.inp
       check_inputs.py RUNDIR   # if exactly one *.inp exists

Exit code 0 = pass (warnings allowed), 1 = hard failure.
"""
import glob
import os
import re
import sys


def input_path(arg):
    if os.path.isdir(arg):
        files = sorted(glob.glob(os.path.join(arg, "*.inp")))
        if len(files) == 1:
            return files[0]
        print(f"FAIL: expected exactly one *.inp in {arg}, found {len(files)}")
        sys.exit(1)
    return arg


def strip_comment(line):
    for mark in ("!", "#"):
        if mark in line:
            line = line.split(mark, 1)[0]
    return line.strip()


def parse(path):
    sections = set()
    keywords = {}
    kinds = []
    includes = []
    stack = []
    current_kind = None
    coord_lines = 0

    for raw in open(path, errors="ignore"):
        line = strip_comment(raw)
        if not line:
            continue
        up = line.upper()
        if up.startswith("@INCLUDE"):
            includes.append(line)
            continue
        if up.startswith("&END"):
            if stack and stack[-1] == "KIND":
                current_kind = None
            if stack:
                stack.pop()
            continue
        if line.startswith("&"):
            parts = line[1:].split()
            if not parts:
                continue
            name = parts[0].upper()
            stack.append(name)
            sections.add("/".join(stack))
            if name == "KIND":
                current_kind = {"name": parts[1] if len(parts) > 1 else "UNKNOWN", "keys": set()}
                kinds.append(current_kind)
            continue

        key = line.split()[0].upper()
        path_key = "/".join(stack + [key])
        keywords.setdefault(path_key, []).append(line)
        if current_kind is not None:
            current_kind["keys"].add(key)
        if stack and stack[-1] == "COORD":
            coord_lines += 1

    return sections, keywords, kinds, coord_lines, includes


def has_section(sections, suffix):
    return any(s.endswith(suffix) for s in sections)


def has_key(keywords, suffix):
    return any(k.endswith(suffix) for k in keywords)


def values_for(keywords, suffix):
    vals = []
    for k, lines in keywords.items():
        if k.endswith(suffix):
            vals.extend(lines)
    return vals


def main():
    if len(sys.argv) != 2:
        print(__doc__.strip())
        sys.exit(1)
    path = input_path(sys.argv[1])
    if not os.path.isfile(path):
        print(f"FAIL: input not found: {path}")
        sys.exit(1)

    sections, keywords, kinds, coord_lines, includes = parse(path)
    errors, warnings = [], []

    if includes:
        warnings.append("@INCLUDE lines are not expanded by this checker; verify included files manually")

    if not has_section(sections, "GLOBAL"):
        errors.append("&GLOBAL missing")
    if not has_key(keywords, "GLOBAL/RUN_TYPE"):
        errors.append("GLOBAL/RUN_TYPE missing")
    run_type = " ".join(values_for(keywords, "GLOBAL/RUN_TYPE")).upper()

    if not has_section(sections, "FORCE_EVAL"):
        errors.append("&FORCE_EVAL missing")
    if not has_key(keywords, "FORCE_EVAL/METHOD"):
        errors.append("FORCE_EVAL/METHOD missing")
    method = " ".join(values_for(keywords, "FORCE_EVAL/METHOD")).upper()
    quickstep = "QUICKSTEP" in method or re.search(r"\bQS\b", method) or has_section(sections, "FORCE_EVAL/DFT")

    if not has_section(sections, "FORCE_EVAL/SUBSYS"):
        errors.append("&FORCE_EVAL/&SUBSYS missing")
    if not has_section(sections, "FORCE_EVAL/SUBSYS/CELL"):
        errors.append("&SUBSYS/&CELL missing")
    if coord_lines == 0 and not has_key(keywords, "COORD_FILE_NAME"):
        errors.append("no coordinates found (&COORD or COORD_FILE_NAME)")
    if not kinds:
        warnings.append("no &KIND sections found")

    if quickstep:
        if not has_section(sections, "FORCE_EVAL/DFT"):
            errors.append("Quickstep method without &DFT section")
        for suffix in ("DFT/BASIS_SET_FILE_NAME", "DFT/POTENTIAL_FILE_NAME"):
            if not has_key(keywords, suffix):
                errors.append(f"{suffix} missing")
        if not has_section(sections, "FORCE_EVAL/DFT/MGRID"):
            errors.append("&DFT/&MGRID missing")
        else:
            for suffix in ("MGRID/CUTOFF", "MGRID/REL_CUTOFF"):
                if not has_key(keywords, suffix):
                    errors.append(f"{suffix} missing")
        if not has_section(sections, "FORCE_EVAL/DFT/SCF"):
            warnings.append("&DFT/&SCF missing; CP2K defaults may be unintended")
        for kind in kinds:
            if "BASIS_SET" not in kind["keys"]:
                errors.append(f"&KIND {kind['name']} missing BASIS_SET")
            if "POTENTIAL" not in kind["keys"]:
                errors.append(f"&KIND {kind['name']} missing POTENTIAL")

    if "CELL_OPT" in run_type and not has_key(keywords, "FORCE_EVAL/STRESS_TENSOR"):
        warnings.append("CELL_OPT without FORCE_EVAL/STRESS_TENSOR; verify stress handling")

    if "MD" in run_type:
        if not has_section(sections, "MOTION/MD"):
            errors.append("RUN_TYPE MD without &MOTION/&MD")
        for suffix in ("MD/TIMESTEP",):
            if not has_key(keywords, suffix):
                warnings.append(f"{suffix} missing; CP2K default may be unintended")
        if not has_key(keywords, "MD/STEPS") and not has_key(keywords, "MD/MAX_STEPS"):
            warnings.append("MD length not explicit (STEPS or MAX_STEPS)")

    if has_section(sections, "FORCE_EVAL/DFT/KPOINTS"):
        if has_section(sections, "FORCE_EVAL/DFT/SCF/OT"):
            warnings.append("KPOINTS with OT detected; verify support for this CP2K version/task")
        schemes = " ".join(values_for(keywords, "KPOINTS/SCHEME")).upper()
        if "GAMMA" in schemes or re.search(r"MONKHORST-PACK\s+1\s+1\s+1", schemes):
            warnings.append("Gamma-only k-point section detected; omitting &KPOINTS may be faster")

    cell_periodic = " ".join(values_for(keywords, "CELL/PERIODIC")).upper()
    poisson_periodic = " ".join(values_for(keywords, "POISSON/PERIODIC")).upper()
    if "NONE" in cell_periodic and quickstep and "NONE" not in poisson_periodic:
        warnings.append("CELL PERIODIC NONE but no matching DFT/POISSON PERIODIC NONE")

    if has_section(sections, "DFT_PLUS_U") and not has_key(keywords, "DFT/PLUS_U_METHOD"):
        warnings.append("DFT+U present; PLUS_U_METHOD default is used unless set explicitly")

    for w in warnings:
        print(f"WARN: {w}")
    for e in errors:
        print(f"FAIL: {e}")
    if errors:
        sys.exit(1)
    print(f"preflight passed: {os.path.abspath(path)} ({len(kinds)} KIND blocks)")


if __name__ == "__main__":
    main()
