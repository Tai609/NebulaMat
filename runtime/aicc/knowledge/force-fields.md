# Classical Force Fields: Model Coherence and Validation

> Covers: bonded/non-bonded force-field structure; atom types, charges, 1-4 interactions and combination rules; water/ion compatibility; custom-molecule parameterization; polarizable, reactive and coarse-grained alternatives; and validation/mixing rules.

Tool-agnostic science and practice. How a specific code stores and runs a force field lives in its tool skill (`__NEBULAMAT_AICC_ROOT__/tools/gromacs`, `__NEBULAMAT_AICC_ROOT__/tools/lammps`, etc.). A force field is a coupled empirical model, not a bag of independently swappable parameters.

## What a classical force field represents

A common fixed-topology potential decomposes as:

```text
U = U_bonds + U_angles + U_dihedrals + U_impropers
    + U_electrostatics + U_vdW + optional cross/restraint terms
```

Typical forms include harmonic bond/angle terms, periodic/Fourier/Ryckaert-Bellemans torsions, improper/out-of-plane terms, Coulomb electrostatics, and Lennard-Jones or related van der Waals interactions. Class-II/materials force fields may add bond-bond, bond-angle and angle-torsion cross terms.

The model's validity is limited by functional form and training data. A fixed bond graph cannot describe chemistry that changes connectivity. A fixed-charge model cannot respond explicitly to environment polarization. A coarse-grained model does not retain atomistic hydrogen-bond or reaction detail.

## Bonded terms are not geometry restraints

Bond and angle equilibrium values plus force constants encode a local potential, not a command to hold geometry fixed. Dihedral terms often compensate for non-bonded interactions and quantum effects; changing charges or 1-4 scaling can invalidate a torsion fitted in the original family.

Constraints remove degrees of freedom and permit larger timesteps. Position restraints are external biases and are not part of an unbiased production model unless explicitly intended.

## Non-bonded interactions

For fixed charges:

```text
U_elec(i,j) = q_i q_j / (4 pi epsilon_0 r_ij)
U_LJ(i,j)   = 4 epsilon_ij [(sigma_ij/r_ij)^12 - (sigma_ij/r_ij)^6]
```

Model-specific decisions include charge derivation, polarization convention, unlike-pair combination rule or explicit cross terms, electrostatic summation/cutoff method, LJ cutoff/switch/shift/dispersion correction, exclusions and scaled 1-4 interactions, and water/ion parameterization.

## Atom types are chemical environments

An atom type is not merely an element. It distinguishes hybridization, bonding pattern, formal charge, aromaticity, neighboring heteroatoms and sometimes residue context. Missing types or bonded parameters require checking bond order, protonation, atom naming and typing before any parameter transfer.

A visually similar atom is not sufficient evidence for parameter transfer.

## 1-4 interactions and torsions

Atoms separated by three bonds often retain scaled non-bonded interactions. Force fields differ in whether 1-4 pairs are explicit or generated and in LJ/electrostatic scaling factors. Torsions are fitted with that convention present. Never transplant torsions while changing 1-4 scaling.

## Partial charges are model quantities

Atomic partial charge is not a unique observable. RESP/CHELPG, AM1-BCC, CMx, OPLS-style fitted charges, density-partitioning charges, fluctuating-charge models, Drude oscillators, induced dipoles, multipoles and off-center charges are different model conventions. Replacing the charges of an existing force field without refitting LJ/torsions creates a new hybrid model that needs validation.

## Water and ions

Three-, four- and five-site water models differ in geometry, charge-site placement, LJ parameters, dielectric/diffusion behavior and timestep treatment. Ion parameters are often fitted for a particular water model and non-bonded protocol. A water model that gives good density can still give poor diffusion, viscosity, dielectric constant, melting behavior, surface tension or ion pairing.

## Custom-molecule parameterization

Defensible workflow:

1. define protonation/tautomer, stereochemistry, bond order, net charge and conformers;
2. choose the parent force-field family and its charge/combination/1-4 rules;
3. assign transferable terms with provenance;
4. fit missing charges/torsions/non-bonded terms against appropriate quantum/experimental data;
5. validate gas-phase geometry/conformer ordering/torsion surfaces, electrostatic potential or interaction energies, liquid/solvation data where relevant, and target condensed-phase behavior;
6. record uncertainty and applicability domain.

Automated parameter generators accelerate assignment; they do not remove the need to inspect penalties, missing types, impropers, ring behavior and net charge.

## Polarizable, reactive and coarse-grained alternatives

Polarizable force fields respond to the local field and require a protocol for extra degrees of freedom. Reactive force fields allow changing connectivity but need parameter sets fitted for the exact element combinations and chemistry. Coarse-grained models integrate out local degrees of freedom; atomistic time, H-bonds and reaction mechanisms cannot be read directly from a CG trajectory.

## Mixing parameter families

Before mixing, reconcile functional forms, units, atom-type namespace, combining rules, 1-4 exclusions/scaling, charge/polarization convention, water/ion parameters, cross interactions and validation state points. A compatible extension explicitly designed for a parent family is different from arbitrary mixing.

## Validation hierarchy

| Level | Examples |
|---|---|
| local/gas phase | geometry, vibrational curvature, torsion profile, conformer ordering |
| pair interactions | dimer energies/geometries, hydration motifs, ion coordination |
| bulk thermodynamics | density, enthalpy, compressibility, heat capacity, phase behavior |
| transport/dielectric | diffusion, viscosity, conductivity, dielectric response |
| interfaces/biomolecules | surface tension, partitioning, membrane area/order, folded-state balance, binding-site structure |

Agreement with one property can arise from error cancellation. Report both strengths and known failures of the chosen parameter set.

## Provenance checklist

```text
force-field family and exact version/date
functional forms and combining rule
1-4 generation/scaling and exclusions
water and ion models
custom molecule source, atom types and charge method
parameter files by path/hash/source (licensed contents not reproduced)
cutoff/electrostatic/dispersion protocol
constraints and timestep
validation targets and observed deviations
```
