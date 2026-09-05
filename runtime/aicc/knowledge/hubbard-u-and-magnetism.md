# Hubbard U Values and Magnetic Initialization

> Covers: choosing a Hubbard U value (common literature/database sets and when they apply) and choosing initial magnetic moments / spin orderings — the chemistry behind the parameter choice, not the INCAR syntax.

Tool-agnostic reference and practice. These are **starting points, not universal truth** — for a
reproduction use the source paper's value; for new work state the choice and its origin in every
report. The agent is not bound to these exact numbers; they are a reference to draw from. *How to
set them in VASP* (`LDAU*`, `MAGMOM` syntax, array-length rules) is in `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/u-values-magmom.md`.

## When to apply +U

U corrects self-interaction error for localized d/f electrons (transition-metal oxides, lanthanides,
polarons, defect levels). Apply U on the metal in its **oxidized** environment, usually **not** on a
clean metal. Never mix +U and non-+U total energies in one reaction expression without an explicit
correction scheme. U is method- and property-dependent — a value fitted to oxide formation energies
is not automatically right for band gaps or barriers.

## Common U values (verify against your reference)

Materials Project GGA+U set (fitted to oxide formation energies; applied to oxides/fluorides), d-electrons:

| Element | U (eV) | | Element | U (eV) |
|---|---|---|---|---|
| V | 3.25 | | Co | 3.32 |
| Cr | 3.7  | | Ni | 6.2  |
| Mn | 3.9  | | Mo | 4.38 |
| Fe | 5.3  | | W  | 6.2  |

Other widely used literature values:

- Ce 4f in CeO₂: 4.5–5.0 eV (f-electrons)
- Ti 3d in reduced TiO₂: ~4.2 eV common for polaron/vacancy studies (anatase/rutile, property-dependent; bare PBE often used for stoichiometric TiO₂)
- Cu 3d: rarely +U for metallic Cu; oxides system-dependent

## Magnetic initialization

DFT often relaxes spin to a *local* minimum, and the initial guess decides which one. Convention:
**start from the high-spin formal-oxidation-state moment and let it relax down.**

| Species | initial moment (μB) | | Species | initial moment (μB) |
|---|---|---|---|---|
| Fe³⁺ (d⁵) | 5.0 | | Co²⁺ (d⁷, HS) | 3.0 |
| Fe²⁺ (d⁶) | 4.0 | | Ni²⁺ (d⁸) | 2.0 |
| Mn⁴⁺ (d³) | 3.0 | | V⁴⁺ (d¹) | 1.0 |
| Mn³⁺ (d⁴) | 4.0 | | nonmagnetic | 0.0 (or a small generic kick) |
| Cr³⁺ (d³) | 3.0 | | | |

Practice: compare converged moments against the initialization — if a known magnet collapses to
~0 μB, re-run from high-spin or from a converged magnetic charge density. For antiferromagnetic
orderings, set explicit ± patterns per sublattice and verify the final ordering survived. **Report
converged moments, not initial guesses.** When magnetism is not the point, a simple ferromagnetic
initialization is often more robust than a fragile complex order — but still check the final state.
