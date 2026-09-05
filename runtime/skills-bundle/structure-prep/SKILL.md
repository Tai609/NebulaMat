---
name: structure-prep
description: Prepare and convert atomistic structures before calculations. Use for CIF/POSCAR/CONTCAR/XYZ/PDB/MOL/SDF/SMILES handling, supercells, slabs, surface terminations, defects, substitutions, adsorbate placement, symmetry analysis, conformer generation, and charge/multiplicity determination for molecules.
---

# Structure Preparation

Two toolchains by system type: **periodic** (crystals, slabs, defects, VASP files) → pymatgen; **molecular** (SMILES, conformers, finite molecules) → RDKit.

## Where to find what

| Situation | Go to |
|---|---|
| building anything: slabs, supercells, defects, adsorbates, conformers, conversions, database sourcing | `references/running.md` |
| checking a structure before/after an operation; release gates | `references/validation.md` |
| embedding fails, disordered CIFs, symprec surprises, polar slabs | `references/errors.md` |
| slab with selective dynamics | `scripts/make_slab.py` |
| place an adsorbate on a slab — enumerate distinct sites (multi-start), selective dynamics, binding distances | `scripts/place_adsorbate.py` |
| audit a generated slab/adsorbate/cluster model before engine handoff | `scripts/audit_structure.py` + `references/validation.md` |
| dopant / vacancy / interstitial: substitution, O-vacancy, subsurface dopant, single-atom site | `scripts/dope_structure.py` |
| SMILES → 3D + charge/multiplicity report | `scripts/smiles_to_xyz.py` |
| format conversion with validation summary | `scripts/convert_structure.py` |
| working examples to copy and adapt | `examples/` |
| not covered locally (pymatgen/RDKit docs, structure databases) | `references/resources.md` |

## Hard guardrails

- Never invent lattice vectors — no cell, no periodic calculation.
- Initial-structure discovery is project-local. Look only in the current project
  root/current working directory and user-explicit input paths. Do not run broad
  `find` searches over `$HOME`, `/home`, `/opt`, `/`, shared software trees, scratch
  roots, or unrelated archives. If nothing is supplied in that bounded scope, record
  that no usable initial structure was supplied and build from declared database,
  literature, manuscript, or builder assumptions.
- No molecule enters electronic-structure work without explicit charge and multiplicity (with stated origin).
- Termination, defect-site, and conformer choices are scientific decisions: enumerate and ask/justify, never randomize silently.
- Slab top/bottom symmetry is useful when it preserves the intended surface chemistry
  at reasonable cost, but it is not mandatory. If symmetry would force the wrong
  termination, stoichiometry, adsorbate placement, or an oversized model, use an
  asymmetric slab and record top/bottom terminations, polarity/dipole risk, fixed
  layers, vacuum, and any downstream electrostatic correction.
- Slab cells should normally keep the vacuum/surface-normal `c` vector perpendicular
  to both `a` and `b` (`alpha` and `beta` near 90 deg). If a pymatgen-generated or
  converted slab has a noticeably tilted `c`, do not first hard-rotate or
  orthogonalize the finished slab. Re-check whether the cut used the intended
  conventional cell and pymatgen
  `SlabGenerator(..., primitive=False, max_normal_search=...)`, then verify the Miller
  cut, slab normal, wrapping, and vacuum estimate before engine handoff.
  `get_orthogonal_c_slab()` is an explicit fallback only when an orthogonal `c` cell is
  needed and the symmetry-breaking risk is recorded.
- Stoichiometry follows the chemical environment. For effectively fixed-valence or
  non-redox-active components under the modeled conditions, keep models
  charge-balanced and close to expected stoichiometry unless a compensating defect,
  adsorbate, or source precedent justifies otherwise. For redox-active or
  variable-valence components, non-stoichiometry, vacancies, hydroxylation, or
  element-rich terminations can be acceptable when tied to the declared synthesis,
  gas, solvent, electrochemical, or reservoir condition.
- Slab/facet/adsorbate models need a structure release gate: literature/precedent for Miller index and termination where available, or a labeled exploratory/no-precedent-found record for niche systems, then numerical geometry audit of slab dimensions, `c`-axis orthogonality, vacuum lower/upper bounds, computational economy, closest contacts with element-pair covalent-radius thresholds/margins, adsorbate-surface distances, and periodic-image separation.
- Vacuum is part of the model and the cost review. For large lateral cells or systems
  with vacuum in two or three directions, do not keep 15-25 Å by habit; reducing an
  already noninteracting vacuum direction to about 10 Å is often the right DFT
  economy choice when periodic-image interactions, dipoles, charged-cell corrections,
  and the target property remain acceptable. Record the reduced-vacuum rationale and
  any convergence/limitation note. When using `audit_structure.py`, set the relevant
  `--min-vacuum` or `--min-vacuum-adsorbate` threshold explicitly for the accepted
  economy case instead of ignoring a default lower-bound failure.
- Structure-generation scripts stop at candidate structures and validation/audit artifacts.
  They must not write scheduler scripts, call `sbatch`/`qsub`, or create final engine
  input packs before structure gate acceptance. Any function that mutates coordinates,
  lattice vectors, periodicity, or atom count must not write `INCAR`, `KPOINTS`,
  `POTCAR`, `submit.sh`, or call the scheduler in the same call path. Split mixed
  helpers such as `generate_case()` into a structure-only function and a separate
  engine-input function that starts from a reviewed structure. In `.research`
  workflows, run
  `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/check_structure_generator_boundary.py --forbid-engine-inputs`
  on such scripts before accepting the structure-modeler task.
- Originals preserved; derived structures to new paths; database structures carry their entry ID.

## Handoff

Periodic DFT → `vasp`. Molecular QC → `gaussian`. Biomolecular/liquid/membrane MD → `gromacs`. Materials/reactive/MLP MD → `lammps` (note unit/atom-style requirements). Report output files, formula, atom count, and every assumption.
