# GROMACS Liquids, Solutions, and Interfaces

> Load this when: simulating water, organic liquids, mixtures, solvation, liquid-vapor interfaces, solution-vapor interfaces, droplets, or molecular materials with GROMACS.

## Building

- Use a force field intended for the molecule class and target property. Liquid density, diffusion, dielectric behavior, viscosity, and interfacial tension are not all optimized by the same model.
- Packmol is useful for initial boxes and mixtures; GROMACS topology must still match molecule counts.
- For interfaces, make the box large enough in the surface-normal direction and define whether the interface is liquid-vapor, solution-vapor, liquid-liquid, or solid-liquid.
- For droplets or slabs, ensure PBC and pressure coupling match the intended geometry; isotropic NPT is often wrong for an interface.

## Water and solvent model discipline

Water models are part of the force field. TIP3P, SPC, SPC/E, TIP4P-family, TIP5P, polarizable, and coarse-grained waters target different properties and may require different ion parameters. Do not swap water models after topology generation without checking compatibility.

## Common properties

| Property | GROMACS path | Validation |
|---|---|---|
| density | `gmx energy` for bulk density; `gmx density` for profiles | NPT or profile plateau, correct molecular mass/count |
| RDF/coordination | `gmx rdf` | atom selections, bin width, cutoff integration |
| hydrogen bonds | `gmx hbond` | donor/acceptor definitions, geometric criteria |
| diffusion | `gmx msd` | nojump trajectory, long-time fit window, dimensionality |
| dielectric/current | `gmx dipoles` or version-appropriate current/dipole workflow | long trajectories, correct charge model |
| heat capacity/compressibility | energy/volume fluctuations | correct ensemble and thermostat/barostat |
| surface tension | pressure tensor route | interface geometry, long sampling, tensor convention |
| viscosity | Green-Kubo or periodic perturbation workflow | long sampling and uncertainty; very noisy |

## Liquid interfaces

For slab density profiles:

```bash
gmx trjconv -s md.tpr -f md.xtc -o centered.xtc -pbc mol -center
gmx density -s md.tpr -f centered.xtc -d Z -sl 200 -o density_z.xvg
```

Record which group was centered and whether the profile is averaged over one or two interfaces. Avoid isotropic pressure coupling for a liquid-vapor slab unless the method explicitly justifies it.

## Nanomaterials and surfaces

GROMACS can carry coordinate/topology models for graphene, CNTs, fullerenes, droplets on sheets, or water near approximate surfaces, but the physics is only as good as the force field. For many-body metals, reactive events, surface reconstruction, charge transfer, and MLP potentials, use `lammps`, `cp2k`, `vasp`, or the relevant engine. Treat ad hoc LJ surface models as exploratory.

## Reporting

State composition, box dimensions, density after equilibration, thermostat/barostat, cutoff/PME/vdW scheme, trajectory length, discarded equilibration, and uncertainty or fit-window sensitivity for every property.
