#!/usr/bin/env python3
"""Academic Figure Skill Reference Integrity Checker.

Validates:
  1. directory-map.md ↔ assets/figures/ bidirectional coverage
  2. compose.py PANEL_ASPECT covers all figure types in directory-map
  3. SKILL.md references only existing files
  4. Every assets/figures/<type>/ has at least one script + one preview PNG

Usage:
    py check_references.py          # full integrity scan
    py check_references.py --json   # machine-readable output
"""

from __future__ import annotations
import json, os, re, sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
SKILL_DIR = PROJECT / "academic-figure-skill"
SKILL_MD = SKILL_DIR / "SKILL.md"
DIRMAP_MD = SKILL_DIR / "references" / "directory-map.md"
COMPOSE_PY = SKILL_DIR / "scripts" / "compose.py"
FIGURES_DIR = SKILL_DIR / "assets" / "figures"
REFERENCES = SKILL_DIR / "references"


def parse_directory_map() -> dict[str, str]:
    """Parse directory-map.md → {directory_name: description_line}.

    Only returns entries that correspond to actual asset directories.
    Skips cross-type-only entries (marked "via cross-type from").
    """
    text = DIRMAP_MD.read_text(encoding="utf-8")
    mapping = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        parts = [p.strip() for p in stripped.split("|")]
        if len(parts) < 3:
            continue
        # Skip cross-type-only entries — they reference another directory's scripts
        if "via cross-type" in parts[1].lower() or "via cross-type" in parts[2].lower():
            continue
        # First column: **DirName** possibly with "(via <path>)"
        dir_col = parts[1].strip("*").strip()
        # Extract directory name — "volcano (via volcano/)" → "volcano"
        dir_match = re.match(r"(\w[\w-]*)", dir_col)
        if not dir_match:
            continue
        dirname = dir_match.group(1)
        # Skip non-directory rows
        if dirname.lower() in ("directory", "usage"):
            continue
        keywords = parts[2]
        mapping[dirname] = keywords
    return mapping


def list_asset_dirs() -> set[str]:
    """Return all directories under assets/figures/ that contain scripts."""
    dirs = set()
    skip = {"basic-plots", "multipanel", "other", "README.md"}
    if not FIGURES_DIR.exists():
        return dirs
    for name in os.listdir(FIGURES_DIR):
        if name in skip:
            continue
        path = FIGURES_DIR / name
        if path.is_dir():
            scripts = list(path.glob("*.py")) + list(path.glob("*.R")) + list(path.glob("*.r"))
            if scripts:
                dirs.add(name)
    return dirs


def parse_compose_aspect_keys() -> set[str]:
    """Extract all keys from compose.py PANEL_ASPECT dict."""
    src = COMPOSE_PY.read_text(encoding="utf-8")
    # Match inside PANEL_ASPECT = { ... }
    m = re.search(r'PANEL_ASPECT\s*=\s*\{(.*?)\}', src, re.DOTALL)
    if not m:
        return set()
    keys = set()
    for line in m.group(1).splitlines():
        key_match = re.match(r'\s*"([^"]+)"', line)
        if key_match:
            keys.add(key_match.group(1))
    return keys


def parse_skill_md_refs() -> list[str]:
    """Extract all references/<file> and scripts/<file> mentions from SKILL.md."""
    text = SKILL_MD.read_text(encoding="utf-8")
    refs = re.findall(r'`(references/[^`]+\.(?:md|R))`', text)
    scripts = re.findall(r'`(?:academic-figure-skill/)?scripts/([^`]+\.py)`', text)
    assets = re.findall(r'`assets/figures/([^`/]+)/', text)
    all_refs = refs + [f"scripts/{s}" for s in scripts] + [f"assets/figures/{a}" for a in assets]
    # Filter out placeholder patterns like <type>, <dir>, <ext>, <panel_label>
    return [r for r in all_refs if "<" not in r and ">" not in r]


def check_bidirectional_coverage(map_dirs: dict, asset_dirs: set) -> list[dict]:
    """Check every directory in map ↔ existence in assets, and vice versa."""
    findings = []
    map_set = set(map_dirs.keys())

    # Directories in map but missing from disk
    for d in sorted(map_set - asset_dirs):
        findings.append({
            "check": "dir_in_map_missing_from_disk",
            "severity": "FAIL",
            "detail": f"directory-map.md lists '{d}' but no scripts found in assets/figures/{d}/",
        })

    # Directories on disk but missing from map
    for d in sorted(asset_dirs - map_set):
        findings.append({
            "check": "dir_on_disk_missing_from_map",
            "severity": "WARN",
            "detail": f"assets/figures/{d}/ has scripts but directory-map.md has no entry — users cannot route to it",
        })

    # Every asset dir has ≥1 script + ≥1 preview
    for d in sorted(asset_dirs):
        p = FIGURES_DIR / d
        scripts = list(p.glob("*.py")) + list(p.glob("*.R")) + list(p.glob("*.r"))
        pngs = list(p.glob("*.png"))
        if not pngs:
            findings.append({
                "check": "missing_preview_png",
                "severity": "WARN",
                "detail": f"assets/figures/{d}/ has {len(scripts)} script(s) but 0 preview PNGs",
            })

    return findings


def _to_snake(name: str) -> str:
    """Normalize CamelCase or kebab-case to snake_case for PANEL_ASPECT lookup."""
    # Insert underscore between lowercase-uppercase transitions
    s = re.sub(r'([a-z])([A-Z])', r'\1_\2', name)
    # Insert underscore between letter-digit transitions
    s = re.sub(r'([a-zA-Z])(\d)', r'\1_\2', s)
    s = s.lower().replace("-", "_").replace(" ", "_")
    return s


def check_aspect_coverage(map_dirs: dict, aspect_keys: set) -> list[dict]:
    """Check PANEL_ASPECT has a key for every figure type in directory-map."""
    findings = []
    for d in sorted(map_dirs.keys()):
        d_snake = _to_snake(d)
        # Check if any PANEL_ASPECT key is a substring of the normalized name
        found = any(k in d_snake for k in aspect_keys)
        if not found:
            findings.append({
                "check": "missing_aspect_key",
                "severity": "WARN",
                "detail": f"'{d}' (normalized: {d_snake}) has no matching PANEL_ASPECT key — defaults to 0.85",
            })
    return findings


def check_skill_refs_exist(refs: list[str]) -> list[dict]:
    """Verify every reference file and script mentioned in SKILL.md exists."""
    findings = []
    seen = set()
    for ref in refs:
        if ref in seen:
            continue
        seen.add(ref)
        path = SKILL_DIR / ref
        if not path.exists():
            findings.append({
                "check": "missing_referenced_file",
                "severity": "FAIL",
                "detail": f"SKILL.md references '{ref}' but file does not exist",
            })
    return findings


def check_reference_md_health() -> list[dict]:
    """Check all references/*.md files exist and are non-empty."""
    findings = []
    # Files SKILL.md says to always load / on-demand
    expected = [
        "checklist.md", "color-palettes.md", "common-pitfalls.md",
        "complexheatmap.md", "directory-map.md", "export-specs.md",
        "figure-contract.md", "figure-deconstruction.md", "journal-intel.md",
        "journal-specs.md", "matplotlib.md", "multipanel-layout.md",
        "r-rendering.md", "revision-cases.md", "typography.md",
        "compose.R",
    ]
    for fname in expected:
        p = REFERENCES / fname
        if not p.exists():
            findings.append({
                "check": "missing_reference",
                "severity": "FAIL",
                "detail": f"references/{fname} is listed in SKILL.md but missing",
            })
        elif p.stat().st_size < 100:
            findings.append({
                "check": "suspiciously_small_reference",
                "severity": "WARN",
                "detail": f"references/{fname} is only {p.stat().st_size} bytes — may be truncated",
            })
    return findings


def run_all() -> dict:
    map_dirs = parse_directory_map()
    asset_dirs = list_asset_dirs()
    aspect_keys = parse_compose_aspect_keys()
    skill_refs = parse_skill_md_refs()

    findings = []
    findings += check_bidirectional_coverage(map_dirs, asset_dirs)
    findings += check_aspect_coverage(map_dirs, aspect_keys)
    findings += check_skill_refs_exist(skill_refs)
    findings += check_reference_md_health()

    fails = [f for f in findings if f["severity"] == "FAIL"]
    warns = [f for f in findings if f["severity"] == "WARN"]

    return {
        "summary": {
            "map_entries": len(map_dirs),
            "asset_dirs": len(asset_dirs),
            "aspect_keys": len(aspect_keys),
            "skill_refs": len(set(skill_refs)),
            "total_findings": len(findings),
            "failures": len(fails),
            "warnings": len(warns),
            "healthy": len(fails) == 0,
        },
        "findings": findings,
    }


if __name__ == "__main__":
    report = run_all()
    use_json = "--json" in sys.argv

    if use_json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        s = report["summary"]
        print("=" * 60)
        print("Academic Figure Skill Reference Integrity Report")
        print(f"  Directory-map entries : {s['map_entries']}")
        print(f"  Asset directories     : {s['asset_dirs']}")
        print(f"  PANEL_ASPECT keys     : {s['aspect_keys']}")
        print(f"  SKILL.md refs         : {s['skill_refs']}")
        print(f"  Findings: {s['failures']} FAIL, {s['warnings']} WARN, {s['total_findings']} total")
        print("=" * 60)
        if report["findings"]:
            for f in report["findings"]:
                tag = f["severity"]
                print(f"  [{tag}] {f['check']}: {f['detail']}")
        else:
            print("  All checks passed — references are consistent.")
        print("=" * 60)
        print(f"Verdict: {'HEALTHY' if s['healthy'] else 'NEEDS ATTENTION'}")
