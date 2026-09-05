"""Deterministic materials validation used by skills and the MCP server.

Pymatgen, ASE, and RDKit are authoritative when installed. The lightweight
formula/DFT checks remain available during development before the materials
environment has finished provisioning.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ValidationFinding:
    level: str
    check: str
    message: str
    evidence: str = ""


@dataclass
class ValidationReport:
    ok: bool
    findings: list[ValidationFinding] = field(default_factory=list)
    normalized: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "findings": [asdict(finding) for finding in self.findings],
            "normalized": self.normalized,
        }


_TOKEN = re.compile(r"([A-Z][a-z]?)([0-9]*(?:\.[0-9]+)?)")


def parse_formula(formula: str) -> dict[str, float]:
    """Parse simple formulas; pymatgen handles complex formulas when present."""
    formula = formula.strip()
    if not formula:
        raise ValueError("formula is empty")
    try:
        from pymatgen.core import Composition  # type: ignore

        composition = Composition(formula)
        return {str(element): float(amount) for element, amount in composition.get_el_amt_dict().items()}
    except ImportError:
        pass
    except Exception as exc:
        raise ValueError(f"invalid formula: {exc}") from exc

    out: dict[str, float] = {}
    position = 0
    for match in _TOKEN.finditer(formula):
        if match.start() != position:
            raise ValueError(f"unsupported formula syntax near {formula[position:]}")
        amount = float(match.group(2) or "1")
        out[match.group(1)] = out.get(match.group(1), 0.0) + amount
        position = match.end()
    if position != len(formula) or not out:
        raise ValueError(f"unsupported formula syntax: {formula}")
    return out


def _ratio_error(actual: dict[str, float], expected: dict[str, float]) -> str | None:
    if set(actual) != set(expected):
        return f"elements differ: actual={sorted(actual)} expected={sorted(expected)}"
    if any(not math.isfinite(value) or value <= 0 for value in expected.values()):
        return "expected ratios must be finite positive numbers"
    actual_scale = min(actual[element] / expected[element] for element in expected)
    for element in expected:
        if not math.isclose(actual[element], expected[element] * actual_scale, rel_tol=1e-6, abs_tol=1e-6):
            return f"ratio for {element} is {actual[element]} but expected {expected[element]}"
    return None


def validate_formula(
    formula: str,
    oxidation_states: dict[str, float] | None = None,
    expected_ratio: dict[str, float] | None = None,
) -> ValidationReport:
    findings: list[ValidationFinding] = []
    try:
        amounts = parse_formula(formula)
    except ValueError as exc:
        return ValidationReport(False, [ValidationFinding("error", "formula", str(exc), formula)])

    if expected_ratio:
        try:
            numeric_ratio = {str(element): float(value) for element, value in expected_ratio.items()}
        except (TypeError, ValueError):
            numeric_ratio = {}
            findings.append(ValidationFinding("error", "element_ratio", "expected ratios must be numeric", formula))
        mismatch = _ratio_error(amounts, numeric_ratio) if numeric_ratio else None
        if mismatch:
            findings.append(ValidationFinding("error", "element_ratio", mismatch, formula))

    if oxidation_states:
        states: dict[str, float] = {}
        for element, raw_state in oxidation_states.items():
            try:
                state = float(raw_state)
            except (TypeError, ValueError):
                findings.append(
                    ValidationFinding("error", "oxidation_state", f"oxidation state for {element} is not numeric", repr(raw_state))
                )
                continue
            if not math.isfinite(state) or abs(state) > 8:
                findings.append(
                    ValidationFinding("error", "oxidation_state", f"oxidation state for {element} is outside [-8, 8]", str(state))
                )
            states[str(element)] = state
        unknown = sorted(set(amounts) - set(states))
        if unknown:
            findings.append(
                ValidationFinding("warn", "oxidation_state", f"missing oxidation states: {', '.join(unknown)}", formula)
            )
        charge = sum(amounts[element] * states[element] for element in amounts if element in states)
        if not unknown and not math.isclose(charge, 0.0, abs_tol=1e-6):
            findings.append(
                ValidationFinding("error", "charge_neutrality", f"net formal charge is {charge:g}, expected 0", formula)
            )

    return ValidationReport(not any(f.level == "error" for f in findings), findings, {"formula": formula, "amounts": amounts})


def validate_units(values: dict[str, Any]) -> list[ValidationFinding]:
    """Check common material quantities for missing or dimensionally wrong units."""
    findings: list[ValidationFinding] = []
    expected = {
        "band_gap": {"ev", "electronvolt", "eV"},
        "energy_above_hull": {"ev/atom", "ev_atom", "eV/atom"},
        "formation_energy_per_atom": {"ev/atom", "ev_atom", "eV/atom"},
        "lattice": {"angstrom", "ang", "a", "nm"},
        "volume": {"angstrom3", "ang3", "a3", "nm3"},
        "volume_per_atom": {"angstrom3/atom", "ang3/atom", "a3/atom"},
        "density": {"g/cm3", "kg/m3"},
        "total_magnetization": {"mu_b", "bohr_magneton"},
        "pressure": {"gpa", "kbar", "pa"},
        "temperature": {"k", "kelvin", "c", "celsius"},
    }
    for key, allowed in expected.items():
        if key not in values:
            continue
        item = values[key]
        if isinstance(item, dict) and "value" not in item:
            findings.append(ValidationFinding("error", "units", f"{key} has a unit but no numeric value", key))
            continue
        unit = item.get("unit") if isinstance(item, dict) else None
        if not isinstance(unit, str) or not unit.strip():
            findings.append(ValidationFinding("warn", "units", f"{key} has no explicit unit", key))
        elif unit.strip().lower() not in {value.lower() for value in allowed}:
            findings.append(ValidationFinding("error", "units", f"{key} uses unsupported unit {unit!r}", key))
    return findings


def validate_dft_parameters(params: dict[str, Any]) -> list[ValidationFinding]:
    findings: list[ValidationFinding] = []
    normalized = {str(key).upper(): value for key, value in params.items()}
    if "EDIFF" not in normalized:
        findings.append(ValidationFinding("warn", "dft_convergence", "EDIFF is not specified", "INCAR"))
    else:
        try:
            if float(normalized["EDIFF"]) > 1e-3:
                findings.append(ValidationFinding("error", "dft_convergence", "EDIFF is looser than 1e-3 eV", str(normalized["EDIFF"])))
        except (TypeError, ValueError):
            findings.append(ValidationFinding("error", "dft_convergence", "EDIFF is not numeric", str(normalized["EDIFF"])))
    if "EDIFFG" not in normalized:
        findings.append(ValidationFinding("warn", "dft_convergence", "EDIFFG is not specified", "INCAR"))
    else:
        try:
            if abs(float(normalized["EDIFFG"])) > 0.2:
                findings.append(ValidationFinding("warn", "dft_convergence", "EDIFFG force threshold exceeds 0.2 eV/A", str(normalized["EDIFFG"])))
        except (TypeError, ValueError):
            findings.append(ValidationFinding("error", "dft_convergence", "EDIFFG is not numeric", str(normalized["EDIFFG"])))
    if "ENCUT" in normalized:
        try:
            if float(normalized["ENCUT"]) < 300:
                findings.append(ValidationFinding("warn", "dft_convergence", "ENCUT is below 300 eV; verify the pseudopotential recommendation", str(normalized["ENCUT"])))
        except (TypeError, ValueError):
            findings.append(ValidationFinding("error", "dft_convergence", "ENCUT is not numeric", str(normalized["ENCUT"])))
    else:
        findings.append(ValidationFinding("warn", "dft_convergence", "ENCUT is not specified", "INCAR"))
    if not any(key in normalized for key in ("KSPACING", "KPOINTS", "KPOINT_GRID")):
        findings.append(ValidationFinding("warn", "dft_convergence", "no k-point spacing or grid is recorded", "KPOINTS"))
    return findings


def _minimum_distance_from_pymatgen(path: Path) -> tuple[float | None, str]:
    from pymatgen.core import Structure  # type: ignore

    structure = Structure.from_file(path)
    distances = structure.distance_matrix
    nonzero = [
        float(distances[i, j])
        for i in range(len(structure))
        for j in range(i + 1, len(structure))
        if distances[i, j] > 1e-8
    ]
    # Include periodic images of the same site, which an NxN distance matrix
    # omits (important for one-atom primitive cells).
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            for c in (-1, 0, 1):
                if a == b == c == 0:
                    continue
                cartesian = structure.lattice.get_cartesian_coords((a, b, c))
                nonzero.append(math.sqrt(sum(float(component) ** 2 for component in cartesian)))
    return (min(nonzero) if nonzero else None, structure.composition.reduced_formula)


def _minimum_distance_from_ase(path: Path) -> tuple[float | None, str]:
    from ase.io import read  # type: ignore

    atoms = read(path)
    matrix = atoms.get_all_distances(mic=True)
    nonzero = [
        float(matrix[i, j])
        for i in range(len(atoms))
        for j in range(i + 1, len(atoms))
        if matrix[i, j] > 1e-8
    ]
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            for c in (-1, 0, 1):
                if a == b == c == 0:
                    continue
                cartesian = atoms.cell.cartesian_positions((a, b, c))
                distance = math.sqrt(sum(float(component) ** 2 for component in cartesian))
                if distance > 1e-8:
                    nonzero.append(distance)
    return (min(nonzero) if nonzero else None, atoms.get_chemical_formula())


def validate_structure(path: str | Path, min_distance: float = 0.8) -> ValidationReport:
    path = Path(path)
    findings: list[ValidationFinding] = []
    if not path.is_file():
        return ValidationReport(False, [ValidationFinding("error", "structure", "structure file does not exist", str(path))])

    suffix = path.suffix.lower()
    if suffix in {".smi", ".smiles"}:
        try:
            from rdkit import Chem  # type: ignore

            for line_number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                smiles = line.split("#", 1)[0].strip().split(maxsplit=1)[0] if line.strip() else ""
                if smiles and Chem.MolFromSmiles(smiles) is None:
                    findings.append(ValidationFinding("error", "rdkit", "RDKit rejects the SMILES", f"{path}:{line_number}: {smiles}"))
            return ValidationReport(not any(f.level == "error" for f in findings), findings)
        except ImportError:
            findings.append(ValidationFinding("warn", "rdkit", "RDKit is not installed in the materials environment", str(path)))
            return ValidationReport(True, findings)

    try:
        minimum, formula = _minimum_distance_from_pymatgen(path)
        engine = "pymatgen"
    except Exception:
        try:
            minimum, formula = _minimum_distance_from_ase(path)
            engine = "ase"
        except Exception as exc:
            return ValidationReport(False, [ValidationFinding("error", "structure", f"could not parse structure with pymatgen or ASE: {exc}", str(path))])

    if minimum is not None and minimum < min_distance:
        findings.append(ValidationFinding("error", "minimum_distance", f"minimum interatomic distance {minimum:.4f} A is below {min_distance:.4f} A", str(path)))
    return ValidationReport(not any(f.level == "error" for f in findings), findings, {"formula": formula, "minimum_distance_angstrom": minimum, "parser": engine})


def validate_payload(payload: dict[str, Any]) -> ValidationReport:
    findings: list[ValidationFinding] = []
    normalized: dict[str, Any] = {}
    formula = payload.get("formula")
    if isinstance(formula, str):
        formula_report = validate_formula(
            formula,
            payload.get("oxidation_states") if isinstance(payload.get("oxidation_states"), dict) else None,
            payload.get("expected_ratio") if isinstance(payload.get("expected_ratio"), dict) else None,
        )
        findings.extend(formula_report.findings)
        normalized.update(formula_report.normalized)
    if isinstance(payload.get("units"), dict):
        findings.extend(validate_units(payload["units"]))
    if isinstance(payload.get("dft"), dict):
        findings.extend(validate_dft_parameters(payload["dft"]))
    if isinstance(payload.get("structure_path"), str):
        structure_report = validate_structure(payload["structure_path"], float(payload.get("min_distance", 0.8)))
        findings.extend(structure_report.findings)
        normalized["structure"] = structure_report.normalized
    return ValidationReport(not any(f.level == "error" for f in findings), findings, normalized)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a material formula, structure, or DFT payload")
    parser.add_argument("path", nargs="?", help="structure file to validate")
    parser.add_argument("--json", dest="payload", help="JSON validation payload")
    args = parser.parse_args(argv)
    if args.payload:
        result = validate_payload(json.loads(args.payload))
    elif args.path:
        result = validate_structure(args.path)
    else:
        parser.error("provide a structure path or --json payload")
    print(json.dumps(result.to_dict(), indent=2, ensure_ascii=True))
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
