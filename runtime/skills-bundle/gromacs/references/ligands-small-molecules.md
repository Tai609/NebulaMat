# Ligands and Small Molecules in GROMACS

> Load this when: adding organic ligands, solvents, ions, cofactors, custom residues, or small-molecule force-field parameters to a GROMACS system.

## Core rule

A `.gro` coordinate file is not a molecular model. A small molecule enters GROMACS only with a compatible topology, atom types, charges, bonded terms, nonbonded terms, and documented parameter source.

## Common parameterization paths

| Path | Use case | Notes |
|---|---|---|
| GAFF/GAFF2 via AmberTools/Antechamber/ACPYPE | many organic ligands with AMBER-style workflows | document charge method, net charge, GAFF version, and conversion tool |
| CGenFF/CHARMM-GUI/ParamChem-style route | CHARMM protein/ligand systems | inspect penalty scores; high penalties need validation or QM fitting |
| ATB/GROMOS route | GROMOS-style systems | ensure water/ion/1-4 conventions match the chosen GROMOS FF |
| OPLS-family route | OPLS systems | do not mix with AMBER/CHARMM bonded and 1-4 conventions |
| manual custom `.itp` | only when parameters are literature/group-approved | record every source term; avoid silent analogy assignments |

## Charges

Charges are method-dependent model parameters, not observables. Record the method and software:

- RESP/ESP-fit variants for AMBER-style workflows;
- AM1-BCC when used by ligand workflows;
- CGenFF/CHARMM charges from the chosen parameter source;
- literature or group-approved charge sets when reproducing a method.

Do not change a molecule's net charge to make `grompp` quiet unless the chemistry supports that state.

## Merging a protein-ligand system

Typical sequence:

1. Prepare protein with `pdb2gmx`.
2. Generate ligand coordinates and `.itp` with the chosen compatible workflow.
3. Merge ligand coordinates into the protein coordinate file.
4. Add ligand `.itp` include before `[ system ]` in `topol.top`.
5. Add the ligand count to `[ molecules ]`.
6. Build index groups for protein, ligand, complex, solvent, and ions.
7. Solvate/ionize, minimize, equilibrate with appropriate restraints, then produce.

Validate atom names/order against the ligand `.itp`; conversion tools can reorder atoms.

## Small-molecule liquids and mixtures

For pure liquids, solutions, and mixtures, Packmol can build initial coordinates. The topology still controls chemistry. Validate:

- molecule counts and composition;
- density after NPT equilibration;
- no severe overlaps before minimization;
- force-field compatibility across all molecule types;
- analysis selections for each species.

## Red flags

- ligand `.itp` from a different force-field family than the protein;
- missing improper/dihedral terms ignored because the run starts;
- ion parameters mixed from another water model;
- high CGenFF penalties accepted without comment;
- metal coordination represented by unvalidated LJ plus arbitrary bonds;
- topology edited by hand without preserving the generator output.
