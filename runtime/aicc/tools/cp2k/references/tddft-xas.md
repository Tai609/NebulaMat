# CP2K TDDFT, UV-Vis, and XAS

> Load this when: preparing CP2K excited-state calculations, TDDFT/linear-response spectra, UV-Vis assignments, X-ray absorption spectra, spin-orbit corrected spectra, or orbital/spectrum post-processing.

## Scope

TDDFT/XAS workflows are version- and method-sensitive. Always verify the exact keyword path and limitations against the manual for the installed CP2K version before writing production inputs.

## Workflow

1. Optimize or otherwise define the ground-state structure.
2. Run a converged ground-state single point with the intended functional, basis/potential, charge, spin, U/hybrid/ADMM, and periodicity.
3. Decide the spectrum target: valence excitations, core excitations/XAS, spin-polarized excitations, SOC-corrected spectra, or real-time response.
4. Ensure enough virtual space/`ADDED_MOS` if the method requires unoccupied orbitals.
5. Validate against simpler observables: DOS/PDOS, orbital localization, charge state, spin state, and geometry.
6. Report broadening, energy alignment/shift, oscillator strengths/intensities, selected atoms/edges, and structural model.

## TDDFT / UV-Vis operational pattern

Template shape; verify exact section paths for the installed version:

```text
&PROPERTIES                    # TDDFPT is under &FORCE_EVAL/&PROPERTIES, not &DFT
  &TDDFPT
    NSTATES 20                 # adjust
    MAX_ITER 100
    CONVERGENCE 1.0E-6
    KERNEL FULL                # or version-supported approximation
  &END TDDFPT
&END PROPERTIES
```

Rules:

- Start from a tight ground-state SCF.
- For open-shell systems, record spin treatment and inspect the final ground-state magnetic state.
- For large systems, reduced/scaled TDDFT methods can be useful, but they are approximations and should be named explicitly.
- Spectral broadening, oscillator strengths, and energy shift/alignment are plotting/model choices; preserve the raw sticks.
- Do not claim exact peak positions without calibration or benchmark context.

## sTDA / approximate excited states

Approximate TDDFT variants can be efficient for large systems and screening. Use them when the claim is qualitative, exploratory, or benchmarked for the molecular/material family. Do not mix approximate and full TDDFT spectra in one comparison without stating the method difference.

## XAS operational pattern

For core excitations, decide the edge, absorbing atoms, equivalent-site treatment, and core-hole/response method before writing input. Template shape:

```text
&DFT
  &QS
    METHOD GAPW                # XAS_TDP needs core states from a GAPW ground state
  &END QS
  &LOCALIZE                    # usually needed to make donor core states well-defined
  &END LOCALIZE
  &XAS_TDP
    ELEMENT C                  # adjust absorbing element/edge workflow
    STATE_TYPES 1S             # adjust: 1S, 2P, etc. when supported
    N_SEARCH 20                # adjust
    GRID 150 250               # adjust grid/radial settings when required
    &DONOR_STATES
      DEFINE_EXCITED_BY_INDEX T
      ATOM_LIST 1              # absorbing atoms
    &END DONOR_STATES
  &END XAS_TDP
&END DFT
```

Rules:

- `XAS_TDP` is a core-excitation method; use a GAPW ground state, appropriate all-electron/small-core basis and potential choices, and tight core-state convergence.
- Donor core orbitals should usually be localized, especially for symmetry-equivalent or delocalized core states. Preserve the localization settings and selected donor orbitals.
- XAS peak positions are strongly affected by functional, basis/core treatment, geometry, and energy-shift convention.
- Specify edge, absorbing atom selection, equivalent-site averaging, and whether multiple inequivalent atoms were computed separately.
- If using GW2X or another correction/alignment, record the correction source and whether it shifts only the donor/core state or the whole spectrum.
- For periodic systems, check k-point compatibility for the method/version.
- For spin-polarized or SOC-relevant edges, record spin treatment and state mixing.

## SOC and spin mixing

SOC-corrected TDDFT/XAS workflows can mix singlet/triplet or spin-polarized states. Guardrails:

- First compute and inspect the non-SOC excited states.
- Then apply SOC/state-coupling workflow if supported.
- Report which pre-SOC states enter the SOC calculation and how many states are retained.
- Do not compare SOC and non-SOC intensities or splittings without stating the state-space truncation.

## Spectrum plotting

Preserve:

- raw stick spectrum and transition table;
- broadening function and FWHM/sigma;
- energy shift/calibration value;
- oscillator strength/intensity convention;
- atom/edge/site averaging method;
- script or plotting tool command.

## Guardrails

- Spectra are sensitive to functional, basis, core-hole/response treatment, spin state, geometry, and alignment.
- Do not compare raw peak positions across unrelated computational setups without alignment or calibration.
- For XAS, specify edge, absorbing atom selection, equivalent-site treatment, core-hole or response method, and energy shift convention.
- For periodic systems, k-point support and spectrum print sections can be version-dependent.
- For TDDFT of open-shell systems, record spin treatment and final ground-state magnetic state.
- For solvated/finite-temperature spectra, distinguish a single optimized-geometry spectrum from an ensemble-averaged spectrum.

## Reporting checklist

- CP2K version and exact excited-state method.
- Ground-state convergence and structure source.
- Functional, basis/potential, auxiliary bases if used, charge/spin/U/hybrid/SOC settings.
- Number of states or energy window, convergence threshold, broadening, and energy shift.
- Absorbing atoms/edges for XAS and site averaging.
- Files used for plotting and post-processing commands.
