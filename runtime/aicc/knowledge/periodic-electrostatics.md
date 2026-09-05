# Periodic Electrostatics, Vacuum, Dipoles, and Solvation

> Covers: the code-independent modeling choices behind periodic electrostatics — molecules in boxes, slabs and 2D materials, charged cells, vacuum convergence, dipole corrections, work functions, band alignment, and implicit-solvent thermodynamic cycles.

This file is science/modeling guidance. Engine-specific syntax lives in `__NEBULAMAT_AICC_ROOT__/tools/vasp`, `__NEBULAMAT_AICC_ROOT__/tools/cp2k`, or another code skill.

## Core principle

The boundary condition is part of the physical model. A calculation can be numerically converged but physically wrong if the periodic images, vacuum, neutralizing background, or dipole field do not represent the intended system.

Ask before running:

- What directions are physically periodic?
- Does the model carry a net charge, dipole, or long-range field?
- What quantity is being compared: total energy, work function, defect formation energy, solvation energy, band alignment, force/stress, or spectrum?
- What reference potential or correction is needed to compare across cells?

## Common models

| Model | Main risk | Usual validation |
|---|---|---|
| molecule/cluster in a box | interaction with periodic images | box-size convergence of energy, dipole, frontier orbitals, density |
| slab/interface | artificial slab-slab electrostatics and nonflat vacuum potential | slab thickness, vacuum, dipole status, planar-average potential |
| 2D material | vacuum collapse or spurious out-of-plane field | fixed vacuum, in-plane k-mesh, vacuum convergence |
| 1D polymer/wire | image interaction in transverse directions | transverse box convergence and correct k-direction |
| charged defect/cell | divergent or correction-dependent electrostatics | correction/reference-potential convention and supercell-size test |
| solvated/continuum system | inconsistent thermodynamic cycle | same solvation model/parameters for all terms, cavity sensitivity |

## Vacuum is not a default number

A common vacuum starting point can be 15-25 Å for slabs or molecules, but the required value depends on the target property. Work functions, charged systems, polar slabs, dipoles, Rydberg/weakly bound states, and diffuse densities may need more. For a paper-quality value, converge the property, not only the total energy. Conversely, vacuum is not free: for very large cells, or for clusters/wires/slabs that require vacuum in two or three lattice directions, about 10 Å in a nonperiodic direction can be the better economy choice when periodic-image interactions are already negligible for the observable. Record the reduced-vacuum rationale, carry it into the structure audit or gate threshold instead of overriding a failed default check by hand, and do not mix different vacuum conventions inside a sensitive energy comparison unless convergence justifies it.

For variable-cell optimization, do not let a vacuum direction relax unless the physical system has pressure/stress in that direction. Vacuum collapse is a modeling error, not a good optimization.

## Dipole correction

Dipole corrections are useful for asymmetric slabs and polar systems, but they are not harmless defaults.

Use them when:

- the slab/interface has a net dipole normal to the surface;
- a work function or electrostatic-potential alignment depends on a flat vacuum plateau;
- the method/source explicitly defines the correction.

Guardrails:

- The correction direction must match the nonperiodic/slab-normal direction.
- Do not mix corrected and uncorrected slab energies in one thermodynamic expression unless the cycle explicitly defines it.
- Recheck vacuum convergence after enabling the correction.
- Always state the correction status in methods and figure captions.

## Work function and vacuum alignment

For a metal slab:

```text
Phi = V_vacuum - E_F
```

For semiconductors/insulators, band alignment may require VBM/CBM or a reference electrode convention rather than simply using a Fermi level in the gap.

Minimum evidence:

- planar-average electrostatic/Hartree potential along the nonperiodic direction;
- a visibly flat vacuum plateau;
- slab thickness and vacuum convergence;
- dipole-correction status;
- energy zero and side of slab used for asymmetric slabs.

Never compare raw eigenvalues, band edges, or DOS peak positions from unrelated cells without a reference alignment such as vacuum level, deep core state, or a defined electrode reference.

## Charged cells and defects

A net charge in a periodic cell introduces a correction/reference problem. Before computing charged-defect or charged-slab energies, define:

- charge state and compensating background/counterion convention;
- chemical potentials and electron reservoir/Fermi-level reference;
- potential alignment method;
- finite-size correction strategy;
- dielectric constant or screening model if used;
- supercell-size convergence.

Raw charged-cell total energies are not a transferable quantity. A correction can be larger than the trend being discussed, especially for small cells, low-dimensional systems, or vacuum slabs.

## Implicit solvent and SCCS-style models

Implicit solvent changes the electrostatic model and cavity definition. Use it through an explicit thermodynamic cycle.

Example cycle for a solvation effect:

```text
DeltaG_solv(A) = G_solution(A) - G_vacuum(A)
```

For an adsorption/reaction free energy in solution, all species in the expression must use compatible solvation parameters or the cycle must state why a term is vacuum/gas-phase.

Guardrails:

- Do not mix vacuum and solvated total energies without writing the cycle.
- Charged species are highly sensitive to cavity, dielectric, cell, and reference-potential choices.
- Specific hydrogen bonding, ion coordination, proton transfer, and solvent dynamics often require explicit solvent or at least validation against explicit-solvent models.

## Reporting minimum

Report:

- physical periodicity and code boundary condition;
- vacuum thickness and convergence result;
- dipole correction/electrostatic solver status;
- charge/countercharge/correction convention;
- reference potential for work functions or band alignment;
- solvation model and parameters, if used;
- figure showing cell/slab/vacuum orientation for surface or 2D claims.
