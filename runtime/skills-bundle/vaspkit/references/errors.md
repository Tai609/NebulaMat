# VASPKIT Error Recovery

> Load this when: a VASPKIT command fails, hangs in a menu, emits empty data files, or produces scientifically suspicious post-processing output.

Fix one variable at a time and keep the failing log.

| Symptom | Likely cause | Fix |
|---|---|---|
| `vaspkit: command not found` | executable not on `PATH` | load module, activate environment, or call absolute path; record it |
| VASPKIT starts but complains about config | missing or stale `~/.vaspkit` | copy the release's environment template, then edit local paths |
| POTCAR generation fails | pseudopotential root path wrong, permission denied, or species name mismatch | verify `PBE_PATH`/other roots; check POSCAR species names; never bypass with guessed potentials |
| Menu automation hangs | answer sequence does not match installed VASPKIT version | rerun interactively, capture exact prompts, update stdin file |
| DOS/band output is empty | required VASP files missing, non-static run, or incompatible LORBIT/PROCAR settings | confirm DOSCAR/EIGENVAL/PROCAR/vasprun.xml as required; rerun VASP if needed |
| Projected DOS lacks expected orbitals | projection settings were not produced by upstream VASP | check `LORBIT`, RWIGS dependence, and whether PROCAR/vasprun.xml contains projections |
| Band labels look wrong | wrong structure symmetry, conventional/primitive mismatch, or edited KPOINTS | regenerate path from the exact final structure; compare labels with spglib/pymatgen |
| Work function is nonsensical | no vacuum plateau, wrong surface normal, missing dipole correction, or charged slab | inspect LOCPOT profile; verify slab axis and `LDIPOL/IDIPOL` |
| Charge difference has grid errors | CHGCAR files from different cells/grids/orderings | regenerate all components with identical cell, FFT grid, and atom ordering |
| Matplotlib plotting fails | Python path in `~/.vaspkit` lacks numpy/matplotlib | install plotting deps in that interpreter or set plotting off and plot data externally |
| Batch outputs differ from interactive output | default menu choices changed or stdin sequence incomplete | pin VASPKIT version in notes and store the full stdin transcript |

## Escalation

- If a post-processing value matters for a manuscript claim, reproduce the result with an independent parser or a small manual check.
- If VASPKIT and another tool disagree, first compare energy zero, units, atom selection, spin channel, and whether both used the same upstream files.
