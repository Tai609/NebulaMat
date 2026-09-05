# UMA Adsorption-Energy Parameter Policy

Use this reference when choosing or reviewing parameters for a UMA adsorption-energy run. The governing calculation is a same-protocol energy difference, not a replacement for a calibrated electronic-structure calculation.

## Required inputs and provenance

- Supply three explicit, readable structure artifacts: a slab, the isolated adsorbate, and the adsorbed slab. Preserve the adsorption geometry supplied by the user; the tool does not place, orient, or identify an adsorbate.
- Prefer outputs of `standardize_uma_adsorption_structure_set`. A passing manifest must identify the three files, input hashes, formulas, atom counts, Miller index/layer policy, cell, vacuum, coverage, periodic-boundary convention, charge, and spin assumptions.
- The slab and adsorbed slab must have identical cells, periodic flags, surface orientation, layer policy, and coverage. Their composition and atom counts must differ from the slab by exactly the isolated adsorbate composition and atom count.
- Keep a unique workspace-relative output directory and retain the raw tool JSON, normalized structures, manifest, warnings, and checkpoint identity together. Never overwrite an earlier run or silently replace a path with a same-named file.

## Defaults and allowed changes

| Parameter | Default | Policy |
| --- | --- | --- |
| `model_name` | `uma-s-1p2p1` | Keep fixed within a three-energy cohort. Record the registry alias or local checkpoint source. |
| `task_name` | `oc25` | Keep fixed within a three-energy cohort. Do not mix task heads. |
| `device` | `cuda` | Use `cpu` only for a deliberate smoke test or documented GPU unavailability. Do not compare device-dependent runs without noting the change. |
| `relax` | `false` | Single-point is the default and preserves the supplied geometry. |
| `fmax_ev_per_angstrom` | `0.05` | Positive finite value; only relevant when `relax=true`. |
| `max_steps` | `200` | Integer in `1..10000`; increase only after diagnosing non-convergence. |
| `freeze_indices` | `[]` | Zero-based slab and adsorbed-system indices for bottom-layer atoms; never apply them to the isolated adsorbate. |

When `relax=true`, use one relaxation protocol for all three energies: same model, task, device, force threshold, and step limit. For a slab, freeze the bottom layers selected by the surface policy and use the corresponding indices in the adsorbed structure. Inspect final forces, cell/periodic metadata, atom ordering, and any surface translation or reconstruction before using the energy difference. A failed or partial relaxation is not a valid result.

The isolated adsorbate requires an explicit reference cell, periodic-boundary setting, charge, spin, and orientation. Do not infer these values from a formula or from the slab. Do not apply the surface `2 x 2 x 1` expansion here; that expansion belongs to the separate UMA surface-MD protocol. Keep in-plane cell and coverage fixed when ranking a cohort.

## Energy and comparison rules

Compute exactly:

```text
E_ads = E(slab + adsorbate) - E(slab) - E(adsorbate)
```

Report all three total energies in eV, their input hashes, and the sign convention. Under this convention, a negative value is exothermic and a positive value is endothermic. Energies from MatterSim, VASP, or different UMA model/task/device settings must not be substituted into this expression.

Only compare values when the cohort shares the same model checkpoint, task, device policy, slab cell/orientation/layer policy, adsorbate reference convention, charge/spin policy, relaxation protocol, and coverage. A lower value is a descriptor for the supplied model and geometry; it is not by itself a claim of catalytic activity, selectivity, stability, or experimental feasibility.

## Calibration and uncertainty

Set `uncertainty.status` to `not_calibrated` unless representative same-protocol VASP reference calculations have established an error model for the relevant surface, adsorbate, coverage, and charge/spin family. Do not manufacture error bars from the three energies or report a generic model MAE as a case-specific interval.

Always state that the screen omits, unless explicitly modeled elsewhere: zero-point energy, entropy, implicit solvent, electrode potential, pH, electric field, coverage corrections, reconstruction pathways, and kinetic barriers. A VASP or experimental follow-up is required before high-stakes claims.
