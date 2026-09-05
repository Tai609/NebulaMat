#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pymatgen"]
# ///
"""Audit slab and adsorbate geometry before downstream calculations.

The script reports deterministic geometry facts for a structure-prep release gate:
lattice dimensions, slab thickness/vacuum estimate, computational-economy signals,
slab-cell orthogonality, selective-dynamics flags, closest contacts with PBC checked against Pyykko
single-bond covalent-radius sums, adsorbate-surface distance, and adsorbate-image
separation.

It does not decide whether a model is scientifically right. A structure critic should
interpret the report against the intended facet, termination, coverage, and chemistry.

Usage:
  uv run scripts/audit_structure.py POSCAR --adsorbate-count 1
  uv run scripts/audit_structure.py POSCAR --adsorbate-indices 73-78 --json audit.json

Exit: 0 if no hard failures, 1 if geometry gates fail, 2 for usage/import/read errors.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

from covalent_radii import (
    DEFAULT_CONTACT_RADIUS_SCALE,
    covalent_contact_threshold_A,
    covalent_radius_sum_A,
    element_symbol_from_site,
)


def parse_indices(spec: str | None, nsites: int) -> list[int]:
    if not spec:
        return []
    indices: set[int] = set()
    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue
        if "-" in token:
            left, right = token.split("-", 1)
            start = int(left)
            stop = int(right)
            if stop < start:
                raise ValueError(f"descending index range: {token}")
            values = range(start, stop + 1)
        else:
            values = [int(token)]
        for value in values:
            if value < 1 or value > nsites:
                raise ValueError(f"atom index out of range: {value} (1..{nsites})")
            indices.add(value - 1)
    return sorted(indices)


def load_structure(path: Path):
    try:
        from pymatgen.core import Structure
        from pymatgen.io.vasp import Poscar
    except Exception as exc:  # pragma: no cover - depends on local environment
        raise SystemExit(f"failed to import pymatgen: {exc} (run via `uv run ...`)") from exc

    if not path.is_file():
        raise SystemExit(f"structure file not found: {path}")

    selective_dynamics = None
    try:
        poscar = Poscar.from_file(path)
        structure = poscar.structure
        selective_dynamics = structure.site_properties.get("selective_dynamics")
        if selective_dynamics is None:
            selective_dynamics = getattr(poscar, "selective_dynamics", None)
    except Exception:
        structure = Structure.from_file(path)
        selective_dynamics = structure.site_properties.get("selective_dynamics")
    return structure, selective_dynamics


def add_finding(findings: list[dict[str, str]], level: str, check: str, message: str) -> None:
    findings.append({"level": level, "check": check, "message": message})


def image_tuple(image: Any) -> tuple[int, int, int]:
    try:
        return tuple(int(round(float(x))) for x in image)  # type: ignore[arg-type]
    except TypeError:
        return (0, 0, 0)


def neighbor_pairs(structure, radius: float) -> list[dict[str, Any]]:
    try:
        centers, points, images, distances = structure.get_neighbor_list(radius)
    except Exception as exc:  # noqa: BLE001 - report pymatgen detail
        raise RuntimeError(f"neighbor search failed: {exc}") from exc

    pairs: list[dict[str, Any]] = []
    seen: set[tuple[int, int, tuple[int, int, int]]] = set()
    for center, point, image, distance in zip(centers, points, images, distances, strict=False):
        i = int(center)
        j = int(point)
        img = image_tuple(image)
        if i == j and img == (0, 0, 0):
            continue
        key = (i, j, img)
        reverse_key = (j, i, tuple(-x for x in img))
        if key in seen or reverse_key in seen:
            continue
        seen.add(key)
        pairs.append(
            {
                "i": i,
                "j": j,
                "image": img,
                "distance": float(distance),
            }
        )
    pairs.sort(key=lambda item: item["distance"])
    return pairs


def species_label(structure, index: int) -> str:
    return f"{index + 1}:{structure[index].species_string}"


def summarize_pair(structure, pair: dict[str, Any]) -> dict[str, Any]:
    return {
        "i": int(pair["i"]) + 1,
        "j": int(pair["j"]) + 1,
        "species_i": structure[pair["i"]].species_string,
        "species_j": structure[pair["j"]].species_string,
        "image": list(pair["image"]),
        "distance_A": round(float(pair["distance"]), 6),
    }


def pair_element_symbols(structure, pair: dict[str, Any]) -> tuple[str | None, str | None]:
    return element_symbol_from_site(structure[pair["i"]]), element_symbol_from_site(structure[pair["j"]])


def pair_contact_summary(structure, pair: dict[str, Any], scale: float) -> dict[str, float] | None:
    symbol_i, symbol_j = pair_element_symbols(structure, pair)
    radius_sum = covalent_radius_sum_A(symbol_i, symbol_j)
    threshold = covalent_contact_threshold_A(symbol_i, symbol_j, scale)
    if radius_sum is None or threshold is None:
        return None
    distance = float(pair["distance"])
    return {
        "covalent_radius_sum_A": round(radius_sum, 6),
        "contact_threshold_A": round(threshold, 6),
        "distance_minus_threshold_A": round(distance - threshold, 6),
        "distance_minus_radius_sum_A": round(distance - radius_sum, 6),
        "distance_over_radius_sum": round(distance / radius_sum, 6),
        "radius_sum_compression_percent": round(max((1.0 - distance / radius_sum) * 100.0, 0.0), 6),
    }


def summarize_pair_with_contact(structure, pair: dict[str, Any], scale: float) -> dict[str, Any]:
    summary = summarize_pair(structure, pair)
    contact = pair_contact_summary(structure, pair, scale)
    if contact is not None:
        summary.update(contact)
    return summary


def contact_violations(structure, pairs: list[dict[str, Any]], scale: float) -> list[dict[str, Any]]:
    if scale <= 0:
        return []
    violations: list[dict[str, Any]] = []
    for pair in pairs:
        contact = pair_contact_summary(structure, pair, scale)
        if contact is None:
            continue
        deficit = -contact["distance_minus_threshold_A"]
        if deficit > 0:
            entry = dict(pair)
            entry["covalent_radius_sum_A"] = contact["covalent_radius_sum_A"]
            entry["contact_threshold_A"] = contact["contact_threshold_A"]
            entry["contact_deficit_A"] = round(deficit, 6)
            violations.append(entry)
    violations.sort(key=lambda item: item["contact_deficit_A"], reverse=True)
    return violations


def compressed_contacts(structure, pairs: list[dict[str, Any]], scale: float) -> list[dict[str, Any]]:
    if scale <= 0:
        return []
    compressed: list[dict[str, Any]] = []
    for pair in pairs:
        contact = pair_contact_summary(structure, pair, scale)
        if contact is None:
            continue
        if contact["distance_minus_threshold_A"] >= 0 and contact["distance_minus_radius_sum_A"] < 0:
            entry = dict(pair)
            entry["covalent_radius_sum_A"] = contact["covalent_radius_sum_A"]
            entry["contact_threshold_A"] = contact["contact_threshold_A"]
            entry["compression_percent"] = contact["radius_sum_compression_percent"]
            compressed.append(entry)
    compressed.sort(key=lambda item: item["compression_percent"], reverse=True)
    return compressed


def selective_summary(selective_dynamics: Any, nsites: int) -> dict[str, Any]:
    if selective_dynamics is None:
        return {"present": False, "fixed_all": 0, "free_all": 0, "mixed": 0}
    fixed_all = 0
    free_all = 0
    mixed = 0
    for flags in selective_dynamics:
        values = [bool(flag) for flag in flags]
        if values == [False, False, False]:
            fixed_all += 1
        elif values == [True, True, True]:
            free_all += 1
        else:
            mixed += 1
    return {
        "present": True,
        "fixed_all": fixed_all,
        "free_all": free_all,
        "mixed": mixed,
        "count_matches_sites": len(selective_dynamics) == nsites,
    }


def compact_text(value: Any, limit: int = 180) -> str:
    text = str(value).replace("\n", " ").strip()
    if len(text) <= limit:
        return text
    return text[: max(limit - 3, 0)].rstrip() + "..."


def markdown_row(values: list[Any]) -> str:
    cells = [str(value).replace("|", "\\|") for value in values]
    return "| " + " | ".join(cells) + " |"


def print_table(headers: list[str], rows: list[list[Any]]) -> None:
    print(markdown_row(headers))
    print(markdown_row(["---"] * len(headers)))
    for row in rows:
        print(markdown_row(row))


def finding_counts(findings: list[dict[str, str]]) -> dict[str, int]:
    return {
        "FAIL": sum(1 for finding in findings if finding["level"] == "FAIL"),
        "WARN": sum(1 for finding in findings if finding["level"] == "WARN"),
        "PASS": sum(1 for finding in findings if finding["level"] == "PASS"),
    }


def pair_row(structure, label: str, pair: dict[str, Any] | None, scale: float) -> list[Any] | None:
    if pair is None:
        return None
    contact = pair_contact_summary(structure, pair, scale)
    margin = "n/a" if contact is None else f"{contact['distance_minus_threshold_A']:.3f}"
    return [
        label,
        f"{species_label(structure, pair['i'])}-{species_label(structure, pair['j'])}",
        pair["image"],
        f"{pair['distance']:.3f}",
        margin,
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("structure", help="POSCAR/CONTCAR/CIF/structure file readable by pymatgen")
    parser.add_argument("--adsorbate-count", type=int, default=0, help="Treat the last N atoms as adsorbate/cluster")
    parser.add_argument("--adsorbate-indices", help="1-based atom indices/ranges, e.g. 73-78,91")
    parser.add_argument("--surface-indices", help="Optional 1-based slab/surface atom indices/ranges")
    parser.add_argument("--neighbor-radius", type=float, default=12.0, help="PBC neighbor search radius in A")
    parser.add_argument(
        "--closest-pairs",
        type=int,
        default=10,
        help="Number of closest PBC pairs to store in JSON and print with --verbose",
    )
    parser.add_argument(
        "--min-distance",
        type=float,
        default=0.70,
        help="Fallback hard minimum atom-atom distance in A when covalent radii are unavailable or disabled",
    )
    parser.add_argument(
        "--contact-radius-scale",
        type=float,
        default=DEFAULT_CONTACT_RADIUS_SCALE,
        help=(
            "Minimum allowed contact distance is scale*(Pyykko single-bond covalent radii sum); "
            "default 0.95 allows about 5%% compression; <=0 disables"
        ),
    )
    parser.add_argument("--contact-radius-severity", choices=["warn", "fail"], default="fail")
    parser.add_argument("--min-vacuum", type=float, default=12.0, help="Minimum c-axis vacuum estimate in A")
    parser.add_argument("--min-vacuum-adsorbate", type=float, default=15.0, help="Vacuum target when adsorbates exist")
    parser.add_argument("--max-vacuum", type=float, default=20.0, help="Warn/fail if c-axis vacuum estimate exceeds this A; <=0 disables")
    parser.add_argument("--large-vacuum-severity", choices=["warn", "fail"], default="warn")
    parser.add_argument(
        "--max-slab-tilt-deg",
        type=float,
        default=1.0,
        help="Warn/fail when c is not perpendicular to a and b by more than this angle in degrees; <=0 disables",
    )
    parser.add_argument("--slab-tilt-severity", choices=["warn", "fail"], default="warn")
    parser.add_argument("--warn-atoms", type=int, default=200, help="Warn when atom count exceeds this value; <=0 disables")
    parser.add_argument("--max-atoms", type=int, default=300, help="Warn/fail when atom count exceeds this value; <=0 disables")
    parser.add_argument("--large-model-severity", choices=["warn", "fail"], default="warn")
    parser.add_argument("--max-cell-length", type=float, default=30.0, help="Warn/fail if any lattice length exceeds this A; <=0 disables")
    parser.add_argument("--large-cell-severity", choices=["warn", "fail"], default="warn")
    parser.add_argument("--min-lateral", type=float, default=0.0, help="Optional minimum a and b lattice lengths in A")
    parser.add_argument("--min-image-separation", type=float, default=5.0, help="Soft minimum adsorbate-image atom distance in A")
    parser.add_argument("--image-separation-severity", choices=["warn", "fail"], default="warn")
    parser.add_argument(
        "--min-adsorbate-surface",
        type=float,
        default=0.80,
        help="Fallback minimum adsorbate-surface distance in A when covalent radii are unavailable or disabled",
    )
    parser.add_argument("--max-adsorbate-surface", type=float, default=3.50, help="Warn if nearest adsorbate-surface distance exceeds this A")
    parser.add_argument("--far-adsorbate-severity", choices=["warn", "fail"], default="warn")
    parser.add_argument("--require-selective-dynamics", action="store_true")
    parser.add_argument("--json", dest="json_path", help="Write machine-readable audit JSON")
    parser.add_argument("--verbose", action="store_true", help="Print full closest-pair details to stdout")
    args = parser.parse_args()

    try:
        structure, selective_dynamics = load_structure(Path(args.structure))
        nsites = len(structure)
        adsorbate_indices = set(parse_indices(args.adsorbate_indices, nsites))
        if args.adsorbate_count:
            if args.adsorbate_count < 0 or args.adsorbate_count > nsites:
                raise ValueError("--adsorbate-count must be between 0 and number of sites")
            adsorbate_indices.update(range(nsites - args.adsorbate_count, nsites))
        surface_indices = set(parse_indices(args.surface_indices, nsites)) if args.surface_indices else set(range(nsites))
        surface_indices -= adsorbate_indices
        pairs = neighbor_pairs(structure, max(args.neighbor_radius, args.min_image_separation + 2.0))
    except ValueError as exc:
        print(f"input error: {exc}", file=sys.stderr)
        return 2
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - command-line diagnostic
        print(f"audit failed: {exc}", file=sys.stderr)
        return 2

    findings: list[dict[str, str]] = []
    lattice = structure.lattice
    z_values = [float(site.coords[2]) for site in structure]
    slab_thickness = max(z_values) - min(z_values) if z_values else 0.0
    vacuum_estimate = float(lattice.c) - slab_thickness
    c_axis_cos_z = abs(float(lattice.matrix[2][2])) / float(lattice.c) if lattice.c else 0.0
    alpha_deviation = abs(float(lattice.alpha) - 90.0)
    beta_deviation = abs(float(lattice.beta) - 90.0)
    c_ab_max_deviation = max(alpha_deviation, beta_deviation)

    if c_axis_cos_z < 0.95:
        add_finding(
            findings,
            "WARN",
            "cell-orientation",
            "c lattice vector is not closely aligned with Cartesian z; vacuum estimate assumes c-axis slab normal",
        )

    if args.max_slab_tilt_deg > 0:
        if c_ab_max_deviation > args.max_slab_tilt_deg:
            add_finding(
                findings,
                "FAIL" if args.slab_tilt_severity == "fail" else "WARN",
                "slab-cell-orthogonality",
                f"c is not perpendicular to both a and b "
                f"(alpha={lattice.alpha:.2f} deg, beta={lattice.beta:.2f} deg; "
                f"max deviation {c_ab_max_deviation:.2f} deg > {args.max_slab_tilt_deg:.2f} deg). "
                "Do not hard-rotate or orthogonalize first. Re-check whether the slab was cut from "
                "the intended conventional cell with pymatgen SlabGenerator primitive=False and a suitable "
                "max_normal_search value, then verify the Miller cut, surface normal, wrapping, and c-axis "
                "vacuum before engine handoff. Use Slab.get_orthogonal_c_slab() only as an explicit fallback "
                "with a recorded reason because it can break slab symmetries.",
            )
        else:
            add_finding(
                findings,
                "PASS",
                "slab-cell-orthogonality",
                f"c approximately perpendicular to a and b "
                f"(alpha={lattice.alpha:.2f} deg, beta={lattice.beta:.2f} deg)",
            )

    if args.max_atoms > 0 and nsites > args.max_atoms:
        add_finding(
            findings,
            "FAIL" if args.large_model_severity == "fail" else "WARN",
            "model-size",
            f"atom count {nsites} exceeds high-cost threshold {args.max_atoms}; "
            "record a computational-cost justification or reduce the model",
        )
    elif args.warn_atoms > 0 and nsites > args.warn_atoms:
        add_finding(
            findings,
            "WARN",
            "model-size",
            f"atom count {nsites} exceeds economy-review threshold {args.warn_atoms}; "
            "check whether the extra size is scientifically needed",
        )
    else:
        add_finding(findings, "PASS", "model-size", f"atom count {nsites}")

    if args.max_cell_length > 0:
        cell_lengths = {
            "a": float(lattice.a),
            "b": float(lattice.b),
            "c": float(lattice.c),
        }
        oversized = {axis: length for axis, length in cell_lengths.items() if length > args.max_cell_length}
        if oversized:
            length_text = ", ".join(f"{axis}={length:.2f} A" for axis, length in oversized.items())
            add_finding(
                findings,
                "FAIL" if args.large_cell_severity == "fail" else "WARN",
                "cell-size",
                f"{length_text} exceeds economy threshold {args.max_cell_length:.2f} A; "
                "confirm this is required by finite-size, vacuum, or electrostatic convergence",
            )
        else:
            add_finding(
                findings,
                "PASS",
                "cell-size",
                f"a={lattice.a:.2f} A, b={lattice.b:.2f} A, c={lattice.c:.2f} A",
            )

    vacuum_target = args.min_vacuum_adsorbate if adsorbate_indices else args.min_vacuum
    if vacuum_estimate < vacuum_target:
        add_finding(
            findings,
            "FAIL",
            "vacuum",
            f"c-axis vacuum estimate {vacuum_estimate:.2f} A is below target {vacuum_target:.2f} A",
        )
    else:
        add_finding(findings, "PASS", "vacuum", f"c-axis vacuum estimate {vacuum_estimate:.2f} A")

    if args.max_vacuum > 0:
        if vacuum_estimate > args.max_vacuum:
            add_finding(
                findings,
                "FAIL" if args.large_vacuum_severity == "fail" else "WARN",
                "vacuum-upper",
                f"c-axis vacuum estimate {vacuum_estimate:.2f} A exceeds economy threshold "
                f"{args.max_vacuum:.2f} A; around 15 A is usually enough unless a convergence "
                "or electrostatic rationale is recorded",
            )
        else:
            add_finding(
                findings,
                "PASS",
                "vacuum-upper",
                f"c-axis vacuum estimate {vacuum_estimate:.2f} A within upper economy threshold",
            )

    if args.min_lateral > 0:
        if lattice.a < args.min_lateral or lattice.b < args.min_lateral:
            add_finding(
                findings,
                "FAIL",
                "lateral-cell",
                f"a={lattice.a:.2f} A, b={lattice.b:.2f} A below requested minimum {args.min_lateral:.2f} A",
            )
        else:
            add_finding(findings, "PASS", "lateral-cell", f"a={lattice.a:.2f} A, b={lattice.b:.2f} A")

    sd_summary = selective_summary(selective_dynamics, nsites)
    if args.require_selective_dynamics and not sd_summary["present"]:
        add_finding(findings, "FAIL", "selective-dynamics", "selective dynamics flags are required but absent")
    elif not sd_summary["present"]:
        add_finding(findings, "WARN", "selective-dynamics", "selective dynamics flags absent")
    elif not sd_summary.get("count_matches_sites", True):
        add_finding(findings, "FAIL", "selective-dynamics", "flag count does not match atom count")
    else:
        add_finding(
            findings,
            "PASS",
            "selective-dynamics",
            f"fixed={sd_summary['fixed_all']}, free={sd_summary['free_all']}, mixed={sd_summary['mixed']}",
        )

    closest = pairs[: max(args.closest_pairs, 0)]
    covalent_violations = contact_violations(structure, pairs, args.contact_radius_scale)
    compressed = compressed_contacts(structure, pairs, args.contact_radius_scale)
    if covalent_violations:
        pair = covalent_violations[0]
        add_finding(
            findings,
            "FAIL" if args.contact_radius_severity == "fail" else "WARN",
            "closest-contact",
            f"{species_label(structure, pair['i'])} - {species_label(structure, pair['j'])} "
            f"image={pair['image']} distance={pair['distance']:.2f} A below allowed covalent-contact minimum "
            f"{pair['contact_threshold_A']:.2f} A "
            f"(Pyykko radius sum {pair['covalent_radius_sum_A']:.2f} A, "
            f"scale={args.contact_radius_scale:.2f})",
        )
    elif compressed:
        pair = compressed[0]
        add_finding(
            findings,
            "WARN",
            "compressed-contact",
            f"{species_label(structure, pair['i'])} - {species_label(structure, pair['j'])} "
            f"image={pair['image']} distance={pair['distance']:.2f} A is "
            f"{pair['compression_percent']:.1f}% below Pyykko radius sum "
            f"{pair['covalent_radius_sum_A']:.2f} A but above allowed minimum "
            f"{pair['contact_threshold_A']:.2f} A",
        )
    elif pairs and args.contact_radius_scale > 0:
        contact_pairs = [pair_contact_summary(structure, pair, args.contact_radius_scale) for pair in pairs]
        known_contacts = [contact for contact in contact_pairs if contact is not None]
        if known_contacts:
            min_margin = min(contact["distance_minus_radius_sum_A"] for contact in known_contacts)
            add_finding(
                findings,
                "PASS",
                "closest-contact",
                f"no PBC pair below Pyykko covalent-radius sum; minimum margin {min_margin:.2f} A",
            )
        else:
            add_finding(
                findings,
                "WARN",
                "closest-contact",
                "no covalent-radius data available for closest pairs; used absolute-distance fallback only",
            )
    elif pairs:
        add_finding(findings, "PASS", "closest-contact", f"minimum PBC distance {pairs[0]['distance']:.2f} A")

    if pairs and pairs[0]["distance"] < args.min_distance:
        pair = pairs[0]
        add_finding(
            findings,
            "FAIL",
            "absolute-close-contact",
            f"{species_label(structure, pair['i'])} - {species_label(structure, pair['j'])} "
            f"image={pair['image']} distance={pair['distance']:.2f} A below absolute fallback "
            f"{args.min_distance:.2f} A",
        )

    adsorbate_surface_distance = math.inf
    adsorbate_surface_pair: dict[str, Any] | None = None
    adsorbate_image_distance = math.inf
    adsorbate_image_pair: dict[str, Any] | None = None
    if adsorbate_indices:
        for pair in pairs:
            i = int(pair["i"])
            j = int(pair["j"])
            i_ads = i in adsorbate_indices
            j_ads = j in adsorbate_indices
            if i_ads != j_ads and (i in surface_indices or j in surface_indices):
                if pair["distance"] < adsorbate_surface_distance:
                    adsorbate_surface_distance = float(pair["distance"])
                    adsorbate_surface_pair = pair
            if i_ads and j_ads and pair["image"] != (0, 0, 0):
                if pair["distance"] < adsorbate_image_distance:
                    adsorbate_image_distance = float(pair["distance"])
                    adsorbate_image_pair = pair

        if adsorbate_surface_pair is None:
            add_finding(findings, "FAIL", "adsorbate-surface", "no adsorbate-surface neighbor found within search radius")
        else:
            adsorbate_surface_contact = pair_contact_summary(
                structure, adsorbate_surface_pair, args.contact_radius_scale
            )
            adsorbate_surface_min = (
                adsorbate_surface_contact["contact_threshold_A"]
                if adsorbate_surface_contact is not None
                else args.min_adsorbate_surface
            )
            adsorbate_surface_min_label = (
                f"allowed covalent-contact minimum {adsorbate_surface_min:.2f} A "
                f"(Pyykko radius sum {adsorbate_surface_contact['covalent_radius_sum_A']:.2f} A, "
                f"scale={args.contact_radius_scale:.2f})"
                if adsorbate_surface_contact is not None
                else f"fallback minimum {adsorbate_surface_min:.2f} A"
            )

        if adsorbate_surface_pair is not None and adsorbate_surface_distance < adsorbate_surface_min:
            add_finding(
                findings,
                "FAIL",
                "adsorbate-surface",
                f"nearest adsorbate-surface distance {adsorbate_surface_distance:.2f} A below "
                f"{adsorbate_surface_min_label}",
            )
        elif (
            adsorbate_surface_pair is not None
            and adsorbate_surface_contact is not None
            and adsorbate_surface_contact["distance_minus_radius_sum_A"] < 0
        ):
            add_finding(
                findings,
                "WARN",
                "adsorbate-surface-compressed",
                f"nearest adsorbate-surface distance {adsorbate_surface_distance:.2f} A is "
                f"{adsorbate_surface_contact['radius_sum_compression_percent']:.1f}% below Pyykko radius sum "
                f"{adsorbate_surface_contact['covalent_radius_sum_A']:.2f} A but above allowed minimum "
                f"{adsorbate_surface_min:.2f} A",
            )
        elif adsorbate_surface_pair is not None and adsorbate_surface_distance > args.max_adsorbate_surface:
            add_finding(
                findings,
                "FAIL" if args.far_adsorbate_severity == "fail" else "WARN",
                "adsorbate-surface",
                f"nearest adsorbate-surface distance {adsorbate_surface_distance:.2f} A exceeds "
                f"{args.max_adsorbate_surface:.2f} A; check for a floating adsorbate",
            )
        elif adsorbate_surface_pair is not None:
            add_finding(
                findings,
                "PASS",
                "adsorbate-surface",
                f"nearest adsorbate-surface distance {adsorbate_surface_distance:.2f} A "
                f"(minimum {adsorbate_surface_min:.2f} A)",
            )

        if adsorbate_image_pair is not None and adsorbate_image_distance < args.min_image_separation:
            add_finding(
                findings,
                "FAIL" if args.image_separation_severity == "fail" else "WARN",
                "adsorbate-image",
                f"nearest adsorbate-image atom distance {adsorbate_image_distance:.2f} A below "
                f"{args.min_image_separation:.2f} A; record finite-size/coverage and computational-cost "
                "tradeoffs if this compact model is kept",
            )
        elif adsorbate_image_pair is None:
            add_finding(
                findings,
                "PASS",
                "adsorbate-image",
                f"no adsorbate image within {max(args.neighbor_radius, args.min_image_separation + 2.0):.2f} A",
            )
        else:
            add_finding(
                findings,
                "PASS",
                "adsorbate-image",
                f"nearest adsorbate-image atom distance {adsorbate_image_distance:.2f} A",
            )

    report = {
        "structure": str(args.structure),
        "formula": structure.composition.reduced_formula,
        "nsites": nsites,
        "lattice": {
            "a_A": round(float(lattice.a), 6),
            "b_A": round(float(lattice.b), 6),
            "c_A": round(float(lattice.c), 6),
            "alpha_deg": round(float(lattice.alpha), 6),
            "beta_deg": round(float(lattice.beta), 6),
            "gamma_deg": round(float(lattice.gamma), 6),
        },
        "slab": {
            "z_min_A": round(min(z_values), 6),
            "z_max_A": round(max(z_values), 6),
            "thickness_A": round(slab_thickness, 6),
            "vacuum_estimate_A": round(vacuum_estimate, 6),
            "c_axis_cos_z": round(c_axis_cos_z, 6),
            "c_ab_max_deviation_deg": round(c_ab_max_deviation, 6),
            "c_ab_deviation_tolerance_deg": args.max_slab_tilt_deg,
        },
        "selective_dynamics": sd_summary,
        "economy_thresholds": {
            "warn_atoms": args.warn_atoms,
            "max_atoms": args.max_atoms,
            "max_cell_length_A": args.max_cell_length,
            "max_vacuum_A": args.max_vacuum,
            "min_image_separation_A": args.min_image_separation,
            "image_separation_severity": args.image_separation_severity,
            "contact_radius_source": "Pyykko/Atsumi single-bond covalent radii",
            "contact_radius_scale": args.contact_radius_scale,
            "contact_radius_severity": args.contact_radius_severity,
            "fallback_min_distance_A": args.min_distance,
        },
        "adsorbate_indices_1based": [idx + 1 for idx in sorted(adsorbate_indices)],
        "surface_indices_count": len(surface_indices),
        "closest_pairs": [summarize_pair_with_contact(structure, pair, args.contact_radius_scale) for pair in closest],
        "covalent_contact_violations": [
            summarize_pair_with_contact(structure, pair, args.contact_radius_scale) for pair in covalent_violations
        ],
        "compressed_contacts": [
            summarize_pair_with_contact(structure, pair, args.contact_radius_scale) for pair in compressed
        ],
        "adsorbate_surface_pair": summarize_pair_with_contact(
            structure, adsorbate_surface_pair, args.contact_radius_scale
        )
        if adsorbate_surface_pair is not None
        else None,
        "adsorbate_image_pair": summarize_pair_with_contact(structure, adsorbate_image_pair, args.contact_radius_scale)
        if adsorbate_image_pair is not None
        else None,
        "findings": findings,
    }

    if args.json_path:
        json_path = Path(args.json_path)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    counts = finding_counts(findings)
    verdict = "FAIL" if counts["FAIL"] else "WARN" if counts["WARN"] else "PASS"
    print(f"STRUCTURE AUDIT: {args.structure}")
    print_table(
        ["field", "value"],
        [
            ["verdict", verdict],
            ["formula", report["formula"]],
            ["atoms", nsites],
            [
                "lattice_A_deg",
                (
                    f"a={lattice.a:.2f}, b={lattice.b:.2f}, c={lattice.c:.2f}; "
                    f"alpha={lattice.alpha:.2f}, beta={lattice.beta:.2f}, gamma={lattice.gamma:.2f}"
                ),
            ],
            ["slab_A", f"thickness={slab_thickness:.2f}, vacuum={vacuum_estimate:.2f}"],
            [
                "selective_dynamics",
                (
                    f"present={sd_summary['present']}, fixed={sd_summary['fixed_all']}, "
                    f"free={sd_summary['free_all']}, mixed={sd_summary['mixed']}"
                ),
            ],
            ["adsorbate_atoms", ",".join(str(idx + 1) for idx in sorted(adsorbate_indices)) or "none"],
            ["finding_counts", f"FAIL={counts['FAIL']}, WARN={counts['WARN']}, PASS={counts['PASS']}"],
            ["full_json", args.json_path or "not written; rerun with --json PATH for full evidence"],
        ],
    )

    print("\nCHECK SUMMARY")
    print_table(
        ["level", "check", "evidence"],
        [[finding["level"], finding["check"], compact_text(finding["message"])] for finding in findings],
    )

    pair_rows: list[list[Any]] = []
    seen_pairs: set[tuple[int, int, tuple[int, int, int]]] = set()
    for label, pair in [
        ("worst_contact_violation", covalent_violations[0] if covalent_violations else None),
        ("worst_compressed_contact", compressed[0] if compressed else None),
        ("adsorbate_surface", adsorbate_surface_pair),
        ("adsorbate_image", adsorbate_image_pair),
        ("closest_pbc_pair", closest[0] if closest else None),
    ]:
        if pair is None:
            continue
        key = (int(pair["i"]), int(pair["j"]), tuple(pair["image"]))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        row = pair_row(structure, label, pair, args.contact_radius_scale)
        if row is not None:
            pair_rows.append(row)
    if pair_rows:
        print("\nPAIR SUMMARY")
        print_table(["kind", "pair", "image", "distance_A", "margin_vs_allowed_A"], pair_rows)

    if args.verbose:
        print("\nVERBOSE CLOSEST PBC PAIRS")
        verbose_rows: list[list[Any]] = []
        for pair in closest:
            contact = pair_contact_summary(structure, pair, args.contact_radius_scale)
            verbose_rows.append(
                [
                    f"{species_label(structure, pair['i'])}-{species_label(structure, pair['j'])}",
                    pair["image"],
                    f"{pair['distance']:.3f}",
                    "n/a" if contact is None else f"{contact['covalent_radius_sum_A']:.3f}",
                    "n/a" if contact is None else f"{contact['contact_threshold_A']:.3f}",
                    "n/a" if contact is None else f"{contact['distance_minus_threshold_A']:.3f}",
                ]
            )
        print_table(
            ["pair", "image", "distance_A", "radius_sum_A", "allowed_min_A", "margin_vs_allowed_A"],
            verbose_rows,
        )

    return 1 if any(finding["level"] == "FAIL" for finding in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
