# Validating Structures

> Load this when: checking any structure before it enters a calculation, or certifying a prepared structure.

## Periodic

- Initial-structure provenance uses bounded project-local discovery only. Accepted
  sources are files in the current project root/current working directory, user-explicit
  paths, registered `.research` artifacts, database entries, literature/manuscript
  evidence, or documented builder assumptions. Absence of files after this bounded
  check is recorded as `not_supplied`; it is not a reason to run broad searches over
  `$HOME`, `/home`, `/opt`, `/`, shared software trees, or unrelated archives.
- Lattice vectors exist and are sane (no periodic calculation without a cell — hard block).
- Composition and atom count match intent. Closest-contact checks use element-pair
  covalent-radius sums, not one fixed Å threshold: by default `audit_structure.py`
  uses Pyykkö/Atsumi single-bond covalent radii. The radius sum is a reference
  contact scale, not an absolute hard line: the default hard lower bound is
  `0.95 * (r_cov(i) + r_cov(j))`, so about 5% compression can pass with a
  `compressed-contact` warning. Example: O(0.63 Å) + Pt(1.23 Å) gives a Pt-O
  radius sum of 1.86 Å and a default allowed minimum of 1.77 Å. The old absolute
  ~0.7 Å rule is only a fallback for unknown radii or obviously overlapping atoms.
- Species ordering reported whenever VASP files are written — must match the POTCAR that will be used.
- Slabs: intended selective-dynamics flags present after every conversion step (easy to lose); vacuum thickness verified for both lower bound and excessive-size cost; polarity checked (`Slab.is_polar()`).
- Slab cell orientation is checked. The vacuum/surface-normal `c` vector should
  normally be perpendicular to both `a` and `b` (`alpha` and `beta` near 90 deg). If
  `c` is noticeably tilted, record the angle deviation and do not first hard-rotate or
  orthogonalize the finished slab. Re-check whether the cut used the intended
  conventional cell and pymatgen
  `SlabGenerator(..., primitive=False, max_normal_search=...)`, then verify the Miller
  cut, slab orientation, wrapping, and vacuum estimate before engine handoff.
  `Slab.get_orthogonal_c_slab()` is acceptable only as a recorded explicit fallback
  for workflows that require orthogonal `c`; rerun the geometry audit afterward because
  it can break slab symmetries.
- Slab symmetry is checked as a modeling decision, not a hard requirement. If the slab
  is asymmetric, the validation record states the top/bottom terminations,
  polarity/dipole risk, fixed layers, vacuum, and whether a downstream
  dipole/electrostatic correction or limitation is needed.
- Stoichiometry and charge balance are checked against the modeled chemical
  environment. Effectively fixed-valence/non-redox-active components should remain
  close to the expected stoichiometry unless a compensating defect, adsorbate, or
  source precedent is recorded. Redox-active/variable-valence components may use
  non-stoichiometric terminations, vacancies, hydroxylation, or reservoir-dependent
  compositions when the chemical environment and oxidation-state rationale are stated.
- Model economy: atom count, lattice lengths, and vacuum are reviewed together. Models above roughly 200 atoms, above roughly 300 atoms, or with any lattice length above roughly 30 Å need a recorded finite-size/accuracy/cost justification rather than automatic approval. For systems with large lateral dimensions, or with vacuum in two or three directions, oversized vacuum is a cost problem: if the nonperiodic images are already separated and the target property is not vacuum-sensitive, reduce the relevant vacuum spacing to about 10 Å instead of carrying 15-25 Å by default. Keep larger vacuum only for recorded reasons such as work functions/vacuum-level alignment, strong dipoles, charged cells, diffuse states, convergence tests, or explicit literature/source settings. If `audit_structure.py` would otherwise fail the default lower-bound check, rerun it with an explicit economy threshold such as `--min-vacuum 10` and, only when justified for the adsorbate case, `--min-vacuum-adsorbate 10`; record that command and rationale in the structure gate.
- Symmetry statements always carry their symprec.

## After every structure operation

Any operation that changes coordinates, lattice, periodicity, or atom count must be followed by a geometric sanity check before the structure is released to a calculator. This includes format conversion, wrapping/unwrapping, supercell generation, slab cutting, rotation, sorting, centering, adding adsorbates, deleting atoms for vacancies, substitutions, and molecule placement.

Keep the implementation boundary as strict as the review boundary. A structure operation
may write candidate POSCAR/XYZ/CIF files plus a compact summary and audit output, but
it must not also write engine inputs or scheduler scripts. If a helper currently does
`build atoms -> write POSCAR -> write POTCAR/INCAR/KPOINTS -> write submit.sh`, split
it into `generate_structure_case()` and `generate_engine_input_case()` (or equivalent)
so the second function starts only from a reviewed structure.

For slabs, adsorbates, and supported clusters, run a deterministic geometry audit before
handoff whenever possible:

```bash
uv run __NEBULAMAT_AICC_ROOT__/tools/structure-prep/scripts/audit_structure.py work/models/ads00/POSCAR --adsorbate-count 1 --json work/models/ads00/structure-audit.json
```

Use `--adsorbate-count N` when the adsorbate/cluster is the last N atoms, or
`--adsorbate-indices 73-84` when atom indices are known. The script reports facts; the
structure critic decides whether those facts are acceptable for the registered model.

Hard checks:

- No unintended close contacts. Inspect the minimum interatomic distance and the
  closest pairs, including each pair's covalent-radius lower bound and margin, not
  only the global value. Treat distances below the default tolerance
  `0.95 * (r_cov(i) + r_cov(j))` as a hard block unless deliberately constructing
  a known short bond, multiple-bond, transition-state, or constrained starting
  guess, and record that rationale. Distances between 0.95 and 1.00 times the
  radius sum are acceptable but should be recorded as compressed contacts.
- No unintended separation. For adsorbates or fragments, check the nearest surface/anchor distance and confirm the molecule is close enough to interact with the intended site; a molecule floating far in vacuum is not an adsorption model.
- Periodic images are sensible. Check nearest-neighbor distances with PBC on for periodic systems; a structure can look fine in one cell while colliding through the boundary.
- Lateral cell is big enough for what's loaded without being wasteful. For a supported cluster/molecule/dopant, confirm the adsorbate–image edge-to-edge distance is large enough for the intended observable. Use ≥ ~5 Å as the routine soft target; below ~5 Å can be acceptable only with an explicit high-coverage, finite-size, or computational-cost justification. Larger cells may be required for coverage-sensitive energetics or long-range interactions, but oversized models should also be flagged for cost.
- The intended site survived the operation. After adding or rotating an adsorbate, verify which atom is bound to which surface atom/site, whether the molecule orientation is chemically plausible, and whether it crossed to the wrong side of a slab.
- Slabs still have the intended geometry. After cutting, rotating, centering, or adding vacuum, verify surface normal, `c`-axis orthogonality to `a`/`b`, vacuum thickness, layer ordering, bottom/fixed layers, and that no atoms were wrapped into the vacuum or across the slab. Vacuum around 15 Å is normally enough for adsorbates/dipoles; substantially larger vacuum should be justified by convergence, dipole/electrostatic needs, or a comparable reason. For very large cells, or systems with vacuum along two or three lattice directions, about 10 Å vacuum in each nonperiodic direction can be an acceptable economy setting when image interactions are not controlling the observable; make the audit threshold explicit rather than treating a default failure as acceptable.
- Stoichiometry and labels still match intent. Check atom count, species labels, oxidation/charge-relevant substitutions, and selective-dynamics flags after sorting or conversion.

For adsorbate placement, report at least the adsorbate-anchor distance, the nearest adsorbate-surface distance, and the closest unintended atom pair. If those distances are uncertain, make a quick structure render or neighbor table before proceeding. A visually plausible figure is not enough; it must agree with the numerical neighbor check.

## Model-structure review release gate

Before a generated slab/adsorbate/cluster structure enters VASP, CP2K, Gaussian, LAMMPS,
or HPC submission, require two evidence artifacts when the modeling choice matters:

1. `surface-literature-review`: Miller index, exposed facet, termination, slab thickness,
   lateral cell, coverage, and adsorption motif checked against source literature or
   explicitly labeled exploratory. If the chosen Miller index differs from the facet
   commonly used, synthesized, or modeled for the material, record why the current facet
   is still relevant to the scientific question. For very niche materials or unusual
   modifications, a documented `exploratory/no-precedent-found` label is acceptable; do
   not force a weak comparison to unrelated literature or block solely because no direct
   precedent exists.
2. `structure-audit-report`: numerical geometry audit, including a/b/c, alpha/beta/gamma,
   `c`-axis orthogonality to `a`/`b`, vacuum estimate, slab thickness, atom
   count/cell-size economy flags, selective dynamics, closest PBC pairs with
   covalent-radius thresholds/margins, adsorbate-surface distance, and adsorbate-image
   separation. Register the complete JSON/details as an artifact, but keep the
   reviewer-facing report compact: a summary table, top FAIL/WARN checks, decisive
   pair/image rows, and a path to the full audit file. Do not paste full closest-pair
   dumps into gate evidence, chat, or stage synthesis.

The recommended outcomes are `approve`, `request_revision`, or `block`. A
`request_revision` outcome returns to structure-prep; do not patch the engine input by
hand downstream. A `block` outcome prevents expensive engine/HPC work until the model
choice is changed or explicitly approved as exploratory. Use `block` for invalid or
unapproved models, not for a well-labeled niche exploratory model that simply lacks a
direct literature analogue.

## Molecular

- Valence and formal charges consistent; fragments/salts accounted for explicitly.
- Charge **and** multiplicity assigned with stated origin before any electronic-structure handoff — this is a release gate, not a warning.
- Conformer coverage stated: single conformer (labeled as such) vs ensemble with energy spread.
- Stereochemistry preserved through conversions (compare canonical SMILES before/after).

## Provenance

Original input files preserved untouched; derived structures to new paths; database structures carry their entry ID (MP/COD/ICSD); every transformation step listed in the report.
