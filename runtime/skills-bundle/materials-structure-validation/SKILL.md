---
name: materials-structure-validation
description: Validate material formulas, oxidation states, charge neutrality, ratios, units, and structures deterministically with pymatgen, ASE, and RDKit.
---

# Materials structure validation

Run deterministic checks through `materials-mcp.validate_material` or
`validate_structure_file`. The model may propose a structure, but it may not
override a validation error by reasoning from memory.

## Required checks

- Parse the formula with pymatgen `Composition` when available.
- Check declared oxidation states and the formal charge sum. Missing states are
  warnings; a non-zero charge is an error unless the payload explicitly marks a
  charged defect/supercell.
- Compare element ratios against the declared target without silently reducing
  or dropping elements.
- Require explicit compatible units for band gap, formation energy per atom,
  energy above hull, lattice/volume, pressure, and temperature.
- Parse CIF/POSCAR/XYZ with pymatgen, falling back to ASE, and reject a
  candidate whose periodic nearest-neighbour distance is below 0.8 Angstrom
  unless a user-approved threshold is recorded.
- Validate SMILES with RDKit sanitization when the artifact is molecular.

## DFT gate

Record `EDIFF`, `EDIFFG`, `ENCUT`, and a k-point spacing/grid. Screening defaults
are `EDIFF <= 1e-3 eV`, `abs(EDIFFG) <= 0.2 eV/Angstrom`, and a recorded k-point
choice. Missing criteria remain warnings and do not become silent defaults.

Return the complete `ValidationReport` with parser/backend provenance. Do not
edit the user's source structure automatically; write a separate corrected
artifact if a repair is explicitly requested.
