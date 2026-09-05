# GROMACS Biomolecular Systems

> Load this when: preparing proteins, nucleic acids, standard residues, termini, protonation states, disulfides, cofactors, or biomolecular trajectory analyses.

## Intake decisions

- PDB source and biological assembly: record chain IDs, missing residues, alternate locations, ligands, waters, ions, cofactors, and mutations.
- Protonation: pH target, histidine tautomers/protonation, termini, acidic/basic residues, and any tool used (for example PROPKA/H++/PDB2PQR-style evidence).
- Disulfides and covalent links: confirm from structure/evidence; do not rely only on distance.
- Force field and water model: choose a compatible pair, e.g. AMBER-family, CHARMM-family, OPLS, or GROMOS with its recommended water/ion treatment.

## `pdb2gmx` use

`pdb2gmx` is appropriate for standard proteins/nucleic acids covered by the selected force field. It is not a ligand/cofactor parameterizer.

Common command shape:

```bash
gmx pdb2gmx -f clean.pdb -o processed.gro -p topol.top -i posre.itp -water tip3p
```

Options such as `-ignh`, `-ter`, `-inter`, and chain handling are useful but version-dependent. Record the interactive choices or command-line selections, especially termini, histidines, and disulfides.

## Protein workflow notes

- Clean the input PDB without deleting scientifically relevant heteroatoms.
- Decide whether crystallographic waters or ions are retained before solvation.
- Keep position restraints for staged equilibration when needed; production restraints must be justified.
- Use separate analysis groups for fitting and measuring: for example fit backbone, measure ligand/protein RMSD separately.

Common analyses:

| Question | GROMACS analysis |
|---|---|
| structural drift | `gmx rms` after PBC cleanup and fitting |
| residue flexibility | `gmx rmsf` |
| compactness | `gmx gyrate` |
| H-bond network | `gmx hbond` |
| solvent exposure | `gmx sasa` |
| secondary structure | `gmx dssp` or version-appropriate DSSP workflow |
| Ramachandran behavior | `gmx rama` |
| representative conformers | `gmx cluster` with recorded cutoff/method |

## Nucleic acids

DNA/RNA simulations are sensitive to ion model, salt concentration, water model, and force-field family. Record strand sequence, terminal treatment, helix form/starting model, cation placement, and any restrained equilibration. Analyze RMSD/RMSF, base-pair parameters, H-bonds, ion distributions, and major/minor groove changes with explicit selection definitions.

## Cofactors, metals, and nonstandard residues

If a residue is not in the force-field database, route it like a ligand or custom residue. Metal centers, covalent inhibitors, post-translational modifications, and redox-active cofactors are scientific choices, not formatting errors. Record charge/spin/coordination assumptions and consider QM/MM or electronic-structure tools when classical parameters are not defensible.
