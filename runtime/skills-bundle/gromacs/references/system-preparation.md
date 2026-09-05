# GROMACS System Preparation

> Load this when: turning molecular structures into a solvated/ionized GROMACS system, including proteins, nucleic acids, ligands, mixtures, interfaces, membranes and simple nanomaterials.

## Decide the model first

Before running a converter, record:

- biological assembly, chain set, model number, alternate locations, crystallographic waters/ions/ligands to retain;
- missing residues/atoms and whether they are rebuilt, capped or deliberately absent;
- protonation/tautomer states, termini, disulfides, metal coordination and covalent cofactors;
- composition, concentration, phase/interface geometry, temperature and pressure;
- periodicity and the observable that sets the minimum system size.

A syntactically valid PDB is not necessarily a chemically complete simulation model. Preserve the unedited source and write derived structures to new files.

## Standard biomolecular route

```bash
# Generate biomolecular topology; choose force field/water interactively or from a reproduced protocol.
gmx pdb2gmx -f input.pdb -o processed.gro -p topol.top -i posre.itp

# Choose a box suitable for the solute-image separation and observable.
gmx editconf -f processed.gro -o boxed.gro -bt dodecahedron -d <edge_distance_nm>

# Add force-field-compatible water.
gmx solvate -cp boxed.gro -cs spc216.gro -o solvated.gro -p topol.top

# Build a temporary run input so genion can replace complete solvent molecules.
gmx grompp -f ions.mdp -c solvated.gro -p topol.top -o ions.tpr -po ions-mdout.mdp -pp ions-processed.top
gmx genion -s ions.tpr -o ionized.gro -p topol.top -pname <CATION> -nname <ANION> -neutral -conc <MOLARITY>
```

During `genion`, select a solvent group containing complete replaceable molecules. Re-run topology/count preflight after ion insertion.

## `pdb2gmx` decisions to record

- selected force-field directory and water model;
- N/C termini for every chain;
- histidine and other ambiguous protonation states;
- automatically detected special bonds, especially disulfides;
- ignored/renamed atoms or residues;
- total charge reported by the generated topology.

Use `-ignh` only when existing hydrogens are not trusted and `pdb2gmx` should regenerate them. Use `-ter` when chain termini require explicit choices. For non-standard residues, add a documented project-local residue definition or parameterize separately; do not silently edit a shared installation.

## Ligands and cofactors

`pdb2gmx` is a residue-template builder, not a universal small-molecule parameterizer. For every non-standard molecule:

1. establish intended bond order, protonation, stereochemistry, net charge and multiplicity;
2. choose a parameterization route compatible with the host force field;
3. inspect atom types, charges, missing bonded terms, impropers and total charge;
4. include any new `[ atomtypes ]` before the molecule definition using them;
5. append coordinates in the same molecule-block order used in `[ molecules ]`;
6. generate molecule-local restraints if equilibration restrains the ligand.

```bash
gmx genrestr -f ligand.gro -n ligand.ndx -o posre_ligand.itp
```

Place the restraint include inside the ligand molecule topology, guarded by a macro such as `POSRES_LIGAND`.

## Mixtures, droplets, interfaces and membranes

`gmx insert-molecules` changes coordinates only; it does not create force-field parameters or update `[ molecules ]` for you unless the relevant topology step is explicit.

```bash
gmx insert-molecules -f host_box.gro -ci solute.gro -nmol <N> -try <ATTEMPTS> -o mixed.gro
```

Packmol is useful for mixed solvents, liquid-liquid interfaces, droplets, shells and oriented layers. Its common coordinate unit is angstrom, whereas GROMACS `.gro` coordinates are nm. After packing, convert once, verify the box numerically, preserve molecule blocks in a known order, and write `[ molecules ]` in that order.

For membranes, put the bilayer in the `xy` plane with the normal along `z`, remove waters trapped in the hydrophobic core as complete molecules, and use semi-isotropic pressure coupling unless the source protocol specifies otherwise. Mixed membranes require substantially longer lateral equilibration than a small soluble protein.

For vacuum/interface systems, do not use ordinary isotropic pressure coupling along a vacuum direction. Verify slab/droplet separation from periodic images and treat long-range electrostatics/dispersion as part of the scientific model.

## Index groups and restraints

```bash
gmx make_ndx -f ionized.gro -o index.ndx
```

Groups are used for analysis, coupling, freezing, restraints, pulling and selections. Prefer physically meaningful, non-overlapping temperature groups; do not create one tiny heat bath per ion or molecule.

Position restraints, constraints and freezing are different:

- **constraint**: removes a bonded degree of freedom and affects the timestep/integrator;
- **position restraint**: adds a bias relative to reference coordinates;
- **freeze group**: removes specified Cartesian motion and can complicate pressure/virial interpretation.

Record the restraint schedule and the reference-coordinate file passed to `grompp -r`.

## Carbon materials and simple networks

`gmx x2top` can infer connectivity only when a suitable `.n2t` mapping and neighbor geometry exist. It is appropriate for simple well-defined networks, not a general force-field generator.

```bash
# Finite object: prevent accidental bonding across PBC.
gmx x2top -f finite_cnt.gro -o cnt.top -ff select -nopbc -name CNT

# Periodic sheet: omit -nopbc only when the box exactly matches the lattice repeat.
gmx x2top -f periodic_sheet.gro -o sheet.top -ff select -name SHEET
```

Inspect every generated bond and atom type. A periodic sheet with a mismatched cell can acquire seams or missing cross-boundary bonds.

## Handoff checklist

Deliver: source structure, cleaned structure, final coordinate file, `topol.top` and every included `.itp`, index/restraint files, force-field and parameter provenance, build commands, molecule counts, net charge, box vectors and unresolved assumptions.
