# Validating CP2K Calculations

> Load this when: about to submit a CP2K input, deciding whether a finished run is usable, designing convergence tests, or preparing provenance for reported values.

## Preflight before submission

Run:

```bash
uv run __NEBULAMAT_AICC_ROOT__/tools/cp2k/scripts/check_inputs.py input.inp
<CP2K_EXE> -c input.inp
```

The script performs conservative structural checks on the input file:

- `&GLOBAL/RUN_TYPE`, `&FORCE_EVAL/METHOD`, `&SUBSYS/&CELL`, coordinates, and `&KIND` blocks exist.
- Quickstep DFT has basis/potential library names, `&MGRID` with `CUTOFF`/`REL_CUTOFF`, and per-kind basis/potential settings.
- `CELL_OPT` warns if no analytical stress request is present.
- MD warns if `&MOTION/&MD` lacks key length/timestep controls.
- k-point/OT combinations and Gamma-only k-point code paths are surfaced for manual review.

Use `<CP2K_EXE>` for the site-selected binary (`cp2k.sopt`, `cp2k.ssmp`, `cp2k.popt`, or `cp2k.psmp`). For novel workflows, run a cheap smoke test after `<CP2K_EXE> -c`: very loose, short, and explicitly marked as not production. It checks that CP2K parses inputs, libraries are found, the intended executable works, and SCF starts.

## Post-run

Run:

```bash
uv run __NEBULAMAT_AICC_ROOT__/tools/cp2k/scripts/parse_cp2k.py output.out
```

Hard rules:

- `PROGRAM ENDED AT` is necessary but not sufficient.
- Any energy, force, trajectory, DOS, cube, Molden file, or barrier from a failed/unconverged SCF step is not usable.
- A geometry optimization that stops at `MAX_ITER` is not converged unless the convergence criteria are also satisfied.
- A `CELL_OPT` that changes vacuum or the wrong cell component can be technically converged but physically invalid.
- Scientific validity is separate from technical convergence: the relaxed model must still be the intended structure, adsorption state, phase, spin state, charge state, and magnetic ordering.

## Per-task acceptance

| Task | Usable when |
|---|---|
| ENERGY | normal termination; SCF converged; final `ENERGY| Total FORCE_EVAL` recorded with unit; warning summary reviewed |
| GEO_OPT | normal termination; SCF converged at final step; CP2K optimization convergence message present; final structure inspected |
| CELL_OPT | as GEO_OPT plus target pressure/stress policy recorded; vacuum/nonperiodic directions verified; cell changes not caused by unconstrained vacuum collapse |
| Energy differences | identical functional, basis/potential, grid, k-policy, smearing, U/hybrid/ADMM/SCCS/corrections, and compatible cells/reference states |
| DOS/PDOS/bands | upstream ground state converged; empty-state policy recorded; energy zero/alignment stated; version-specific DOS/PDOS/BAND interface checked |
| Molden/Multiwfn | Gamma-only Molden when required; `[Cell]`/pseudopotential valence metadata added if the post-processor needs it; raw and edited files preserved |
| Cubes / CDD | all cubes share cell, grid, origin, stride, geometry policy, charge/spin settings, and sign convention |
| Work function | slab electrostatics converged; planar average has a real vacuum plateau; Fermi level and dipole/electrostatic policy documented |
| Vibrations | stationary optimized structure; tight SCF/force/grid criteria; fake translations/imaginaries investigated before interpretation |
| Phonopy | every displaced force run converged; supercell/displacement/k-policy recorded; acoustic modes and finite-size checked |
| NEB/BAND | endpoints converged with identical settings; images inspected; force criterion met for all replicas; barrier stable after a tighter rerun when needed |
| AIMD/PIMD | no repeated SCF failures; temperature/energy stationary after equilibration; timestep, thermostat/barostat, discarded frames, stride, and analysis window recorded |
| TDDFT/XAS/NMR | ground state converged; version-supported property workflow; basis/potential/core treatment and alignment/shift convention recorded |

## CUTOFF / REL_CUTOFF convergence protocol

Use when the target property is sensitive to grid noise or when setting up a new element/basis/potential family.

1. Pick a fixed high `REL_CUTOFF` such as 60-80 Ry.
2. Scan `CUTOFF` over a reasonable range, e.g. 300, 400, 500, 600, 800 Ry depending on elements and property.
3. Inspect total energy **and** grid distribution (`MULTIGRID INFO`/grid counts when printed). A smooth energy is not enough if important products still sit on very coarse grids.
4. Choose a candidate `CUTOFF` where energy/property changes are below the target tolerance.
5. Fix that `CUTOFF`; scan `REL_CUTOFF`, e.g. 30, 40, 50, 60, 70, 80 Ry.
6. Record `CUTOFF`, `REL_CUTOFF`, basis/potential, total energy, grid counts/distribution, and the property being converged.

Do not blindly push only `CUTOFF` upward. Low `REL_CUTOFF` can keep Gaussian products assigned to coarse grids and cause slow or misleading convergence.

## k-point / supercell convergence

Rules:

- Gamma-only supercell and primitive-cell k-mesh are related but not automatically equivalent for every observable.
- Metals, small gaps, DOS near `E_F`, work functions, and magnetic orderings need explicit k/smearing checks.
- Slabs/2D systems use k-points only in periodic directions.
- If a CP2K method/property does not support the desired k-point workflow, document the Gamma-supercell approximation or choose another engine.

Record k-mesh, symmetry/full-grid settings, number of irreducible k-points, smearing temperature, and whether orbitals/wavefunctions are real or complex.

## Basis/potential convergence

Treat a basis/potential change as a method change. Test basis quality when reporting:

- weak adsorption, surface energies, defect formation energies, and small reaction energies;
- stresses/cell parameters;
- vibrational modes and thermochemistry;
- band gaps, DOS/PDOS, charge localization, DFT+U occupations;
- NMR, XAS, EPR, polarizability, and other response properties.

A larger grid does not compensate for an insufficient Gaussian basis.

## SCF and optimizer convergence

SCF convergence means the SCF objective/residual reached the requested tolerance, not merely that the printed energy changes became small. Watch for:

- repeated `MAX_SCF` hits inside an optimization/MD trajectory;
- `OUTER_SCF` termination without inner convergence;
- suspicious spin/moment collapse;
- smearing entropy/free-energy changes in small energy differences;
- optimizer `MAX_ITER` exits;
- geometry constraints lost during structure conversion.

If an optimizer stalls near the minimum, restart from the latest structure with a compatible `.wfn`, possibly tighter/cleaner SCF and a different optimizer only after inspecting the model.

## Convergence studies to preserve

Treat these as part of the result when the target property is sensitive:

- `CUTOFF` and `REL_CUTOFF`
- basis quality and pseudopotential family
- k-mesh or supercell size
- slab thickness and vacuum
- electrostatic solver/dipole correction for low-dimensional systems
- smearing temperature and `ADDED_MOS` for metals/small gaps
- DFT+U value/population method, hybrid truncation radius, ADMM/RI basis
- MD timestep, cell size, equilibration and production length
- vibrational displacement, finite-difference noise, and phonopy supercell size

## Provenance to preserve

Input file actually run, included files, basis/potential file names and versions, CP2K version, binary, MPI/OpenMP layout, job script/ID, stdout/stderr, `.restart`, `.wfn`, final coordinates/cell, trajectory/restart history, generated DOS/band/cube/Molden files, post-processing commands, plots/scripts, and the parser summary.
