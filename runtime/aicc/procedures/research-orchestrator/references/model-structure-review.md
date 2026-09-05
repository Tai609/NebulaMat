# Model-Structure Review Gate

> Load this when: building or reviewing a slab, surface, defect, adsorbate,
> molecule-on-surface, or cluster-on-surface model before engine input generation.

This gate turns structure modeling into a reviewed mini-DAG. It is deliberately earlier
than VASP/CP2K/Gaussian input generation and earlier than HPC submission. It should not
be used to stop the first structure-modeler step just because no starting coordinates
were supplied.

## Task Split

```text
T_lit   surface-literature-reviewer  -> surface-literature-review
T_gen   structure-modeler            -> initial-structure-decision + structure-set
T_audit structure-critic             -> structure-audit-report / model-structure-review
T_fix   structure-modeler            -> revised structure-set, if needed
```

Planning and criticism may use multiple agents or independent passes. Coordinate edits
and expensive execution remain owned by one task at a time.

The structure producer cannot self-approve. `structure-modeler` may register
`structure-set`, `initial-structure-decision`, deterministic geometry summaries,
validation reports, and follow-up proposals, but it cannot register
`structure-audit-report`, `model-structure-review`, or `gate-verdict` artifacts.
`structure_gate` is produced by an independent reviewer role, normally
`structure-critic`.

## Literature Review Checks

The `surface-literature-reviewer` checks:

- whether the Miller index is reported as an exposed, stable, synthesized, or commonly
  modeled facet for the material;
- whether the chosen Miller index differs from the commonly used/synthesized/modelled
  facet and, if so, whether the current facet is justified by the scientific question
  rather than inherited from a convenient slab cut;
- whether the termination matches the experimental or chemical condition, especially
  for oxides, sulfides, perovskites, polar surfaces, hydroxylated surfaces, and supported
  metals where termination fixes oxidation state;
- whether top/bottom slab symmetry is chemically appropriate. Symmetric slabs are
  preferred when they preserve the intended surface chemistry and cost, but asymmetric
  slabs are acceptable when symmetry would force the wrong termination, stoichiometry,
  adsorbate placement, or model size. The review records top/bottom terminations,
  polarity/dipole risk, and electrostatic-correction needs rather than blocking solely
  because the slab is asymmetric;
- whether stoichiometry and charge balance match the chemical environment. For
  effectively fixed-valence or non-redox-active components, non-stoichiometric models
  require a compensating mechanism or source precedent. For redox-active or
  variable-valence components, reservoir-, synthesis-, gas-, solvent-, or
  electrochemical-condition-dependent non-stoichiometry can be acceptable when the
  oxidation-state rationale is explicit;
- slab thickness, vacuum, lateral supercell, coverage, model-size economy, and
  fixed-layer precedent;
- adsorption site and motif precedent for atoms, molecules, or supported clusters.

The output must include citations, database IDs, source file provenance, or an explicit
`exploratory/no-precedent-found` label. Weak precedent is not silently promoted into a
production-quality model.

Original structure files are preferred when the task is a reproduction, but their
absence does not block modeling. The modeler first records an
`initial-structure-decision`: which supplied structures were found, whether they are
usable, and what self-built route will be used if they are absent or incomplete. In
this discovery step, only inspect the current project root/current working directory,
obvious project input/model subdirectories, registered `.research` paths, and
user-explicit paths. Do not run broad `find` searches over `$HOME`, `/home`, `/opt`,
`/`, shared software trees, scratch roots, or unrelated archives. If the bounded
project-local check finds nothing, record `not_supplied` and build structures from
database crystals, manuscript characterization, field precedent, and explicit
assumptions, then mark the structure origin as `designed` or `reconstructed`. The gate
reviews whether that constructed model is defensible for the question; it does not
reject a model solely because it was not supplied by the user or the paper archive.

For very niche materials or unusual structural modifications, direct facet,
termination, coverage, or adsorption-motif precedent may not exist. After a documented
reasonable search, lack of direct literature precedent is not by itself a blocker and
does not require forced comparison against unrelated systems. Mark the model
`exploratory/no-precedent-found`, record the search scope and assumptions, and continue
to geometry, stoichiometry, charge/spin, termination, and chemical-plausibility checks.

## Geometry Critic Checks

The `structure-critic` consumes candidate structures and checks:

- whether the generated model represents the registered scientific question, including
  the intended site, support, defect, adsorbate, molecule, cluster, concentration,
  coverage, or redox/termination condition;
- in-plane lattice lengths, angle, supercell multiplicity, and whether the loaded
  adsorbate/cluster footprint fits the cell;
- finite-size adequacy: lateral cell size, coverage or concentration, and nearest
  adsorbate/cluster/defect/support-image distance with PBC on, unless a deliberate
  high-coverage or periodic model is registered and justified;
- computational economy: atom count, lattice lengths, vacuum thickness, and number of
  candidate structures are not inflated beyond what the finite-size or convergence
  argument requires; large models must carry an accuracy/cost tradeoff;
- slab thickness, vacuum thickness, layer ordering, fixed/free layer flags, surface
  normal, `c`-axis orthogonality to `a`/`b`, polarity, and whether atoms wrapped into
  vacuum or across the slab;
- top/bottom slab symmetry or the rationale for an asymmetric slab, including dipole or
  polarity handling;
- stoichiometry, charge balance, and oxidation-state/chemical-environment consistency,
  separating effectively fixed-valence systems from redox-active or variable-valence
  systems;
- closest unintended atom pairs, minimum interatomic distance, and each closest
  pair's element-specific covalent-radius threshold/margin. Do not judge all
  element pairs with one fixed Å cutoff; use the structure-prep audit's default
  lower bound, `0.95 * (r_cov(i) + r_cov(j))`, so small compression can pass but
  larger deficits block. Record explicit rationale for deliberate short bonds,
  transition-state guesses, or constrained contacts;
- intended adsorbate/cluster anchor atoms and nearest adsorbate-surface distance;
- whether the adsorbate is too close, floating too far from the surface, on the wrong
  side of the slab, or connected to an unintended site.

Use `__NEBULAMAT_AICC_ROOT__/tools/structure-prep/scripts/audit_structure.py` when possible to produce a
deterministic geometry summary. The script does not decide chemistry by itself; the
critic interprets its distances against the intended model.

Keep audit handoff compact. Store the complete deterministic audit as JSON or another
file artifact, but put only a short reviewer-facing table in gate evidence and logs:
verdict, atom count, lattice/vacuum, c-axis orthogonality, finding counts, top
FAIL/WARN checks, and the one or two decisive nearest-contact/image-distance rows.
Do not paste full closest-pair dumps, full JSON, or per-atom listings into chat,
`gate-verdict` evidence, or stage synthesis; reference the artifact path instead.

## Outcomes

Use one of these outcomes:

- `approve` — candidate structures may be accepted for engine input generation.
- `request_revision` — specific changes are needed, such as larger supercell, different
  termination, revised adsorbate height/orientation, more candidate sites, or repaired
  selective dynamics.
- `block` — the model is geometrically invalid, chemically incoherent, contradicts known
  experimental/model constraints, or lacks required user approval for exploratory use.
  Do not block solely because a niche system has no direct literature precedent, or
  solely because original source coordinates were unavailable. Do not block solely
  because a slab is asymmetric; block or request revision only when asymmetry creates an
  unhandled dipole/polarity problem, wrong chemistry, or unsupported stoichiometry.

Downstream engine tasks should consume the accepted structures they actually use plus an
accepted machine-readable `structure_gate` verdict. A validated geometry file without
accepted model review is not enough for production HPC submission. The generic
pre-submit hook enforces the gate verdict; projects may additionally declare the
reviewed `structure-set` as a task input when that artifact is registered.

## Machine-Readable Verdict

The critic should write a machine-readable YAML gate verdict artifact in addition to
any narrative report. Use the generic gate contract in `references/gate-contract.md`,
with `gate: structure_gate` or the alias `gate: model-structure-review`. A narrative
`model-structure-review.md` can support the decision, but it does not replace the YAML
verdict consumed by pre-submit hooks.

Recommended check IDs are general and project-independent:

- `model_relevance`
- `miller_index_precedent`
- `structure_prep_validation`
- `finite_size_effects`
- `coverage_or_concentration`
- `periodic_image_separation`
- `slab_thickness_and_vacuum`
- `slab_symmetry_or_asymmetry_rationale`
- `computational_economy`
- `fixed_region_and_surface_normal`
- `termination_charge_spin_or_oxidation_state`
- `stoichiometry_charge_balance`
- `chemical_environment_consistency`
- `adsorption_or_anchor_motif`
- `unintended_contacts`

Do not encode a specific material, adsorbate, or cell size into the protocol. The gate
records whether the chosen model is justified for the current question. If a compact,
high-coverage, finite-cluster, or otherwise approximate model is still used, the verdict
must state the justification and the limitation that downstream result and report gates
must preserve.

Machine-checkable distance metrics should be recorded when finite-size adequacy matters:

```yaml
- id: periodic_image_separation
  status: request_revision
  metrics:
    min_adsorbate_image_A: 2.18
    target_min_adsorbate_image_A: 5.0
    surface_cell: p(2x1)-equivalent
  evidence: Pt4/CO periodic images are too close for quantitative claims.
```

If `min_adsorbate_image_A` or an equivalent image-separation metric is below the
registered target, the check must be `request_revision`, `block`, or `waived`.
Continuing with a too-small image separation requires top-level `status: waived` and a
valid `waiver.decision_id`; it cannot be hidden under `status: pass`.
