---
name: mattersim-relaxation-screening
description: Run governed MatterSim-v1.0.0-5M energy, force, stress, and optional ASE FIRE relaxation for workspace-local standardized structures. Use whenever a user asks to relax a crystal, calculate MatterSim energy/forces/stress, screen MatterGen candidates, or evaluate a structure before MatterSim/UMA/VASP.
---

# MatterSim Relaxation and Screening

Treat MatterSim as a first-stage machine-learning force-field proxy. It provides geometry, energy, force, and stress evidence; it does not prove formation stability, energy above hull, aqueous stability, surface stability, synthesizability, or experimental performance.

## Workflow

1. **Select the structure and kind.** Use one of the adapter kinds: `bulk`, `slab`, `interface`, or `molecule`. Decide whether the user wants a single-point evaluation (`relax=false`) or an atomic relaxation (`relax=true`). A relaxed energy is not interchangeable with the initial energy.
2. **Gate the input provenance.** Read the source run manifest when available (the MatterGen run manifest for MatterGen candidates) and the standardization manifest. Use only the manifest-listed standardized artifact with a matching SHA-256. Raw `structure-*.cif`, an untracked copied CIF, or a file whose manifest/hash is missing is an immediate `hold`; do not bypass this gate by reserializing the raw structure.
3. **Choose cell behavior deliberately.** Keep `relax_cell=false` by default for comparable energies and for every `slab`. Set `relax_cell=true` only for an explicitly requested bulk/interface cell optimization; record that the lattice and stress interpretation changed. The adapter rejects cell relaxation for `slab` and `molecule`.
4. **Check the environment.** Prefer the governed MCP tool `run_mattersim_stability_screen`. If using the CLI, use the project entry point `materials-mattersim-screen`; never call an unpinned upstream script. Check the isolated materials environment (`torch`, `mattersim`, `ase`) and the registered Linux/WSL2 runtime (typically `/root/fairchem/venv/bin/python`) before installing anything. The checkpoint is not downloaded implicitly; use the bundled file or the explicit `NEBULAMAT_MATTERSIM_MODEL` path.
5. **Run a bounded request.** Create a new output directory inside the active workspace and call the tool with the chosen kind, device, relaxation, cell, convergence, displacement, and output parameters. For multiple structures, keep one directory and JSON result per input, with the same protocol across the cohort.
6. **Audit the result.** Require `status=completed` and inspect the recorded model id, package version, checkpoint SHA-256, input SHA-256, formula, atom count, initial/final energy, energy per atom, maximum force, stress, relaxation status, displacement, cell change, decision, and limitations. Preserve `mattersim-relaxed.extxyz` when relaxation was run and the machine-readable JSON result.
7. **Route conservatively.** `promote_to_next_stage` means only that the relaxation converged and the geometry-change limit passed. A converged bulk proxy may proceed to explicit surface construction and/or UMA screening; a standardized slab may proceed to UMA adsorption screening. Surface results remain qualitative until representative same-protocol VASP calibration.

## Parameter Rules

- Use the fixed `MatterSim-v1.0.0-5M` model and record its checkpoint SHA-256. Do not silently substitute another MatterSim version, checkpoint, or force field.
- Default `device` is `cuda` when the registered GPU environment is available; use `cpu` only for a deliberate smoke test or when CUDA is unavailable, and report the change because runtime and numerical behavior may differ.
- Default `relax=true`, `relax_cell=false`, `fmax_ev_per_angstrom=0.05`, `max_steps=200`, and `max_displacement_angstrom=0.75`. Reduce `fmax` only for a stated convergence requirement; increase `max_steps` only after inspecting why the bounded run did not converge.
- `fmax_ev_per_angstrom` and `max_displacement_angstrom` must be finite and positive. `max_steps` must be an integer from `1` to `10000`; do not use a large limit to hide unstable structures.
- `bulk` is the primary trained regime. `slab` and `interface` are pre-screen proxies; do not compare their energy per atom to bulk energy per atom as a surface or formation energy. `molecule` is allowed for a single-point/atomic check but is not a bulk stability result.
- Keep composition, cell convention, standardization policy, model, device, and protocol identical when ranking a cohort. Energy per atom is not comparable across different compositions without a consistent reference scheme; never label it Materials Project energy above hull.
- Use a unique workspace-relative `output_dir`. Do not overwrite prior runs, write into `runtime/mattersim`, or use a remembered absolute path. If a JSON artifact is requested, keep it under the same run directory and retain the input/output hashes.

## Tool Contract

Use the MCP tool with the equivalent arguments below (omit optional fields only when using the documented defaults):

```text
run_mattersim_stability_screen(
  structure_path=<standardized bulk.cif or surface.cif>,
  model_path="5m",
  device="cuda",
  structure_kind="bulk",
  relax=true,
  relax_cell=false,
  fmax_ev_per_angstrom=0.05,
  max_steps=200,
  max_displacement_angstrom=0.75,
  output_dir=<workspace-relative run directory>,
  output_path=<optional workspace-relative JSON artifact>
)
```

For CLI fallback:

```text
materials-mattersim-screen --structure <standardized-structure> \
  --structure-kind bulk --device cuda --output-dir <run-directory> \
  --output-json <run-directory>/mattersim-result.json
```

The CLI's `--relax-cell` is permitted only for `bulk` or `interface`; `--no-relax` performs the initial property evaluation without FIRE optimization.

## Failure Handling

Classify failures as provenance/input (repair the standardization or path and stop), environment/checkpoint (report native, WSL2, and remote status without blind installation), numerical convergence (inspect forces, displacement, cell change, and step count), or interpretation (do not upgrade a proxy into a stability claim). A missing or mismatched manifest, non-finite property, invalid structure kind, failed model load, or partial output is `hold` and must not feed an expensive next stage.
