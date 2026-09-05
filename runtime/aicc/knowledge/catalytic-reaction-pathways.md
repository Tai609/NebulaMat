# Catalytic Reaction Pathways

> Covers: surface catalytic reaction path diagrams, intermediate-only energy/free-energy profiles, intermediate plus transition-state profiles, sequential intermediate construction, co-adsorption model choices, and when to add frequency/free-energy corrections.

Tool-agnostic science and practice. Use this when planning a catalytic mechanism on a slab, cluster, support, or interface. Code-specific execution belongs in engine skills such as `__NEBULAMAT_AICC_ROOT__/tools/vasp`; structure construction belongs in `__NEBULAMAT_AICC_ROOT__/tools/structure-prep`; thermochemistry post-processing belongs in the thermochemistry/VASPKIT references.

## Two common pathway diagrams

### Intermediate-only pathway

An intermediate-only diagram compares stable states along a proposed reaction sequence:

```text
slab + A(g) -> A* -> B* -> C* -> slab + P(g)
```

Each point is a relaxed minimum: clean surface, adsorbed reactant, surface intermediate, co-adsorbed state, or product state. The y-axis may be electronic energy (`DeltaE`) or free energy (`DeltaG`). This diagram is thermodynamic; it does not provide kinetic barriers unless transition states are also computed.

Use it for:

- screening feasible pathways and uphill/downhill steps;
- comparing alternative stable intermediates or branches;
- identifying steps that may need transition-state searches later;
- electrochemical CHE step diagrams when the thermodynamic step free energies are the target.

### Intermediate plus transition-state pathway

A TS pathway inserts saddle points between adjacent minima:

```text
A* -> TS1 -> B* -> TS2 -> C*
```

For each elementary step, record:

```text
DeltaE_rxn = E_FS - E_IS
E_a,fwd    = E_TS - E_IS
E_a,rev    = E_TS - E_FS
```

For a free-energy profile, use the analogous `G` values. A TS is not accepted merely because it is high in energy: validate one imaginary mode and confirm the mode follows the intended bond breaking/forming, diffusion, proton transfer, or coupling coordinate.

## Sequential construction is the default

Do not build and submit every imagined intermediate at once. A catalytic path is normally a multi-round workflow whose structures remain continuous along the reaction coordinate.

Default sequence:

```text
1. Relax clean slab or the starting adsorbed reactant state.
2. Build a small set of chemically reasonable first-adsorbate candidates A*.
3. Gate the candidate structures before relaxation.
4. Relax accepted A* candidates.
5. Analyze relaxed structures and choose one or a few representative A* states.
6. From the accepted relaxed A* geometry, locally edit the next intermediate B*.
7. Repeat: gate -> relax -> analyze -> choose/branch -> build the next intermediate.
8. After key adjacent intermediates are stable and matched, run TS/NEB/dimer searches where barriers are needed.
```

This preserves:

- adsorption site continuity;
- local reconstruction of the surface/support/cluster;
- adsorbate orientation and bonding topology;
- realistic IS/FS matching for later NEB or dimer searches;
- a clear provenance chain for why each intermediate belongs to the same pathway.

A fully independent lowest-energy search for every formula can be useful as a separate thermodynamic survey, but it is not the same as a continuous reaction path. If an intermediate relaxes into a different species, migrates to a different site, desorbs, or reconstructs the surface, record that as a pathway event and decide whether to revise the path, keep it as a branch, or reject it.

## First adsorbed reactant: screen reasonable sites

The first adsorbed reactant `A*` may need multiple starting sites and orientations. Build candidates from the optimized clean slab or optimized starting surface, not from an arbitrary unrelaxed slab.

Examples:

```text
clean slab -> A*_top
clean slab -> A*_bridge
clean slab -> A*_hollow
clean slab -> A*_tilted
clean slab -> A*_bidentate
```

Keep the set small and chemically motivated. Include distinct representative motifs, not every symmetry-equivalent copy or every combinatorial perturbation. Candidate structures should pass a structure/model gate before expensive relaxation.

Gate checks should include:

- adsorption site and orientation match the proposed chemistry;
- no atomic overlaps or unphysical initial bonds;
- adsorbate-surface distances are chemically reasonable;
- lateral cell, coverage, and periodic-image separation are adequate;
- fixed layers, vacuum, dipole/asymmetry handling, spin/charge assumptions, and stoichiometry are recorded;
- duplicate candidates are removed;
- if literature or experimental evidence matters, the site choice is supported or explicitly labeled exploratory.

After relaxation, compare final structures as well as energies. A candidate that moves to another site should be relabeled by its final motif, not reported as the initial guess. Choose the path starting state from accepted relaxed structures.

## Subsequent intermediates: branch only from accepted predecessors

For `B*`, `C*`, and later states, do not restart the modeling from clean slab unless the chemical step genuinely returns to clean slab. Start from the accepted relaxed predecessor and make local edits:

- break a bond;
- form a bond;
- rotate or translate an adsorbate within the local site;
- transfer H, O, N, C, electron/proton equivalents, or another fragment;
- add or remove a gas molecule, solvent molecule, ion, or co-reactant;
- move a fragment to an adjacent reactive site;
- couple two adsorbates.

Branching is allowed when the chemistry branches. For example, H can transfer to different O atoms, C-C coupling can occur in different orientations, or a fragment can migrate to two neighboring sites. Each branch should still be generated from the same accepted predecessor, pass a gate, relax, and then be accepted, rejected, or kept as an alternative branch.

## Co-adsorption and multi-species intermediates

When an intermediate contains more than one adsorbed species, consider both individual adsorption sites and relative geometry. Examples include `A* + B*`, `O* + OH*`, `CO* + H*`, two `H*`, a reactant plus solvent/ion, or two fragments before coupling.

Reasonable candidates should cover:

- chemically plausible sites for each species;
- adjacent or near-adjacent arrangements when a reaction between them is intended;
- orientations that allow the target H transfer, C-C coupling, O-O coupling, insertion, dissociation, or association;
- representative separations such as nearest-neighbor and next-nearest-neighbor when those change the chemistry;
- bridge, bidentate, tridentate, or shared-site motifs when expected;
- coverage and cell-size choices consistent with the research question.

Avoid blind Cartesian products of all sites. For `A* + B* -> AB*`, prioritize arrangements where `A*` and `B*` can actually react after relaxation. Too-close structures that force a bond before relaxation and too-far structures that cannot connect in a later TS should both be treated skeptically unless that is the intended test.

Each co-adsorbed candidate still needs a structure/model gate before relaxation. The gate should check both collision avoidance and reaction relevance: a non-overlapping structure can still be a poor pathway model if the two species are too far apart or oriented away from the intended reaction coordinate.

## When to compute transition states

For mechanisms requiring kinetic barriers, first compute and validate the neighboring intermediates. Then run NEB, dimer, constrained scan, or another TS search between matched IS/FS pairs.

Do TS work after intermediate validation because:

- bad minima produce meaningless barriers;
- IS/FS atom mapping is easier when the structures are continuous;
- NEB images are more stable when the surface/adsorbate topology is similar;
- the calculation cost is high, so the likely path should be narrowed first.

Before TS submission:

- confirm IS and FS use the same slab cell, atom ordering, constraints, charge/spin policy, and method fingerprint;
- align adsorbates so the reaction coordinate is local and chemically sensible;
- avoid atom index mismatches when adding/removing species by defining the elementary step consistently;
- gate the IS/FS pair or NEB image set when the project uses `.research/`.

After TS optimization:

- validate one imaginary frequency where feasible;
- animate or inspect the mode along the intended coordinate;
- compare forward and reverse barriers from the same TS;
- ensure the TS connects the intended IS and FS, ideally by short downhill relaxations or IRC-like checks when affordable.

## Energy and free-energy choices

State whether the path is an electronic-energy diagram or a free-energy diagram. Do not mix uncorrected and corrected values without labels.

Electronic-energy profile:

```text
DeltaE_i = E_i - E_reference
```

Free-energy profile:

```text
DeltaG_i = DeltaE_i + DeltaZPE_i + DeltaH_thermal_i - T*DeltaS_i
           + reservoir / pressure / solvation / pH / potential terms when relevant
```

For surface intermediates and transition states, finite-difference frequencies can provide ZPE and thermal corrections. In VASP-backed workflows, VASPKIT task 501 can process adsorbate or selected reacting-atom frequency corrections; usually fix the slab and free only the adsorbate/reacting atoms for a tractable approximation. For gas-phase molecules, compute isolated molecule frequencies and use a gas thermochemistry route such as VASPKIT task 502, JANAF/NIST data, or molecular quantum-chemistry thermochemistry.

Corrections are optional only when the stated result is an electronic-energy path or a screening-level comparison. For publication-level free-energy claims, record the correction table, temperature, pressure, standard states, entropy treatment, and any neglected terms.

## Multi-round workflow with `.research`

Catalytic pathways are naturally iterative. In a structured project, represent this as task waves rather than one giant submission batch:

```text
T_clean_relax -> accepted clean slab
T_A_models -> A* candidate structures + structure_gate
T_A_relax -> relaxed A* candidates + parser results
T_A_select -> accepted A* path starting point
T_B_models -> B* candidates generated from accepted A*
T_B_relax -> relaxed B* candidates
T_TS_AB -> TS/NEB between accepted A* and B* when needed
```

Use `structure-prep` for candidate construction, `research-orchestrator` gates for model review, engine skills for relaxation/static/frequency/TS jobs, `hpc-submit` for scheduler ownership, and `__NEBULAMAT_AICC_ROOT__/tools/report` or plotting scripts for the final path diagram.

Hard rule for execution: a candidate structure set should be reviewed before expensive submission. The first reactant adsorption and any co-adsorption branch may include multiple candidates, but downstream intermediates should be generated from accepted relaxed predecessors unless the pathway explicitly branches.

## Reporting checklist

For each point in the path, record:

- label and chemical formula/species;
- source predecessor structure;
- final structure path and parser/convergence status;
- whether the structure remained the intended intermediate;
- energy type (`E`, `E0`, `G`, CHE `DeltaG`, etc.);
- reference state and sign convention;
- correction terms and their provenance;
- branch status: accepted pathway, alternative, rejected, or exploratory;
- for TS points: imaginary frequency/mode check and connected IS/FS.

Final diagrams should show relative values, not raw total energies, and the caption should state whether it is an intermediate-only thermodynamic path or a TS-containing reaction-energy/barrier path.
