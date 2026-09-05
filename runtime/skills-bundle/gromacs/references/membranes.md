# GROMACS Membranes and Lipids

> Load this when: preparing or validating lipid bilayers, membrane proteins, mixed membranes, cholesterol systems, MARTINI membranes, or membrane-specific analyses.

## Model choices

- Lipid composition, leaflet asymmetry, cholesterol content, ion/salt condition, hydration level, and temperature are scientific inputs.
- Force field must cover all lipids, protein, water, ions, and ligands consistently. Common families include CHARMM36, Slipids, AMBER lipid sets, Berger/GROMOS-style lipids, and MARTINI for coarse-grained systems.
- Builders such as CHARMM-GUI, insane.py, Packmol, VMD/membrane tools, and legacy inflategro/membed workflows produce starting structures; still validate topology, composition, overlaps, and equilibration.

## Setup notes

- The bilayer normal is normally the `z` axis; keep the membrane centered and water on both sides unless the model intentionally differs.
- Use enough water and salt to avoid interactions between periodic images.
- Remove waters or ions placed deep in the hydrophobic core before production unless intentionally modeling permeation.
- Use staged restraints for membrane proteins and lipids when needed; document when restraints are released.
- Mixed and asymmetric membranes often need long equilibration before area, thickness, or diffusion claims.

## Pressure and temperature coupling

Membranes normally require semiisotropic pressure coupling:

```text
pcoupltype      = semiisotropic
ref-p           = 1.0 1.0
compressibility = 4.5e-5 4.5e-5
```

Use force-field-recommended settings where available. Berendsen pressure coupling is acceptable for early equilibration only; use a production barostat that gives meaningful fluctuations when reporting area compressibility or related properties.

Temperature coupling groups should not artificially separate tightly coupled subsystems. Follow the force-field/builder recommendation and document group definitions.

## Validation gates

- Area per lipid and box dimensions plateau after equilibration.
- Bilayer remains centered; leaflets do not collapse or interpenetrate.
- Water/ion density is reasonable outside the membrane and absent from the hydrophobic core unless expected.
- Membrane protein remains inserted with physically reasonable tilt/depth.
- Lipid order and density profiles are computed only from production windows.

## Analyses

| Question | Analysis |
|---|---|
| area per lipid | box `x*y` divided by leaflet lipid count; state leaflet handling |
| thickness/density | `gmx density -d Z` with centering convention |
| tail order | `gmx order` or force-field-specific order-parameter workflow |
| lateral diffusion | `gmx msd -lateral z`; use nojump trajectory and long-time fit |
| protein stability | RMSD/RMSF/tilt/depth after PBC cleanup |
| contacts | lipid-protein minimum distances, contact maps, H-bonds where relevant |

## MARTINI/coarse graining

Coarse-grained systems use larger timesteps and different mapping, elastic networks, and analysis interpretation. Do not compare CG timescales or atomistic observables directly to all-atom results without the model's time-scaling convention and limitations.
