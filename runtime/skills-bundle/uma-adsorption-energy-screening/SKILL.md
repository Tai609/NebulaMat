---
name: uma-adsorption-energy-screening
description: Run a governed same-model UMA/fairchem adsorption-energy screen for an explicit slab, isolated adsorbate, and adsorbed slab triplet, including provenance checks, composition/cell validation, optional consistent relaxation, sign-convention reporting, and uncertainty limits. Use whenever a user asks to calculate adsorption energy, binding energy, E_ads, or UMA/fairchem screening for a surface and adsorbate.
---

# UMA Adsorption Energy Screening

Treat UMA as an initial machine-learning energy/force screen, not as DFT or a free-energy calculation. Never invent an adsorbate, place it automatically, or turn one uncalibrated adsorption value into an activity, selectivity, stability, or experimental claim.

For detailed parameter defaults, cohort-comparison rules, and calibration requirements, load [references/parameter-policy.md](references/parameter-policy.md) when reviewing or changing a run protocol.

## Workflow

1. **Require an explicit triplet.** Obtain three distinct structures: the standardized slab, the isolated adsorbate, and the combined adsorbed slab. If any structure or its placement is missing, stop and ask for it. Do not construct an adsorbate from a formula or silently choose a site.
2. **Normalize the cohort first.** Use `standardize_uma_adsorption_structure_set` when the three files are not already one passing adsorption-set manifest. It verifies that the slab is a standardized surface, that the combined atom count and composition equal slab plus adsorbate, and that slab/adsorbed cells and periodic-boundary flags match. Use the normalized `slab.extxyz`, `adsorbate.extxyz`, and `adsorbed.extxyz` artifacts for UMA.
3. **Check surface consistency.** Confirm the slab and adsorbed manifests share the same Miller index and layer count, and retain the surface policy, vacuum, coverage, and in-plane cell. Do not compare different coverages or cells as though they were one adsorption-energy cohort.
4. **Choose single-point versus relaxation.** Default to `relax=false`, which preserves the supplied MatterSim-relaxed or manually prepared geometry. Set `relax=true` only when a same-model relaxation is explicitly intended. Then provide bottom-layer `freeze_indices` for both slab and adsorbed ordering, use the same `fmax` and `max_steps` for all three structures, and inspect the relaxed artifacts for slab translation or reconstruction. The isolated adsorbate is not frozen.
5. **Use one model, task, and device.** Default to logical model `uma-s-1p2p1`, task `oc25`, and `cuda`. Use the pinned local weights when available; otherwise verify the fairchem registry/Hugging Face access. Do not mix UMA tasks, models, devices, MatterSim energies, or VASP energies within the three-energy expression.
6. **Run the governed tool.** Prefer MCP `run_uma_adsorption_energy_screen`; use `materials-uma-screen` only as the project CLI fallback. Write JSON and any relaxed artifacts into a new workspace-relative output directory. Do not silently download weights or overwrite prior results.
7. **Audit the result.** Require `status=completed`. Record all three input paths and SHA-256 hashes, formulas, atom counts, standardization manifests, model name, task, fairchem version, device, relaxation protocol, three energies, the sign convention, `adsorption_energy_ev`, warnings, and `uncertainty.status`. Also record the pinned local weight hash from `materials/runtime.json` when the bundled checkpoint is used.
8. **Interpret conservatively.** Under the recorded convention, `E_ads < 0` is exothermic and `E_ads > 0` is endothermic. `uncertainty.status=not_calibrated` is mandatory until representative same-protocol VASP calculations calibrate the surface/adsorbate family. The result omits implicit solvent, potential, pH, electric field, coverage correction, entropy, zero-point energy, reconstruction, and kinetic barriers unless explicitly represented by the supplied model and structures.

## Parameter Rules

- Use `model_name="uma-s-1p2p1"` and `task_name="oc25"` for the default electrocatalysis screen. The adapter may resolve the pinned local checkpoint or the fairchem registry alias; report which source was used and preserve the configured weight SHA-256.
- `device="cuda"` is the normal production choice. Use `cpu` only for a deliberate smoke test or when the registered GPU environment is unavailable, and report the environment change.
- Defaults are `relax=false`, `fmax_ev_per_angstrom=0.05`, `max_steps=200`, and no frozen indices. Do not enable relaxation without deciding the frozen slab atoms and inspecting the output geometry.
- `fmax_ev_per_angstrom` must be finite and positive; `max_steps` must be an integer from `1` to `10000`. Increase the step budget only after diagnosing non-convergence.
- `freeze_indices` are zero-based indices in the slab and adsorbed-system atom ordering; they are not applied to the isolated adsorbate. Use the same slab indices in both structures and keep them in the bottom layers selected by the surface protocol.
- Keep the slab and adsorbed slab cell exactly identical. The isolated adsorbate must use an explicit reference cell, periodic-boundary convention, charge, spin, and orientation appropriate to the study; document these assumptions because the tool does not infer them.
- Keep the adsorption coverage and surface cell fixed for a ranking cohort. An in-plane `2 x 2 x 1` expansion belongs to the separate [UMA surface-MD skill](../uma-surface-md/SKILL.md), not an implicit change to this three-energy calculation.
- Use a unique workspace-relative `output_dir` and optional `output_path` under it. Never write results to `runtime/uma`, the repository root, another session, or a remembered absolute path.

## Tool Contract

Use the MCP tool with the equivalent arguments below:

```text
run_uma_adsorption_energy_screen(
  slab_path=<standardized surface artifact>,
  adsorbate_path=<standardized isolated adsorbate artifact>,
  adsorbed_path=<standardized adsorbed-surface artifact>,
  model_name="uma-s-1p2p1",
  task_name="oc25",
  device="cuda",
  relax=false,
  fmax_ev_per_angstrom=0.05,
  max_steps=200,
  freeze_indices=[],
  output_dir=<workspace-relative run directory>,
  output_path=<optional workspace-relative JSON artifact>
)
```

CLI fallback:

```text
materials-uma-screen --task oc25 --device cuda \
  --slab <standardized-slab.extxyz> \
  --adsorbate <standardized-adsorbate.extxyz> \
  --adsorbed <standardized-adsorbed.extxyz> \
  --output-dir <run-directory> \
  --output-json <run-directory>/uma-result.json
```

Add `--relax` and repeated `--freeze-index <zero-based-index>` only after the relaxation protocol has been approved. The tool computes exactly `E(slab+adsorbate) - E(slab) - E(adsorbate)` in eV.

## Failure Handling

Classify failures as missing/invalid triplet (hold and request explicit structures), provenance/cell/composition mismatch (rerun the standardizer), environment/weights (report native, WSL2, fairchem, and Hugging Face status without blind download), relaxation/convergence (inspect forces and relaxed artifacts), or interpretation (retain `not_calibrated`). A missing manifest, hash mismatch, model/task mismatch, non-finite energy, failed relaxation, or partial output must not be used for ranking or downstream claims.
