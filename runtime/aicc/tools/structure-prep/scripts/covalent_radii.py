"""Covalent-radius helpers for structure-prep geometry checks."""

from __future__ import annotations

import re
from typing import Any


DEFAULT_CONTACT_RADIUS_SCALE = 0.95

# Pyykko/Atsumi molecular single-bond covalent radii, in Angstrom.
# Source: P. Pyykko and M. Atsumi, Chem. Eur. J. 15, 186-197 (2009),
# doi:10.1002/chem.200800987. The values match the Pyykko single-bond
# column distributed by the periodictable Cordero/Pyykko data table.
PYYKKO_SINGLE_COVALENT_RADII_A: dict[str, float] = {
    "H": 0.32,
    "He": 0.46,
    "Li": 1.33,
    "Be": 1.02,
    "B": 0.85,
    "C": 0.75,
    "N": 0.71,
    "O": 0.63,
    "F": 0.64,
    "Ne": 0.67,
    "Na": 1.55,
    "Mg": 1.39,
    "Al": 1.26,
    "Si": 1.16,
    "P": 1.11,
    "S": 1.03,
    "Cl": 0.99,
    "Ar": 0.96,
    "K": 1.96,
    "Ca": 1.71,
    "Sc": 1.48,
    "Ti": 1.36,
    "V": 1.34,
    "Cr": 1.22,
    "Mn": 1.19,
    "Fe": 1.16,
    "Co": 1.11,
    "Ni": 1.10,
    "Cu": 1.12,
    "Zn": 1.18,
    "Ga": 1.24,
    "Ge": 1.21,
    "As": 1.21,
    "Se": 1.16,
    "Br": 1.14,
    "Kr": 1.17,
    "Rb": 2.10,
    "Sr": 1.85,
    "Y": 1.63,
    "Zr": 1.54,
    "Nb": 1.47,
    "Mo": 1.38,
    "Tc": 1.28,
    "Ru": 1.25,
    "Rh": 1.25,
    "Pd": 1.20,
    "Ag": 1.28,
    "Cd": 1.36,
    "In": 1.42,
    "Sn": 1.40,
    "Sb": 1.40,
    "Te": 1.36,
    "I": 1.33,
    "Xe": 1.31,
    "Cs": 2.32,
    "Ba": 1.96,
    "La": 1.80,
    "Ce": 1.63,
    "Pr": 1.76,
    "Nd": 1.74,
    "Pm": 1.73,
    "Sm": 1.72,
    "Eu": 1.68,
    "Gd": 1.69,
    "Tb": 1.68,
    "Dy": 1.67,
    "Ho": 1.66,
    "Er": 1.65,
    "Tm": 1.64,
    "Yb": 1.70,
    "Lu": 1.62,
    "Hf": 1.52,
    "Ta": 1.46,
    "W": 1.37,
    "Re": 1.31,
    "Os": 1.29,
    "Ir": 1.22,
    "Pt": 1.23,
    "Au": 1.24,
    "Hg": 1.33,
    "Tl": 1.44,
    "Pb": 1.44,
    "Bi": 1.51,
    "Po": 1.45,
    "At": 1.47,
    "Rn": 1.42,
    "Fr": 2.23,
    "Ra": 2.01,
    "Ac": 1.86,
    "Th": 1.75,
    "Pa": 1.69,
    "U": 1.70,
    "Np": 1.71,
    "Pu": 1.72,
    "Am": 1.66,
    "Cm": 1.66,
    "Bk": 1.66,
    "Cf": 1.68,
    "Es": 1.65,
    "Fm": 1.67,
    "Md": 1.73,
    "No": 1.76,
    "Lr": 1.61,
    "Rf": 1.57,
    "Db": 1.49,
    "Sg": 1.43,
    "Bh": 1.41,
    "Hs": 1.34,
    "Mt": 1.29,
    "Ds": 1.28,
    "Rg": 1.21,
    "Cn": 1.22,
    "Nh": 1.36,
    "Fl": 1.43,
    "Mc": 1.62,
    "Lv": 1.75,
    "Ts": 1.65,
    "Og": 1.57,
    # Historical temporary symbols used by the original 2009 data table.
    "Uut": 1.36,
    "Uuq": 1.43,
    "Uup": 1.62,
    "Uuh": 1.75,
    "Uus": 1.65,
    "Uuo": 1.57,
}

_ISOTOPE_ALIASES = {"D": "H", "T": "H"}
_SYMBOL_RE = re.compile(r"(Uu[thopqs]|[A-Z][a-z]?)")


def normalize_element_symbol(text: str | None) -> str | None:
    """Return an element symbol from a species label such as O2-, Pt, or Fe3+."""
    if not text:
        return None
    candidate = _ISOTOPE_ALIASES.get(text, text)
    if candidate in PYYKKO_SINGLE_COVALENT_RADII_A:
        return candidate
    match = _SYMBOL_RE.match(candidate)
    if not match:
        return None
    symbol = _ISOTOPE_ALIASES.get(match.group(1), match.group(1))
    return symbol if symbol in PYYKKO_SINGLE_COVALENT_RADII_A else None


def element_symbol_from_site(site: Any) -> str | None:
    """Best-effort element symbol extraction for pymatgen PeriodicSite objects."""
    specie = getattr(site, "specie", None)
    symbol = normalize_element_symbol(getattr(specie, "symbol", None))
    if symbol:
        return symbol

    species = getattr(site, "species", None)
    if species:
        try:
            dominant = max(species, key=lambda item: species[item])
            symbol = normalize_element_symbol(getattr(dominant, "symbol", str(dominant)))
            if symbol:
                return symbol
        except Exception:  # noqa: BLE001 - disordered site formatting is best-effort.
            pass

    return normalize_element_symbol(getattr(site, "species_string", None) or str(site))


def pyykko_single_radius_A(symbol_or_label: str | None) -> float | None:
    symbol = normalize_element_symbol(symbol_or_label)
    if symbol is None:
        return None
    return PYYKKO_SINGLE_COVALENT_RADII_A.get(symbol)


def covalent_radius_sum_A(symbol_i: str | None, symbol_j: str | None) -> float | None:
    radius_i = pyykko_single_radius_A(symbol_i)
    radius_j = pyykko_single_radius_A(symbol_j)
    if radius_i is None or radius_j is None:
        return None
    return radius_i + radius_j


def covalent_contact_threshold_A(symbol_i: str | None, symbol_j: str | None, scale: float) -> float | None:
    radius_sum = covalent_radius_sum_A(symbol_i, symbol_j)
    if radius_sum is None or scale <= 0:
        return None
    return scale * radius_sum
