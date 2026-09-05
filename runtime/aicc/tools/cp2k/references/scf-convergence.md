# CP2K SCF Convergence

> Load this when: CP2K SCF is slow, oscillatory, not converged, method-dependent, or needs a deliberate OT/diagonalization/smearing/restart strategy.

## Diagnose the model before tuning SCF

Most SCF failures are not solved by random keyword changes. Check first:

1. Structure: no close contacts, reasonable coordination, intended adsorption/protonation/defect geometry.
2. Cell and electrostatics: correct `PERIODIC`, Poisson solver, vacuum, charge correction, and k-point directions.
3. Charge/spin: `CHARGE`, `UKS`, `MULTIPLICITY`, initial `MAGNETIZATION`, oxidation states, broken-symmetry labels.
4. Basis/potential: every `&KIND` exists, has the intended `ELEMENT`, and matches the intended valence partition.
5. Numerical representation: `CUTOFF`, `REL_CUTOFF`, basis quality, and auxiliary basis are adequate for the property.
6. Restart compatibility: `.wfn` and `.restart` match basis, charge, spin, cell, k-policy, functional, U, hybrid, and ADMM/RI settings.

## Method decision table

| System / task | Starting SCF strategy |
|---|---|
| molecule or large-gap Gamma-only system | OT + `OUTER_SCF` |
| insulating bulk/supercell | OT when compatible; diagonalization if k-point/property requires it |
| metal or small-gap system | diagonalization + smearing + enough `ADDED_MOS` + conservative mixing |
| DOS/PDOS, bands, unoccupied states | diagonalization or version-supported post-SCF empty-state workflow; set `ADDED_MOS` deliberately |
| hybrid/HFX | first converge semilocal, then restart hybrid from `.wfn`; use ADMM/RI-HFX where appropriate |
| DFT+U/magnetic system | correct spin initialization and U/population method before mixing tricks |
| AIMD | robust SCF with modest per-step cost; no repeated nonconverged steps |
| geometry/cell optimization | reliable SCF at the first step before trusting optimizer behavior |

## What convergence means

SCF convergence is the convergence criterion reaching `EPS_SCF`, not merely small-looking energy changes. In CP2K outputs, inspect convergence history, warnings, `MAX_SCF` hits, and whether `OUTER_SCF` actually rescued inner iterations.

Red flags:

- repeated `SCF run NOT converged` messages inside GEO_OPT/MD;
- `MAX_SCF` reached at many optimization steps;
- HOMO-LUMO gap or occupations jump erratically;
- magnetic moment collapses unexpectedly;
- smearing entropy/free-energy term is comparable to the energy difference being reported;
- final energy comes from an emergency fallback rather than a converged SCF.

## OT pattern

```text
&SCF
  EPS_SCF 1.0E-6
  MAX_SCF 30
  SCF_GUESS ATOMIC
  &OT
    PRECONDITIONER FULL_SINGLE_INVERSE
    MINIMIZER DIIS
  &END OT
  &OUTER_SCF
    MAX_SCF 10
    EPS_SCF 1.0E-6
  &END OUTER_SCF
&END SCF
```

Use OT for large-gap systems where it is supported. If OT stalls, try one change at a time:

- compatible restart from a nearby structure;
- `FULL_SINGLE_INVERSE`, `FULL_ALL`, or other version-supported preconditioners;
- `DIIS` versus more robust minimizers for rough starts;
- better initial geometry or short semiempirical/pre-relaxation;
- tighter/cleaner grid if force/density noise is the cause;
- temporary looser thresholds only for an explicitly marked preconditioning run.

OT is usually not the right first choice for metallic smearing, many k-point workflows, or unoccupied-state analysis.

## Diagonalization + smearing pattern

```text
&SCF
  EPS_SCF 1.0E-6
  MAX_SCF 100
  ADDED_MOS 100                # adjust
  &SMEAR
    METHOD FERMI_DIRAC
    ELECTRONIC_TEMPERATURE [K] 300
  &END SMEAR
  &DIAGONALIZATION
    ALGORITHM STANDARD
  &END DIAGONALIZATION
  &MIXING
    METHOD BROYDEN_MIXING
    ALPHA 0.2
  &END MIXING
&END SCF
```

Rules:

- Increase `ADDED_MOS` when empty bands, smearing, metals, DOS/PDOS, or excited-state precursors need them.
- If CP2K warns that Fermi-Dirac smearing needs more MOs, add MOs before interpreting the electronic structure.
- Smearing is a method parameter. Keep it identical across compared energies or use a documented extrapolation protocol.
- If residuals oscillate, reduce mixing strength before increasing `MAX_SCF` indefinitely.
- Do not trust a geometry or MD trajectory containing repeated unconverged SCF steps.

## Mixing choices

Typical order of escalation:

1. Start conservative: small `ALPHA` with Broyden/Pulay-style mixing.
2. Reduce `ALPHA` for oscillations, especially metals and small gaps.
3. Increase `ADDED_MOS` for smeared/metallic systems before blaming the mixer.
4. Revisit k-points and smearing width if occupations jump.
5. Revisit geometry, spin, or U if convergence repeatedly finds the wrong state.

Do not tune mixing to force an electronically wrong state to converge.

## Restart discipline

```text
&DFT
  WFN_RESTART_FILE_NAME previous.wfn
  &SCF
    SCF_GUESS RESTART
  &END SCF
&END DFT
```

Restart only when the wavefunction is compatible. If basis, potential, cell, charge, spin, k-points, functional, U, hybrid, ADMM/RI, or smearing strategy changed, treat the run as a new method and be prepared to discard the old `.wfn`.

Useful restart patterns:

- semilocal → hybrid: good starting point, but final hybrid is a new method;
- nearby geometry step → continuation: good for optimizations and NEB images;
- Gamma → k-point or different basis: generally not a safe wavefunction restart without manual verification.

## Hybrid/HFX escalation

1. Converge the same model with semilocal DFT.
2. Restart hybrid from the semilocal `.wfn`.
3. Use a documented ADMM or RI auxiliary basis for every element if chosen.
4. Check Coulomb truncation/screening radius for periodic systems; keep it identical across compared energies.
5. Tune MPI/OpenMP layout and HFX memory together.
6. For periodic hybrid/k-point workflows, verify version support and exact keywords in the installed manual.

Hybrid red flags:

- `The Kohn Sham matrix is not 100% occupied` warnings during ADMM/HFX workflows;
- HFX ERI memory estimates exceed per-rank memory;
- poor semilocal initial state reused for a different spin/localization state;
- truncation radius too large for the cell.

## Magnetic and DFT+U cases

For transition-metal oxides, radicals, open-shell defects, and broken-symmetry systems, a collapsed nonmagnetic state can look numerically converged but be chemically wrong. Test physically plausible spin initializations and record final local moments/occupations.

Rules:

- Split `&KIND`s when inequivalent atoms of the same element need different initial moments.
- Compare final moments, populations, PDOS, and spin density, not only total energy.
- Changing U value, population method, or magnetic ordering changes the method.
- For hard cases, use DFT+U ramping or occupation constraints only with a clear reason and provenance.

## Optimization and MD-specific SCF

For `GEO_OPT`/`CELL_OPT`:

- get a clean single-point SCF first;
- if early optimization steps are rough, use a compatible restart after a few steps;
- do not accept a final structure if many intermediate steps had unconverged forces;
- `EXTRAPOLATION USE_PREV_P`-style density extrapolation can help continuations but can also hide poor starting guesses.

For MD:

- use a robust, slightly cheaper SCF only after testing energy/temperature behavior;
- repeated nonconverged SCF steps invalidate trajectory averages;
- if SCF is slow at every step, reduce timestep/temperature ramp, fix geometry, or use pre-equilibration rather than loosening physics-critical thresholds indefinitely.

## Escalation ladder

1. Fix model/geometry/cell/electrostatics/charge/spin.
2. Run `cp2k -c` and a cheap single-point smoke test.
3. Check basis/potential library names and `&KIND` mapping.
4. Choose OT or diagonalization based on system type.
5. Add smearing/`ADDED_MOS` only when electronically justified.
6. Use a compatible restart from an easier method or previous step.
7. Adjust mixing conservatively.
8. Tighten grid/basis once the qualitative electronic state is stable.
9. Change one thing per rerun and record it.
