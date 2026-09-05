# CP2K QM/MM Workflows

> Load this when: preparing CP2K QM/MM, mixed quantum/classical simulations, embedding, link atoms, boundary choices, force-field coupling, or QM-region validation.

QM/MM is a model-construction problem before it is an input-syntax problem. The QM region, MM force field, embedding mode, boundary treatment, and sampling protocol define the result.

## When QM/MM is appropriate

Use QM/MM when:

- chemistry is localized but the environment matters electrostatically or sterically;
- explicit solvent/protein/material environment is needed;
- full QM is too expensive for the desired sampling length;
- a reactive site needs DFT while the surroundings can be classical.

Avoid it when the reaction/electronic reorganization is delocalized across the proposed QM/MM boundary or when the MM force field cannot describe the environment state.

## Model choices to settle first

| Choice | Questions |
|---|---|
| QM region | Which bonds break/form? Which residues/solvent/ions polarize the active site? |
| Boundary | Are covalent bonds cut? Are link atoms needed? |
| Embedding | Mechanical, electrostatic, polarizable? How are MM charges seen by QM? |
| MM force field | Parameters, charges, constraints, water model, ion parameters |
| Periodicity | Is this a periodic liquid, biomolecule box, slab/interface, or cluster? |
| Sampling | Optimization, constrained scan, AIMD/QMMM-MD, umbrella/metadynamics? |

## CP2K input shape

Check the installed manual for exact keyword paths. Typical CP2K QM/MM inputs combine a `QMMM` force evaluation with `DFT`, `MM`, and `SUBSYS` information:

```text
&FORCE_EVAL
  METHOD QMMM
  &DFT
    ... Quickstep settings for the QM region ...
  &END DFT
  &MM
    ... force-field, topology, nonbonded settings ...
  &END MM
  &QMMM
    ... QM region, embedding, link-atom, and cell settings ...
  &END QMMM
  &SUBSYS
    ... full system cell/coordinates/topology ...
  &END SUBSYS
&END FORCE_EVAL
```

Treat this as a skeleton, not a paste-ready template. QM/MM keywords are version- and workflow-specific.

## QM-region selection

Rules:

- include all atoms whose bonds change;
- include directly coordinated metals/ligands and first-shell groups if their polarization or charge transfer matters;
- do not cut through conjugated or strongly delocalized electronic structures without validation;
- grow the QM region until the target barrier/energy/charge distribution is stable;
- keep atom indices traceable after every structure conversion.

## Boundary and link atoms

When cutting a covalent bond:

- choose chemically simple single bonds far from the reactive center;
- define link-atom placement and force redistribution deliberately;
- verify that artificial boundary dipoles or constraints do not dominate the result;
- compare at least one larger QM region when the claim depends on the boundary.

## Embedding and electrostatics

Electrostatic embedding lets MM charges polarize the QM density, but also introduces sensitivity to charge placement, cutoff, and boundary treatment.

Check:

- MM charge neutrality and protonation states;
- whether nearby ions/waters should be QM;
- treatment of long-range electrostatics and PBC;
- whether the QM region charge/multiplicity is chemically consistent;
- whether SCCS or continuum solvent is being combined with explicit MM environment, and why.

## Optimization and MD

For QM/MM geometry optimization:

- pre-relax bad contacts with MM or low-level methods;
- freeze or restrain far-field atoms only with a written rule;
- verify the QM region does not drift into an unintended bonding state.

For QM/MM MD:

- equilibrate the MM environment before production;
- record timestep, thermostat/barostat, constraints, and QM SCF failure count;
- discard equilibration frames;
- run long enough for the observable, not just a visually stable movie.

## Validation checklist

- Same reaction/path result with a larger QM region or shifted boundary.
- Stable charge/spin state in the QM region.
- MM-only and QM-only sanity checks where possible.
- Conserved/controlled temperature and no repeated SCF failures in MD.
- Energy expression uses consistent QM/MM model across all terms.
- Topology, atom ordering, and group definitions are preserved under conversion.

## Reporting checklist

Record:

- full structure source and topology;
- QM-region atom indices and boundary/link atoms;
- embedding type and electrostatic treatment;
- QM method, basis/potential, charge/spin, SCF strategy;
- MM force field, charges, water/ion model, constraints;
- periodicity, cell, cutoff/PME/Ewald-like choices;
- optimization/MD protocol and trajectory analysis window;
- CP2K version and all scripts used to generate the input.
