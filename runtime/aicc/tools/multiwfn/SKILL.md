---
name: multiwfn
description: Run and interpret Multiwfn wavefunction analyses for molecular quantum-chemistry outputs. Use for fchk/wfn/molden/cube-based orbital plots, population/charge analysis, spin density, NTO and TD-DFT state analysis, electrostatic potential, ELF/LOL/AIM/NCI/IRI-style analyses, spectra post-processing, and VMD/cube handoff.
---

# Multiwfn

Multiwfn is a post-processing and wavefunction-analysis tool. It does not validate the upstream quantum-chemistry calculation; first confirm the Gaussian/ORCA/CP2K/etc. job is converged and scientifically valid.

## Required inputs

- Wavefunction/data file: preferably `.fchk`, `.wfn`, `.wfx`, `.molden`, or cube/grid files.
- Upstream provenance: method, basis, charge/multiplicity, solvent, dispersion, state number when relevant.
- Analysis target: charge, orbital/NTO, spin density, ESP, ELF/LOL, AIM, NCI/IRI, spectrum, or cube export.
- Figure/report target: exploratory, SI-ready, or publication-ready.

## Where to find what

| Situation | Go to |
|---|---|
| choosing and running common Multiwfn analyses | `references/running.md` |
| orbital/NTO, charge, spin density, ESP/ELF/NCI/IRI, UV/ECD spectrum workflows | `references/orbital-charge-spectra.md` |
| checking whether a Multiwfn result is usable | `references/validation.md` |
| bad input file, missing orbitals, cube/rendering problems, strange charges | `references/errors.md` |
| official manual, Sobereva tutorials, VMD/cube-related resources | `references/resources.md` |
| figure strategy and quality floor | `__NEBULAMAT_AICC_ROOT__/knowledge/scientific-visualization.md` |
| charge/bonding interpretation | `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`, `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md` |
| TD-DFT state interpretation | `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-qc-practical-rules.md` and `__NEBULAMAT_AICC_ROOT__/tools/gaussian/references/td-dft.md` |

## Workflow

1. Validate the upstream calculation with the engine skill.
2. Convert/check the input file, e.g. Gaussian `.chk` -> `.fchk` using `formchk`.
3. Choose the narrow analysis path from `references/orbital-charge-spectra.md` or `references/running.md`.
4. Record menu path/options, file provenance, isovalues/cutoffs, grid settings, and state/orbital indices.
5. Interpret with the relevant `__NEBULAMAT_AICC_ROOT__/knowledge/` file; do not overclaim from a single population or picture.

## Hard guardrails

- Mulliken charges are quick diagnostics, not robust evidence, especially with large/diffuse basis sets.
- A molecular orbital picture is not a population analysis; an isosurface is not a charge-transfer magnitude.
- NTOs are preferred over raw orbital-transition lists for mixed TD-DFT states.
- Every figure must record file source, isovalue/cutoff, sign/color convention, and state/orbital index.
- Do not use Multiwfn output to rescue an unconverged or wrong-state upstream calculation.
