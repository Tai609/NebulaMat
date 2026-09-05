# Phonopy Troubleshooting

> Load this when: phonopy fails to build force constants, or the spectrum looks wrong.

| Symptom | Likely cause | Fix |
|---|---|---|
| `phonopy -f` fails / wrong number of force files | displacement ↔ run-directory mapping broken, or a force run crashed | re-list disp dirs in order; check every vasprun.xml parses (each run finished) |
| Acoustic branches don't reach 0 at Γ | residual forces in the unrelaxed structure, or inconsistent settings across displacement runs | relax tighter (< 1 meV/Å); verify all displacement INCARs identical |
| Imaginary acoustic pocket near Γ only | numerical noise: supercell too small, EDIFF too loose, LREAL=Auto | EDIFF=1E-8, LREAL=.FALSE., ADDGRID; larger `--dim` |
| Imaginary optical branches across the zone | real instability of the input phase | not an error — follow the eigenvector or report the instability |
| Bands near Γ wrong for an ionic crystal | missing non-analytical correction | BORN file from LEPSILON=.TRUE. run; `NAC = .TRUE.` |
| Spectrum changes a lot with `--dim` | force constants not converged in range | increase supercell until bands stop moving; report the test |
| Symmetry-related error building displacements | input structure symmetry inconsistent (tolerance) | check `--tolerance`; use the symmetrized/primitive cell deliberately |

Most phonon problems are inherited from the force calculations — debug those with `vasp/references/errors.md` first.
