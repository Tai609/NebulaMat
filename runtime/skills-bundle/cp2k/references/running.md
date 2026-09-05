# Running CP2K: Templates, Defaults, and Task Rules

> Load this when: setting up any CP2K input — run type, Quickstep GPW/GAPW, basis/potential, CUTOFF/REL_CUTOFF, k-points, SCF, optimization, MD, DFT+U, hybrid/HFX, vibrations, NEB/BAND, or output/provenance policy.

Community-style starting points only. A reproduction target, local benchmark, or site-tested protocol wins. Lines marked `# adjust` are system- and property-dependent.

## Global policies

**Input tree** — CP2K inputs are section trees. The minimum scientific calculation normally has `&GLOBAL`, `&FORCE_EVAL`, `&DFT`, `&SUBSYS`, `&CELL`, `&COORD`, and `&KIND`. `&MOTION` appears when atoms/cell/trajectory/path are moved.

**Quickstep model** — ordinary periodic DFT in CP2K is usually Quickstep GPW: Gaussian orbital basis + auxiliary real-space grids + GTH pseudopotentials. `CUTOFF`/`REL_CUTOFF` converge the grid, not the Gaussian basis-set limit. GAPW/all-electron is a different method and must not be mixed with GPW/GTH energies.

**CUTOFF / REL_CUTOFF** — explicit, never silent. Units are Ry unless stated.

| Use | Starting `CUTOFF` | Starting `REL_CUTOFF` | Notes |
|---|---:|---:|---|
| smoke test | 300 | 40 | parse/library/SCF-start only; never production |
| routine GTH/MOLOPT geometry | 400-600 | 50-60 | check target property and element hardness |
| stresses, cell optimization, phonons, weak energy differences | 600-800 | 60-80 | finite differences and stress amplify grid noise |
| hard potentials, GAPW/all-electron-like setups, high-quality response properties | 800+ | 60-100 | benchmark; do not assume one universal value |

Converge `CUTOFF` and `REL_CUTOFF` separately. Increasing only `CUTOFF` can leave important Gaussian products on too coarse a grid if `REL_CUTOFF` is too low.

**Basis/potential** — every compared energy uses the same basis family, potential family, valence partition (`qN`), auxiliary basis, and grid policy. See `basis-potential.md` before changing a `&KIND`.

**k-points** — use either a Gamma supercell or an explicit `&KPOINTS` calculation; do not silently switch between them.

| System | Starting policy |
|---|---|
| molecule/cluster in a box | Gamma only; no `&KPOINTS` |
| large supercell, liquid, defect supercell, AIMD | Gamma only unless property requires sampling |
| bulk insulator/semiconductor primitive cell | Monkhorst-Pack mesh; converge target property |
| metal/small-gap system | denser mesh + diagonalization + smearing checks |
| slab/2D | k-points only in periodic directions; never along vacuum |

For Gamma-only, omit `&KPOINTS` unless a specific workflow requires the k-point code path. `SCHEME GAMMA` or `MONKHORST-PACK 1 1 1` can be slower than the default Gamma path.

**SCF strategy** — OT is a strong default for insulating Gamma-only systems. Diagonalization + smearing + `ADDED_MOS` is usually safer for metals, small gaps, k-points, DOS/PDOS, bands, and excited-state precursors. Do not use smearing or `ADDED_MOS` as a blind fix for a wrong charge, spin, geometry, or basis.

**Output discipline** — `PROGRAM ENDED AT` is not enough. Preserve `.inp`, `.out`, `.restart`, `.wfn`, final structures, trajectory/path files, generated DOS/band/cube/Molden files, CP2K version, executable, MPI/OpenMP layout, and job script.

## Minimal Quickstep skeleton

```text
&GLOBAL
  PROJECT h2o
  RUN_TYPE ENERGY
  PRINT_LEVEL LOW
&END GLOBAL

&FORCE_EVAL
  METHOD Quickstep
  &DFT
    BASIS_SET_FILE_NAME BASIS_MOLOPT
    POTENTIAL_FILE_NAME GTH_POTENTIALS
    CHARGE 0
    MULTIPLICITY 1
    &MGRID
      CUTOFF 500
      REL_CUTOFF 60
    &END MGRID
    &SCF
      EPS_SCF 1.0E-6
      MAX_SCF 50
    &END SCF
    &XC
      &XC_FUNCTIONAL PBE
      &END XC_FUNCTIONAL
    &END XC
  &END DFT
  &SUBSYS
    &CELL
      ABC 12.0 12.0 12.0
      PERIODIC NONE
    &END CELL
    &COORD
      O  6.0000  6.0000  6.0000
      H  6.7586  6.0000  6.5043
      H  5.2414  6.0000  6.5043
    &END COORD
    &KIND O
      BASIS_SET DZVP-MOLOPT-GTH
      POTENTIAL GTH-PBE-q6
    &END KIND
    &KIND H
      BASIS_SET DZVP-MOLOPT-GTH
      POTENTIAL GTH-PBE-q1
    &END KIND
  &END SUBSYS
&END FORCE_EVAL
```

For isolated molecules, keep `&SUBSYS/&CELL PERIODIC NONE` and `&DFT/&POISSON PERIODIC NONE` consistent. For bulk materials, use `PERIODIC XYZ` and the periodic Poisson solver. For slabs, 2D systems, charged cells, work functions, and SCCS, also load `low-dimensional-electrostatics.md`.

## Execution

Common binaries:

| Binary | Meaning |
|---|---|
| `cp2k.sopt` | serial, optimized |
| `cp2k.ssmp` | serial/OpenMP |
| `cp2k.popt` | MPI |
| `cp2k.psmp` | MPI + OpenMP |

Examples:

```bash
cp2k.ssmp -i input.inp -o output.out
OMP_NUM_THREADS=1 mpirun -np 8 cp2k.psmp -i input.inp -o output.out
<CP2K_EXE> -c input.inp
```

Use `<CP2K_EXE>` for the site-selected binary (`cp2k.sopt`, `cp2k.ssmp`, `cp2k.popt`, or `cp2k.psmp`) when writing portable instructions.

Use `psmp` with fewer MPI ranks and more OpenMP threads when memory per rank is limiting, especially for NEB replicas, vibrational finite differences, hybrid/HFX, and large sparse-matrix work. Always record binary, CP2K version, MPI ranks, `OMP_NUM_THREADS`, and the batch script.

## k-points template

```text
&DFT
  &KPOINTS
    SCHEME MONKHORST-PACK 4 4 4
    WAVEFUNCTIONS COMPLEX
    FULL_GRID F
  &END KPOINTS
&END DFT
```

Rules:

- Do not put k-points along nonperiodic directions.
- Symmetry and full-grid choices can change which k-points are actually evaluated; record them.
- Band paths are not ordinary SCF meshes; use `electronic-analysis.md` for `&BAND_STRUCTURE`.
- k-point support is method- and version-dependent for hybrids, ADMM/RI-HFX, property print sections, and TDDFT/XAS. Verify the installed manual before assuming support or non-support.

## SCF strategy (templates: `scf-convergence.md`)

Pick the SCF approach by system; the `&SCF` templates and the full OT-vs-diagonalization, smearing, mixing, and restart discipline live in `scf-convergence.md` (single source of truth — don't duplicate them here):

- **OT** — efficient for large-gap, Gamma-only systems; *not* the default for metals, smearing, unoccupied-state analysis, or many k-point workflows.
- **Diagonalization + smearing** (`ADDED_MOS`, `&SMEAR`, `&MIXING`) — metals, small gaps, and empty-state properties. If it oscillates, reduce mixing and fix the electronic model before raising `MAX_SCF`; smearing sets an electronic free-energy convention, so keep method/temperature identical across compared energies.
- **Restart** — only from a compatible `.wfn` (same structure/cell class, basis, potential, charge, spin, k-policy, functional family, U/hybrid/ADMM). A semilocal `.wfn` is a useful start for a hybrid, but the hybrid result is a new method.

## Geometry and cell optimization (templates: `geometry-cell-optimization.md`)

Run-type templates, full keyword/convergence sets, constraints, and stationary-point checks live in `geometry-cell-optimization.md`. The decisions:

- **Fixed cell** (`RUN_TYPE GEO_OPT`) is the conservative default and the required choice for slabs/2D — do not relax vacuum thickness unless it is the physical question.
- **Variable cell** (`RUN_TYPE CELL_OPT`, `STRESS_TENSOR ANALYTICAL`) needs a deliberate stress/pressure policy; consider `&CELL_REF` to reduce grid-discontinuity noise as the cell changes.
- **Constraints** — freeze atoms via `&MOTION/&CONSTRAINT/&FIXED_ATOMS`.

After relaxation, run a clean final `ENERGY` calculation with production settings for reported energies/electronic analysis.

## Dispersion corrections

Use one dispersion scheme consistently across one reaction/surface/defect expression. Example D3(BJ) pattern:

```text
&XC
  &XC_FUNCTIONAL PBE
  &END XC_FUNCTIONAL
  &VDW_POTENTIAL
    POTENTIAL_TYPE PAIR_POTENTIAL
    &PAIR_POTENTIAL
      TYPE DFTD3(BJ)
      PARAMETER_FILE_NAME dftd3.dat
      REFERENCE_FUNCTIONAL PBE
      R_CUTOFF [angstrom] 15.0
    &END PAIR_POTENTIAL
  &END VDW_POTENTIAL
&END XC
```

Do not mix D3, D3(BJ), rVV10, nonlocal vdW, or uncorrected energies in one expression unless explicitly benchmarking the correction.

## DFT+U and magnetism

CP2K DFT+U is set on the affected `&KIND`; the population method is selected in `&DFT`:

```text
&DFT
  UKS T
  MULTIPLICITY 5
  PLUS_U_METHOD MULLIKEN
&END DFT
&SUBSYS
  &KIND Fe
    BASIS_SET DZVP-MOLOPT-SR-GTH
    POTENTIAL GTH-PBE-q16
    MAGNETIZATION 4.0
    &DFT_PLUS_U
      L 2
      U_MINUS_J [eV] 4.0
    &END DFT_PLUS_U
  &END KIND
&END SUBSYS
```

Do not copy VASP/QE U values into CP2K without validation. CP2K Gaussian-basis U values and population methods can shift the effective correction substantially. Energies with different U values, spin states, or magnetic orderings are different methods.

## Hybrids, HFX, ADMM, RI-HFXk

- First converge a semilocal calculation with the same structure, basis/potential, charge, spin, and k-policy; restart the hybrid from its `.wfn`.
- For periodic Gamma-only hybrid calculations, a truncated Coulomb interaction is common. The truncation radius must be smaller than half the shortest cell length and kept identical across compared energies.
- Use ADMM only with a documented auxiliary basis for every involved kind.
- `SCREEN_ON_INITIAL_P T` is efficient only with a good starting density/wavefunction.
- HFX memory is per MPI rank; tune `&HF/&MEMORY MAX_MEMORY` and MPI/OpenMP layout together.
- RI-HFX with k-points exists for suitable CP2K versions and workflows. Check the manual for the installed version before repeating older "hybrids cannot use k-points" rules.

## Vibrations, phonons, and thermochemistry

Use `RUN_TYPE VIBRATIONAL_ANALYSIS` only after a tightly optimized stationary structure. Finite differences amplify SCF and grid noise; use tight `EPS_SCF`, converged grid/basis, and stricter force convergence than routine relaxations. For periodic phonons beyond small cells, use the `phonopy` skill with CP2K as the force backend.

## NEB and transition paths

CP2K NEB is controlled by `RUN_TYPE BAND` and `&MOTION/&BAND`; endpoints must be optimized with identical settings before interpolation. Inspect all images before submission. For many replicas, use `psmp` or a site-tested MPI/OpenMP split to manage memory. For reaction-rate interpretation after barriers, read `__NEBULAMAT_AICC_ROOT__/knowledge/reaction-kinetics.md`.

## AIMD and PIMD

```text
&GLOBAL
  RUN_TYPE MD
&END GLOBAL
&MOTION
  &MD
    ENSEMBLE NVT
    STEPS 10000
    TIMESTEP 0.5
    TEMPERATURE 300
    &THERMOSTAT
      TYPE CSVR
      &CSVR
        TIMECON [fs] 200
      &END CSVR
    &END THERMOSTAT
  &END MD
&END MOTION
```

Record timestep, ensemble, thermostat/barostat, discarded equilibration frames, production window, frame stride, and any constraints. Validate temperature/energy stationarity before averaging. PIMD uses `&MOTION/&PINT`; bead count and thermostat choices are scientific parameters.

## Output and restart controls

```text
&GLOBAL
  PRINT_LEVEL LOW
&END GLOBAL
&MOTION
  &PRINT
    &RESTART
      BACKUP_COPIES 2
    &END RESTART
    &RESTART_HISTORY OFF
    &END RESTART_HISTORY
  &END PRINT
&END MOTION
```

Use `&EACH` and `COMMON_ITERATION_LEVELS` only when you understand the output cadence. Long MD, NEB, and optimization jobs can generate very large restart/trajectory/cube outputs if print sections are left at default or `MEDIUM/HIGH` indiscriminately.
