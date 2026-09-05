# LOBSTER Troubleshooting

> Load this when: LOBSTER fails, warns about bands/basis, reports high spilling, or the COHP output looks wrong.

| Symptom | Likely cause | Fix |
|---|---|---|
| LOBSTER aborts: "more bands needed" / projection incomplete | `NBANDS` too small for the basis | rerun the VASP static with larger `NBANDS` (~1.5× the `OUTCAR` default as a first try; follow LOBSTER's warning) |
| High `charge spilling` (> ~5%) | `basisfunctions` don't match the PAW valence, or wrong basis set | match basis to the PAW potential incl. `_sv`/`_pv` semicore; use `pbeVaspFit2015`; only then increase `NBANDS` |
| Garbage / empty COHP, or LOBSTER won't read the wavefunction | gamma-only VASP wavefunction, or PAW≠basis | use a standard (non-gamma) VASP build/output; PAW potentials only |
| Results inconsistent with the geometry | stale `WAVECAR` from incompatible settings / not matching `POSCAR` | delete `WAVECAR`, rerun the static; confirm `WAVECAR`+`POSCAR` are from the same run |
| Symmetry-related projection oddities | `ISYM` left on in the VASP static | set `ISYM=-1` and rerun the static |
| `cohpbetween` syntax rejected | LOBSTER version differs | use the syntax the local version accepts; record the working form in run notes |
| ICOHP values not comparable across systems | different basis sets / PAW valence / pair definitions | re-run with matched settings; never compare across mismatched setups |

## Common red flags (operational)

- Running LOBSTER on an old `WAVECAR` that does not match the final `POSCAR`/`INCAR`.
- Forgetting `ISYM=-1` in the VASP static.
- Treating poor-spilling COHP as quantitative.
- Quoting `-COHP` plots while reporting raw COHP signs without explanation.

(Interpretation pitfalls — comparing unlike pairs, fragment-from-PDOS claims — are in `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md`.)
