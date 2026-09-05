# CP2K Error Recovery

> Load this when: CP2K crashes, prints warnings, fails SCF, runs out of memory, or finishes with suspicious output.

Use the exact warning/error string from the output. Change one thing at a time and record it.

## First checks

1. View the structure with cell and periodic images; fix close contacts, wrong charge/spin, wrong periodicity, and inconsistent units first.
2. Confirm basis/potential/parameter files exist and every `&KIND` has the intended basis, potential, `ELEMENT`, and valence partition.
3. Check whether a previous `.wfn` or `.restart` is compatible with the current basis, cell, charge, spin, k-policy, functional, U, hybrid, and ADMM/RI settings.
4. Check `CELL PERIODIC`, `POISSON PERIODIC`, and k-point directions for molecules, slabs, 2D/1D systems, and charged cells.
5. Run `<CP2K_EXE> -c input.inp` before spending queue time, using the site-selected `cp2k.sopt`, `cp2k.ssmp`, `cp2k.popt`, or `cp2k.psmp` binary.

## Common symptoms

| Symptom / grep target | Likely cause | Fix |
|---|---|---|
| `SCF run NOT converged` / no SCF convergence line | bad initial density, metal/small gap, wrong spin/charge, poor geometry | restart from compatible `.wfn`; increase `MAX_SCF` only to diagnose; choose OT for large-gap Gamma systems or diagonalization+smearing+mixing for metals |
| SCF residual oscillates | charge sloshing, mixing too aggressive, metallic state | reduce mixing `ALPHA`; use Broyden/Pulay mixing; add smearing and `ADDED_MOS`; check cell/k-points/electrostatics |
| OT fails or complains with k-points/added MOs/smearing | method mismatch | use diagonalization for k-points, metallic/small-gap systems, smearing, and empty-state properties |
| `Cholesky` / overlap matrix / linear dependence | diffuse basis, bad geometry, near-duplicate atoms | inspect distances; use a less diffuse basis; remove duplicate atoms; tighten grid only after structure is sane |
| missing basis or potential | wrong file path or `&KIND` name | set `BASIS_SET_FILE_NAME` / `POTENTIAL_FILE_NAME`; make kind names match coordinates; use `ELEMENT` for split kind names |
| missing xTB/DFTB parameter file | parameter path not installed or wrong working directory | archive the parameter set; use absolute/project-relative paths; verify element-pair coverage |
| `DFT+U energy contribution is negative` | unphysical population from chosen U/method or bad state | inspect occupations; try Lowdin vs Mulliken only as a documented method change; revisit spin, oxidation state, and U |
| hybrid/HFX out of memory | too many ranks, HFX matrix/storage too large | use `psmp` with fewer MPI ranks; set `&HF/&MEMORY MAX_MEMORY`; use ADMM or screened/truncated HFX where scientifically valid |
| hybrid SCF unstable with `SCREEN_ON_INITIAL_P` | poor initial density | run semilocal first with same basis/cell/spin, then hybrid from `.wfn`; disable screening for initial diagnosis |
| `Kohn Sham matrix is not 100% occupied` in HFX/ADMM context | virtual/occupation/ADMM setup may be inconsistent | check `ADDED_MOS`, occupation, ADMM basis, and method notes; do not ignore for band-gap/electronic claims |
| `CELL_OPT` gives odd vacuum/cell collapse | unconstrained nonperiodic direction | use fixed-cell `GEO_OPT`, constrain cell components, or explicitly justify relaxing that direction |
| optimization reaches `MAX_ITER` | not converged, or forces noisy | restart from final `.restart`; tighten SCF/grid if force noise; switch optimizer only after checking structure |
| fake imaginary frequencies | loose opt/SCF/grid, not a stationary point | re-optimize tighter; increase grid/basis; inspect mode before calling it chemistry |
| NEB images explode or atoms cross | bad interpolation/endpoints | recheck endpoints, atom order, and constraints; rebuild images; inspect all replicas; consider sobNEB/IDPP-style preconditioning |
| `.bs`/band file contains repeated blocks | printed during optimization or multiple geometry steps | use a clean single-point band run; do not plot appended optimization-band data blindly |
| `.pdos` or DOS plot looks shifted/wrong | Hartree/eV conversion, Fermi/HOCO alignment, smearing, or broadening issue | state energy zero; convert units; use consistent convolution width and spin convention |
| charge-density difference has nonsense features | mismatched cube grids/origins/cells/fragment geometry | regenerate all cubes with identical cell/grid/stride/settings; subtract with a reproducible command |
| work-function profile has no flat vacuum plateau | insufficient vacuum, wrong electrostatics, dipole issue, asymmetric slab | increase/converge vacuum; inspect planar average; document dipole correction and slab side |
| `Index to radix array not found` or FFT/grid errors in low-dimensional cells | incompatible grid/cell/FFT lengths or too small vacuum | adjust cell/grid; check `EXTENDED_FFT_LENGTHS` or version-specific manual guidance |

## SCF escalation

Use the smallest change that addresses the observed behavior:

1. Fix the model: structure, cell, charge, spin, multiplicity, coordination, oxidation state.
2. Fix electrostatics: PBC, Poisson, vacuum, dipole/countercharge/solvation model.
3. Restart from a compatible converged lower-level `.wfn`.
4. For Gamma-only insulators: OT with `OUTER_SCF`; try a different OT preconditioner/minimizer.
5. For metals/small gaps/k-points: diagonalization, smearing, enough `ADDED_MOS`, and conservative mixing.
6. For magnetic systems: initialize a physically plausible spin state; test alternative magnetic orderings if the result matters.
7. For difficult slabs/charged systems: revisit Poisson/periodicity and dipole/countercharge choices.
8. If a fix changes the physical method (smearing temperature, U, functional, basis, k-policy, electrostatics), treat the rerun as a new method for comparisons.

## Forum search workflow

Use the CP2K Google Group when the exact error string is not covered locally or the failure is version-specific.

Search strategy:

1. Search the exact warning/error text first.
2. Add CP2K version and method terms: `OT`, `DIAGONALIZATION`, `SMEAR`, `ADDED_MOS`, `HSE`, `ADMM`, `RI-HFX`, `DFT+U`, `PLUMED`, `SCCS`, `XAS`, `KPOINTS`, `DFTB`, `xTB`.
3. Treat forum answers as diagnostic candidates, not canonical settings.
4. Cross-check any keyword/path/default against the manual for the installed version.
5. Change one thing at a time and record provenance.

## Version-dependent features

CP2K changes quickly. Before declaring a feature unsupported, check the manual for the installed version. This matters for k-point hybrids, DOS/PDOS output formats, DFT+U variants, TDDFT/XAS, SCCS, NMR, xTB/DFTB, and advanced print sections.
