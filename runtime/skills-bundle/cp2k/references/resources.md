# CP2K Resources

> Load this when: a question is not covered by the local references - then fetch/consult the linked source and consider distilling the answer back into the appropriate reference file.

## How to use sources

- **Manual wins for syntax**: keyword paths, defaults, units, and feature support should be checked against the manual version matching the installed CP2K.
- **Exercises are runnable patterns**: use them for workflows and examples, not as universal production defaults.
- **Forum/blog posts are troubleshooting hints**: cross-check them against the manual and local validation before turning them into defaults.
- **Lecture PDFs/manual copies are not committed**: paraphrase distilled rules into topical references and link the source.

## Primary manual sources

- CP2K manual (current trunk): https://manual.cp2k.org/trunk/
- Input reference: https://manual.cp2k.org/trunk/CP2K_INPUT.html
- First calculation: https://manual.cp2k.org/trunk/getting-started/first-calculation.html
- Basis sets: https://manual.cp2k.org/trunk/methods/dft/basis_sets.html
- Pseudopotentials: https://manual.cp2k.org/trunk/methods/dft/pseudopotentials.html
- Cutoff/REL_CUTOFF convergence: https://manual.cp2k.org/trunk/methods/dft/cutoff.html
- K-points: https://manual.cp2k.org/trunk/methods/dft/k-points.html
- SCF input section: https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/DFT/SCF.html
- Poisson/electrostatics input section: https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/DFT/POISSON.html
- Geometry and cell optimization: https://manual.cp2k.org/trunk/methods/optimization/geometry_and_cell_optimization.html
- NEB: https://manual.cp2k.org/trunk/methods/optimization/neb.html
- Molecular dynamics: https://manual.cp2k.org/trunk/methods/sampling/molecular_dynamics.html
- Metadynamics: https://manual.cp2k.org/trunk/methods/sampling/metadynamics.html
- Molecular orbital outputs: https://manual.cp2k.org/trunk/methods/electronic_structure/molecular_orbitals.html
- DOS/PDOS: https://manual.cp2k.org/trunk/methods/electronic_structure/dos.html
- Band structure input section: https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/DFT/PRINT/BAND_STRUCTURE.html
- DFT+U input section: https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/SUBSYS/KIND/DFT_PLUS_U.html
- HFX with ADMM: https://manual.cp2k.org/trunk/methods/dft/hartree-fock/admm.html
- RI-HFX with k-points: https://manual.cp2k.org/trunk/methods/dft/hartree-fock/ri_kpoints.html
- Vibrational analysis input section: https://manual.cp2k.org/trunk/CP2K_INPUT/VIBRATIONAL_ANALYSIS.html
- SCCS input section: https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/DFT/SCCS.html
- TDDFT input section: https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/PROPERTIES/TDDFPT.html
- XAS_TDP input section: https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/DFT/XAS_TDP.html
- XAS from TDDFT tutorial: https://manual.cp2k.org/trunk/methods/properties/x-ray/tddft.html
- NMR input section: https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/PROPERTIES/LINRES/NMR.html
- EPR input section: https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/PROPERTIES/LINRES/EPR.html
- GAPW method: https://manual.cp2k.org/trunk/methods/dft/gapw.html

## Official exercises to mine into examples/references

- CP2K exercises collection: https://www.cp2k.org/exercises
- Input code structure: https://www.cp2k.org/exercises:common:code_structure
- Geometry optimization: https://www.cp2k.org/exercises:common:geo_opt
- PDOS: https://www.cp2k.org/exercises:common:pdos
- Band structure: https://www.cp2k.org/exercises:common:band_structure
- Work function: https://www.cp2k.org/exercises:common:wf
- Charge-density difference: https://www.cp2k.org/exercises:common:chg
- NEB: https://www.cp2k.org/exercises:common:neb
- AIMD: https://www.cp2k.org/exercises:common:aimd
- Metadynamics: https://www.cp2k.org/exercises:common:mtd

## Community troubleshooting

- CP2K user forum: https://groups.google.com/g/cp2k

Forum search workflow:

1. Search the exact error/warning string first.
2. Add method/version terms: `OT`, `DIAGONALIZATION`, `SMEAR`, `ADDED_MOS`, `HSE`, `ADMM`, `RI-HFX`, `DFT+U`, `PLUMED`, `SCCS`, `XAS`, `KPOINTS`.
3. Treat answers as diagnosis candidates, not canonical defaults.
4. Verify any keyword or claimed limitation against the manual version used.
5. Change one thing at a time and record the provenance.

## Chinese tutorials and community notes

- Sobereva CP2K category: http://sobereva.com/category/CP2K/
- Sobereva CP2K visualization tools: http://sobereva.com/739
- Sobereva CP2K SCF convergence: http://sobereva.com/665
- Sobereva CP2K hybrid functional notes: http://sobereva.com/690
- Sobereva CP2K Molden/wavefunction analysis: http://sobereva.com/651
- Sobereva MfakeG: http://sobereva.com/656
- Sobereva sobNEB: http://sobereva.com/660
- Sobereva CP2K density difference/planar average: http://sobereva.com/638
- Sobereva transition states and reaction paths: http://sobereva.com/44
- Sobereva Packmol usage: http://sobereva.com/473
- Sobereva VMD trajectory/RMSD notes: http://sobereva.com/504
- Sobereva STM simulation with Multiwfn: http://sobereva.com/549
- Sobereva CP2K orbital and band visualization notes: http://sobereva.com/269

Treat these as practical Chinese-language entry points. Open the exact article and cross-check before distilling a rule into this skill.

## External tools

- Multiwfn: http://sobereva.com/multiwfn/
- cubecruncher: bundled with many CP2K installations; useful for cube subtraction and planar averages.
- SeeK-path: https://www.materialscloud.org/work/tools/seekpath
- phonopy CP2K interface: use the `phonopy` skill and phonopy documentation for finite-displacement phonons.
- VESTA: https://jp-minerals.org/vesta/en/
- VMD: https://www.ks.uiuc.edu/Research/vmd/
- Packmol: https://m3g.github.io/packmol/

When adding manual or lecture knowledge here, paraphrase into the topical reference file with a link. Do not commit copyrighted manuals, lecture PDFs, or local library copies to the repo.
