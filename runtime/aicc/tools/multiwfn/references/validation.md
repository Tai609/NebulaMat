# Validating Multiwfn Results

> Load this when: deciding whether a Multiwfn-derived charge, orbital/NTO plot, spectrum, cube, or scalar-field analysis can support a report or manuscript claim.

Multiwfn validates nothing about the upstream calculation. Start by checking the engine output: normal termination, SCF/opt/freq validity, correct state, and provenance.

## Pre-analysis checks

- Input file contains the required information: basis, orbital coefficients, density/state data, spin data when needed.
- The `.fchk`/`.wfn`/`.molden` comes from the same final calculation being discussed.
- Orbital/state indices are mapped to the upstream output, not chosen by visual appeal.
- Charge/multiplicity and spin treatment match the claim.

## Result checks

| Result | Minimum validation |
|---|---|
| atomic charge table | scheme named; basis/method stated; trend compared under identical settings |
| spin density | open-shell or broken-symmetry state verified; sign convention and isovalue recorded |
| MO/NTO figure | orbital/state index, occupation/transition, isovalue, and phase/color convention recorded |
| TD spectrum | state list, oscillator/rotatory strengths, broadening, conformer weights recorded |
| ESP/ELF/LOL/NCI/IRI/AIM | scalar function, grid/cutoff/isovalue, and interpretation limit stated |
| cube/VMD figure | cube type, isovalue, color sign, camera/render path, and source file recorded |

## Interpretation limits

- Charge schemes are model-dependent. Use charge trends, not isolated absolute values, unless a specific scheme is justified.
- A single scalar field is rarely sufficient for charge transfer or bonding. Pair it with charges, orbital/NTO, spin density, COHP/AIM, or structural evidence as appropriate.
- NCI/IRI/ELF pictures are qualitative unless the chosen metric and region integration are explicitly reported.
- Spectra are sensitive to conformers, broadening, solvent model, functional, and state count.

## Report-ready threshold

A Multiwfn result is report-ready only when the upstream calculation is valid, the analysis path is reproducible, and the claim states exactly what the analysis can and cannot prove.
