# MatterSim Parameter Policy

The adapter and MCP schema are authoritative. This reference explains how to choose parameters without weakening the provenance or cost gates.

## Supported Structure Kinds

| Kind | Relax atoms | Relax cell | Interpretation |
| --- | --- | --- | --- |
| `bulk` | Yes | Optional | Primary MatterSim regime. A converged result is a force/geometry proxy. |
| `slab` | Yes | **No** | Keep the standardized slab cell and vacuum fixed. Surface energies remain qualitative. |
| `interface` | Yes | Optional | Use cell relaxation only when explicitly requested and physically justified. |
| `molecule` | Yes | No | Single-point or atomic relaxation check; not a periodic bulk stability result. |

`relax_cell=true` is rejected for `slab` and `molecule`. For slabs, do not use ordinary cell relaxation to change vacuum or layer spacing.

## Defaults and Bounds

| Field | Default | Bound or decision |
| --- | --- | --- |
| `model_path` | `5m` alias | Resolves to `mattersim-v1.0.0-5M.pth`; bundled SHA-256 is `e3df9fa708725e3d453140646c7d1838324b347a3d1214cf1440522146f872b5`. |
| `device` | `cuda` | Use `cpu` only deliberately; report environment and performance tradeoff. |
| `relax` | `true` | Set `false` for a single-point initial energy/force/stress evaluation. |
| `relax_cell` | `false` | Keep false for comparisons and all slabs; true only for explicit bulk/interface cell optimization. |
| `fmax_ev_per_angstrom` | `0.05` | Finite and positive; tighten only for a stated convergence need. |
| `max_steps` | `200` | Integer `1..10000`; increase after diagnosing non-convergence. |
| `max_displacement_angstrom` | `0.75` | Finite and positive geometry-change gate. |
| `structure_kind` | `bulk` | One of `bulk`, `slab`, `interface`, `molecule`. |
| `output_dir` | none | New, workspace-relative run directory; never overwrite by default. |

## Provenance Gate

Before calling MatterSim, locate the standardized artifact and its manifest. The adapter checks the expected artifact kind (`bulk` maps to standardized bulk; `slab` maps to standardized surface), the manifest, and the hash. Keep these records with the result:

- input path, input SHA-256, formula, and atom count;
- standardization manifest path and standardized kind;
- model id, checkpoint filename, checkpoint SHA-256, package version, device, and source URL;
- protocol fields (`relax`, `relax_cell`, `fmax`, `max_steps`, displacement limit).

Raw MatterGen `structure-*.cif` files are never valid MatterSim inputs. A copied or manually rewritten file must be re-standardized so its hash-bearing manifest is authoritative.

## Result Interpretation

Record both `initial` and `final` properties. `energy_ev` is the total MatterSim potential energy for that input; `energy_per_atom_ev` is useful for same-composition comparisons only. `max_force_ev_per_angstrom` and `stress_gpa` describe the force-field result, not DFT observables. `relaxation.status=converged` means the final maximum force met the requested `fmax`; `not_converged` is a hold. The decision also requires maximum displacement no larger than the requested limit.

Never call `energy_per_atom_ev` an energy above hull, formation energy, adsorption energy, or experimental stability. Do not mix MatterSim energies with UMA or VASP energies in one expression. Calibrate slab/interface rankings with representative same-protocol VASP calculations before scientific or experimental selection.

## Cohort Comparisons

For ranking multiple candidates, use one fixed model/checkpoint, device policy, structure kind, standardization policy, relaxation mode, and convergence budget. Keep compositions and reference states comparable. Report failed or held candidates separately; do not drop them silently. A bulk pass may route to surface construction/UMA, while a slab pass may route to UMA adsorption screening, but neither route is automatic evidence of stability.
