# Multiwfn Orbital, Charge, Spin, and Spectra Workflows

> Load this when: using Multiwfn for molecular orbital/NTO plots, population analysis, spin density, ESP/ELF/NCI/IRI fields, UV/ECD spectrum post-processing, or Gaussian-to-VMD cube workflows.

Keep the upstream calculation valid first. Multiwfn analyzes a wavefunction/grid; it does not decide whether the electronic state, geometry, or method is correct.

## Input choice

| Input | Use |
|---|---|
| `.fchk` | default for Gaussian orbital, density, spin-density, ESP, and many population analyses |
| `.wfn` / `.wfx` | topology/AIM-style analyses when wavefunction format is required |
| `.molden` | cross-code orbital analysis when Gaussian fchk is unavailable |
| `.cube` | scalar fields and rendered isosurfaces; often used with VMD |
| Gaussian `.log` | TD-DFT state list, oscillator/rotatory strengths, spectra inputs |

Gaussian handoff:

```bash
formchk job.chk job.fchk
Multiwfn job.fchk
```

## Frequent analyses

| Target | Preferred evidence | Notes |
|---|---|---|
| radical / broken-symmetry localization | spin density | for Gaussian fchk, Multiwfn main menu `5` -> `5` is a common spin-density cube path |
| TD-DFT state assignment | NTOs, hole-electron analysis, density difference | prefer over raw orbital-transition lists for mixed states |
| charge trend | Hirshfeld/ADCH/NPA-like scheme where available | Mulliken is only a quick diagnostic |
| charge transfer | charge scheme + density difference/NTO + structural/energetic context | do not infer magnitude from a picture alone |
| orbital figure | MO or NTO cube/isosurface | record orbital/state index, occupation/contribution, isovalue |
| ESP | ESP mapped on density isosurface or cube | useful for qualitative electrophilic/nucleophilic regions, not a charge proof |
| ELF/LOL/NCI/IRI/AIM | scalar/topology analysis | record grid/cutoff/isovalue and interpretation limit |
| UV/ECD spectrum | weighted TD log list, broadening settings | conformer weights matter, especially for ECD |

## TD-DFT state reading

- Closed-shell Gaussian TD coefficients are effectively normalized to 0.5 for spin-combined transitions; a rough contribution estimate is `2*C^2*100%`.
- Open-shell TD outputs spin channels explicitly; use `C^2*100%` for the listed spin transition.
- Use NTOs or hole-electron analysis when several transitions contribute strongly.
- For CT/LE labels, inspect where the hole and electron densities are located; do not label by HOMO/LUMO numbers alone.

## Figure records

Every figure/table generated through Multiwfn should keep:

- source file and upstream log;
- method, basis, solvent, charge/multiplicity, state/orbital index;
- Multiwfn version and menu path/options;
- isovalue/cutoff/grid/broadening/population scheme;
- sign/color convention and whether the plotted object is MO, NTO, density, spin density, ESP, ELF, NCI/IRI, or density difference.

## Stop conditions

Do not proceed to interpretation when:

- upstream Gaussian job did not terminate normally or did not pass the relevant validation;
- the fchk/log pair comes from different jobs;
- the state index in Multiwfn cannot be mapped back to Gaussian output;
- the claim requires quantification but only a qualitative isosurface is available.
