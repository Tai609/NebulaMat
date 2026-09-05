---
name: lobster
description: Run LOBSTER to project a plane-wave (VASP) wavefunction onto a local orbital basis and compute COHP/COOP/ICOHP bonding analysis, Mulliken/Loewdin populations, and projected DOS. Use to set up the VASP static that feeds LOBSTER, write lobsterin, run lobster, and check projection (spilling) quality. For the *interpretation* of the bonding numbers, see __NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md.
---

# LOBSTER

LOBSTER reads a VASP wavefunction and projects it onto a local orbital basis to produce
COHP/COOP/ICOHP and population analysis. It is a separate program from VASP (no recompile
needed). This skill covers **operating it**; the **science of reading** COHP/ICOHP is in
`__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md`.

## Required inputs

- A converged VASP static at the geometry of interest, run with the LOBSTER-compatible
  settings below (`ISYM=-1`, `LWAVE=.TRUE.`, enough `NBANDS`, PAW, non-gamma build).
- The atom pairs (or distance/element generator) whose bonding you want, and the basis set.
- LOBSTER version/module and thread count.

## Where to find what

| Situation | Go to |
|---|---|
| prepare the VASP static for LOBSTER, write `lobsterin`, basis matching, run lobster | `references/running.md` |
| spilling/projection-quality checks, output files, reporting checklist | `references/validation.md` |
| stale WAVECAR, missing `ISYM=-1`, basis/PAW mismatch, high spilling, gamma-only | `references/errors.md` |
| official program, manual, basis sets, citation | `references/resources.md` |
| the science — what COHP/ICOHP mean and how to argue a bond-strength claim | `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md` |

## Workflow

1. Run a VASP static with the LOBSTER settings (`references/running.md`); preserve `WAVECAR`/`POSCAR`/`INCAR`.
2. Write `lobsterin` (basis matched to the PAW potential; pairs or generator).
3. Run `lobster` on a compute node (OpenMP).
4. Check `lobsterout` charge spilling before trusting anything (`references/validation.md`).
5. Read the bonding result using `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md`.

## Hard guardrails

- The VASP static must use `ISYM=-1` and a regular (non-gamma-only) wavefunction; PAW potentials only.
- `basisfunctions` must match the PAW valence (include `_sv`/`_pv` semicore when used) — a mismatch shows up as large charge spilling.
- Do not report ICOHP/COHP trends from a run with poor charge spilling without flagging it.
- Compare only like-with-like (same functional, PAW, basis, window, pair definition).
- Never commit `WAVECAR`, `CHGCAR`, `COHPCAR.lobster`, `DOSCAR.lobster`, `projectionData.lobster`, or bulky exports; keep concise run notes and small parsed tables.
