# Running Multiwfn: Compact Workflow Notes

> Load this when: choosing a Multiwfn analysis, preparing `.fchk`/`.wfn`/`.molden` input, exporting cube files, or post-processing Gaussian TD-DFT outputs.

Keep this operational. The science of what a charge/orbital/bonding claim means lives in `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`, `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md`, and `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-qc-practical-rules.md`.

## Input preparation

Gaussian checkpoint handoff:

```bash
formchk job.chk job.fchk
Multiwfn job.fchk
```

Use `.fchk` when possible: it carries basis and orbital coefficients in a portable text form. `.wfn`, `.wfx`, `.molden`, and cube/grid files are also acceptable when they contain the data required by the target analysis.

## Analysis routing

| Target | Multiwfn use | Notes |
|---|---|---|
| molecular orbital isosurface | load `.fchk`, choose orbital/grid/cube or built-in render path | record orbital index, occupation, isovalue |
| spin density | spin-density grid/cube analysis | for radicals, broken-symmetry singlets, open-shell localization |
| atomic charges | population-analysis menu | prefer NPA/Hirshfeld/ADCH-style schemes over Mulliken for claims |
| TD-DFT state assignment | NTO / hole-electron / transition-density analyses | use when Gaussian transition list is mixed |
| UV/ECD spectrum plotting | load TD log(s) or weighted list if supported | record broadening and conformer weights |
| ESP/ELF/LOL/NCI/IRI/AIM | scalar-field or topology analysis | record function, grid, isovalue/cutoff, color convention |
| VMD rendering | export cube files and VMD script/path | record isovalue, sign convention, and state/orbital |

## Minimal records

Every Multiwfn-derived result should preserve:

- input file path and upstream calculation log;
- method, basis, charge/multiplicity, solvent, state/orbital index;
- Multiwfn version and menu path/options;
- grid spacing, isovalue, cutoff, broadening, or population scheme as applicable;
- output files: cube, image, table, spectrum, or text excerpt.

## Common Gaussian handoffs

- Orbital / spin-density / ESP / NTO analysis: `.chk` -> `.fchk` first.
- TD-DFT spectrum or ECD: keep Gaussian `.log` plus conformer weights if averaging.
- Density-difference or cube rendering: export named cube files and record whether the cube is MO, density, spin density, ESP, ELF, NCI/IRI, etc.
