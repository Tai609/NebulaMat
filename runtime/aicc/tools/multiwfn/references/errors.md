# Multiwfn Troubleshooting

> Load this when: Multiwfn cannot read a file, outputs strange charges/orbitals, cube files look wrong, or spectra/plots do not match the intended state.

## Common symptoms

| Symptom | Likely cause | Fix |
|---|---|---|
| cannot read Gaussian `.chk` | binary checkpoint is version/platform dependent | convert with `formchk job.chk job.fchk` |
| orbitals missing or wrong count | input file lacks orbital coefficients or is not from final job | regenerate `.fchk` from the intended final checkpoint |
| charge results look absurd | Mulliken with large/diffuse basis, wrong file, or wrong state | use a more robust scheme; verify basis/state/provenance |
| spin density absent | closed-shell input or spin data unavailable | confirm unrestricted/open-shell calculation and use the correct file |
| TD/NTO state mismatch | wrong log/fchk pair or state index shifted | map state number to Gaussian output before analysis |
| cube is blank or tiny | isovalue too high, wrong orbital/state, or wrong scalar | lower isovalue; verify cube type and index |
| VMD colors/signs confusing | sign convention not recorded | explicitly define positive/negative colors and isosurface values |
| spectrum differs from expectation | missing conformers, wrong broadening, too few states, solvent mismatch | reproduce state list, weights, and broadening settings |

## Recovery rules

- Regenerate inputs from the validated upstream calculation rather than editing analysis files by hand.
- Do not change population scheme or isovalue until the file/state provenance is confirmed.
- For figures, inspect both positive and negative isosurfaces when signs matter.
- For spectra, keep a plain text record of all conformer log files and weights.
