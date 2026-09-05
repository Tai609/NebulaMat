# Structure-Prep Troubleshooting

> Load this when: a structure operation fails or produces something suspicious.

| Symptom | Likely cause | Fix |
|---|---|---|
| RDKit `EmbedMolecule` returns -1 | hard 3D embedding (macrocycles, fused systems) | `params.useRandomCoords=True`, more attempts (`maxAttempts=100`); check the SMILES valence first |
| MMFF "missing parameters" | exotic atom types | fall back to UFF (the scripts do); flag that the geometry is rougher |
| CIF loads with occupancy warnings | partially occupied / disordered sites | a calculation needs an *ordered* structure: enumerate orderings (pymatgen `OrderDisorderedStructureTransformation`) or ask which configuration — never silently round occupancies |
| Space group changes with symprec | structure slightly distorted (relaxed coordinates) | report both; use loose symprec (1e-2) for "intended" symmetry, tight (1e-5) for "actual" |
| Slab has odd stoichiometry / is polar | termination choice | enumerate `get_slabs()`, check `is_polar()`; polar slabs need dipole correction downstream or reconstruction — a scientific decision |
| Supercell breaks intended magnetic/defect order | site enumeration after replication | build order *after* the supercell, on enumerated symmetry-distinct sites |
| Converted XYZ lost the cell | XYZ has no lattice by default | use extxyz (`Lattice=` header) or a periodic format (POSCAR/CIF) |
| Adsorbate sinks into / flies off the surface on relaxation | bad initial height | start 1.8–2.2 Å above the site; verify with a distance check before handing off |
| Slab relaxes into something weird / surface atoms grossly undercoordinated | wrong termination cut (picked by list index, not signature) | enumerate `get_slabs()` shifts and select by surface coordination signature (see running.md) |
| Slab doesn't match the paper's "N-layer" model | layer-counting convention mismatch | count metal z-planes and compare thickness to N x d(hkl) before relaxing |
| Hydroxyl/proton placed near a metal cluster ends up as a metal hydride after relaxation | H within ~2 Å of a metal atom at build time — H transfers silently, changing the model's chemical identity while the run still "converges" | at build time check d(H–metal) (keep ≳2.3 Å, tilt the O–H away from the cluster); after relaxation verify the intended bonding topology survived (O–H still intact, H's nearest neighbor unchanged) — technical convergence is not model fidelity |
