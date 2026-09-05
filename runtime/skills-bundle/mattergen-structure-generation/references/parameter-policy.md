# MatterGen Parameter Policy

This file supplements the skill's parameter rules. The current runner schema and its dry-run output always take precedence; these recommendations must not loosen runner hard limits.

## Request Fields

| Field | Default/range | Selection guidance |
| --- | --- | --- |
| `schema_version` | `1` | Use only the schema supported by the runner. |
| `output_dir` | `materials/design/<iteration>/mattergen` | Keep it in the active workspace and make it a new empty directory. |
| `pretrained_name` | `chemical_system` | Mutually exclusive with `model_path`; the bundled checkpoint conditions on chemical system for bulk candidates. |
| `model_path` | none | Use only for an explicitly supplied, existing workspace-local checkpoint; never record a machine-private absolute path. |
| `batch_size` | Start at 8 or 16, `1..64` | Use a small batch when GPU memory is unknown; reduce it on OOM without skipping audit. |
| `num_batches` | `1..32` | Keep `batch_size * num_batches <= 1024`; increase batches before increasing batch size for more candidates. |
| `properties_to_condition_on` | `{}` | Fill only properties the model was trained on. The `chemical_system` model normally receives `{"chemical_system":"Li-Fe-O"}`. |
| `target_compositions` | `[]` | Use only with a CSP checkpoint; each element count must be a positive integer. Keep empty for the default model. |
| `diffusion_guidance_factor` | `0` or omitted, runner allows `0..20` | Use only for trained conditions; start around `1..2` when justified because high values trade away diversity. |
| `record_trajectories` | `false` | Enable only for an explicit diagnostic or visualization request. |
| `standardization` | enabled, bulk about 40 atoms | Raw CIFs are not calculation inputs; surface fields must be supplied as a consistent group. The electrochemical adsorption workflow overrides the bulk target to about 60 atoms and uses an explicit six-layer surface policy. |

## Chemical System versus Formula

`chemical_system` uses hyphen-separated element symbols, such as `Li-Fe-Mn-Mg-P-O`. It expresses an allowed element set, not atom ratios. When a user asks for `LiFePO4`, confirm whether they want the `Li-Fe-P-O` candidate set or the exact `Li:Fe:P:O = 1:1:1:4` CSP condition. The former can use the default checkpoint; the latter requires a CSP checkpoint and `target_compositions: [{"Li":1,"Fe":1,"P":1,"O":4}]` with the `csp` sampling configuration.

Check element symbol case and duplicate elements. Do not put oxidation states, charge, dopant fractions, or oxygen vacancies into the chemical-system string. If a user requests a dopant ratio, record it as an explicit composition constraint rather than silently rewriting the element set.

## Guidance and Multiple Properties

Guidance is not a quality knob. It controls adherence to a trained condition: `0` is unguided, while larger values generally reduce diversity and can harm realism. Permit a property only when the checkpoint exposes that trained field; for example, `chemical_system_energy_above_hull` can condition on both `chemical_system` and `energy_above_hull`. Preserve units and provenance for numeric conditions. Do not put a DFT result or a stability conclusion into a MatterGen request unless it is genuinely a model training label.

## Standardization Policy

Default bulk policy:

```json
{
  "enabled": true,
  "bulk_target_atoms": 40,
  "bulk_atom_tolerance": 0.2,
  "surface_miller_index": null,
  "surface_layers": null,
  "surface_target_atoms": 40,
  "surface_atom_tolerance": 0.2,
  "vacuum_angstrom": 15,
  "min_distance_angstrom": 0.8,
  "termination_index": 0
}
```

Here "standardization" specifically means expanding a MatterGen small cell into the declared bulk atom-count window, or building a comparable slab when explicit surface parameters are supplied. Sorting atoms, reducing a formula, rewriting symmetry notation, or rewriting an unchanged CIF/POSCAR is not standardization. Miller index and layer count must be supplied together; never expand along vacuum. An adsorption set must retain consistent provenance for the slab, isolated adsorbate, and adsorbed slab.
