# VASP to CP2K Mapping

> Load this when: translating a VASP workflow, input habit, or reviewer request into a CP2K calculation.

This is a translation aid, not a guarantee of method equivalence. CP2K and VASP use different basis representations, pseudopotentials, grids, SCF algorithms, and output conventions.

## File and input concepts

| VASP | CP2K |
|---|---|
| `INCAR` | single `.inp` section tree: `&GLOBAL`, `&FORCE_EVAL`, `&DFT`, `&SUBSYS`, `&MOTION` |
| `POSCAR` / `CONTCAR` | `&SUBSYS/&CELL` + `&COORD`, or external CIF/XYZ/PDB/restart |
| `POTCAR` | `POTENTIAL_FILE_NAME` plus per-`&KIND` `POTENTIAL` |
| `KPOINTS` | `&DFT/&KPOINTS` |
| `WAVECAR` | `.wfn` / `WFN_RESTART_FILE_NAME` |
| `CHGCAR` | density cube outputs, restart density, CP2K print sections |
| `OUTCAR` / `OSZICAR` | `.out` plus restart/trajectory files |
| `XDATCAR` | CP2K trajectory print files, XYZ/DCD/PDB depending setup |

## Keyword concepts

| VASP concept | CP2K analogue / caution |
|---|---|
| `ENCUT` | `&MGRID CUTOFF`; not a basis-set limit |
| FFT augmentation precision | `REL_CUTOFF`, grids, print/cube grid settings |
| `EDIFF` | `EPS_SCF` |
| `NELM` | `MAX_SCF` |
| `ISMEAR` / `SIGMA` | `&SMEAR METHOD` / `ELECTRONIC_TEMPERATURE` |
| `IBRION`, `NSW`, `POTIM` | `&MOTION/&GEO_OPT`, `&CELL_OPT`, or `&MD` controls |
| `ISIF=2` | fixed-cell `GEO_OPT` |
| `ISIF=3` | `CELL_OPT` with explicit stress policy |
| `ISPIN`, `MAGMOM` | `UKS`, `MULTIPLICITY`, per-kind `MAGNETIZATION`, possibly split `&KIND`s |
| `LDAU*` | `&KIND/&DFT_PLUS_U`, `PLUS_U_METHOD`; U values are not portable |
| `LHFCALC`, HSE | CP2K `&XC/&HF`, screening/truncation/ADMM/RI-HFX as appropriate |
| `LDIPOL`, `IDIPOL` | CP2K electrostatics/Poisson/dipole treatment; verify exact method for the version |
| `LCHARG`, `LAECHG` | CP2K density/cube/population print sections; not identical to PAW charge files |
| `LORBIT`, `DOSCAR`, `PROCAR` | `&DOS`, `&PDOS`, `MO`, `MO_MOLDEN`, `MO_KP`, version-dependent output |
| `ELFCAR`, `LOCPOT` | ELF/potential cube print sections |
| VTST `IMAGES` / `LCLIMB` | CP2K `RUN_TYPE BAND`, `&MOTION/&BAND`, `BAND_TYPE CI-NEB` |

## Method-equivalence warnings

- `ENCUT` and `CUTOFF` are not numerically comparable. CP2K also needs Gaussian basis convergence.
- POTCAR valence and GTH `qN` valence partitions may differ; this affects charges, U, magnetism, and energies.
- VASP U values should not be reused blindly in CP2K.
- VASP PAW charge/Bader workflows do not map one-to-one onto CP2K Gaussian/pseudopotential density outputs.
- Hybrid functional performance and k-point support are code/version dependent.
- For any publication/reproduction, state CP2K settings directly rather than saying "VASP equivalent".

## Translation workflow

1. Identify the VASP scientific task: static, relax, DOS/band, adsorption energy, NEB, AIMD, etc.
2. Map the structure, periodicity, and energy expression first.
3. Choose CP2K basis/potential/grid/SCF settings deliberately.
4. Recreate convergence tests in CP2K; do not reuse VASP numerical thresholds as if equivalent.
5. Validate the CP2K result with CP2K-specific parser/checks and preserve CP2K provenance.
