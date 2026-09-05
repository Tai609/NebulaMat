---
name: uma-surface-md
description: Run and diagnose governed ASE plus fairchem UMA molecular dynamics on standardized adsorbed slabs, including NVT/NVE surface trajectories, pre-relaxation, periodic-boundary and collision checks, CUDA/backend triage, and auditable quality gates. Use when a user asks for UMA/fairchem surface MD, adsorbate dynamics, slab thermal screening, trajectory generation, or explains a UMA MD divergence, NaN/Inf, temperature explosion, or CUDA illegal-instruction failure.
---

# UMA Surface MD

Treat UMA surface MD as an initial ML-potential dynamics screen, not DFT-AIMD, free-energy sampling, or proof of thermal stability. Preserve standardized input lineage and stop on failed quality gates; never turn a trajectory into a mechanistic, activity, or experimental claim without same-protocol DFT checks.

## Workflow

1. **Require a governed input.** Accept only the `adsorbed.extxyz` artifact produced by `standardize_uma_adsorption_structure_set`, with a passing adsorption-set manifest and matching slab/adsorbed provenance. Do not invent, reposition, or silently repair an adsorbate from a formula. Keep the original file, manifest, hashes, model, task, device, and output directory together.
2. **Validate slab periodicity and geometry.** A surface slab must use `pbc=(True, True, False)`; never replicate the vacuum direction and never use ordinary 3-D NPT. Check both the global minimum distance and adsorbate-to-slab minimum distance. Use ASE `atoms.get_all_distances(mic=True)` after correcting `pbc`; do not hand-roll MIC with `inv(cell.T)` because ASE cell vectors are rows. Do not treat a minimum-distance threshold as a stability test: evaluate the initial energy and maximum force, and pre-relax adsorbed slabs by default.
3. **Reject construction bugs before model loading.** For OH/H2O, verify covalent bond lengths and angles, periodic-image separation, finite coordinates, and atom ordering. A scalar broadcast in a three-dimensional H2O placement expression can create an unphysical H-H contact even when the adsorbate-to-slab distance looks safe. Keep expected intramolecular bonds visible in the report; do not hide them by reporting only one filtered minimum distance.
4. **Use the governed runner.** Prefer `run_uma_surface_md` or `materials-uma-md`. Its default protocol is model `uma-s-1p2p1`, task `oc25`, device `cuda`, in-plane `2 x 2 x 1` expansion, bottom two slab planes fixed, NVT at 300 K, 0.5 fs timestep, pre-relaxation to `fmax=0.05 eV/A`, three seeds, finite-value and collision guards, and auditable trajectories/thermo/representative/closest-contact artifacts. Never overwrite a prior output directory.
5. **Use conservative dynamics for H/O systems.** For a manual ASE run or a diagnostic rerun, start at `0.1-0.25 fs`, then increase only after a short stable test. ASE Langevin friction is an inverse-time quantity: `friction=0.001 / units.fs` represents approximately `1 ps^-1`; `1.0 * units.fs` is dimensionally wrong and is approximately `9.65 ps^-1`. Initialize with `thermalize_momenta` (or the ASE fallback), `Stationary(..., preserve_temperature=True)`, and `fixcm=False`.
6. **Pre-relax before MD.** Freeze the bottom slab layers, attach the UMA calculator, run LBFGS with `fmax=0.05 eV/A` for at most 200 steps, and inspect the final maximum force and geometry. A supplied geometry with `maxF` around several eV/A is not a safe MD starting point even when no pair is below the collision threshold.
7. **Guard every trajectory.** Record finite energy, kinetic energy, temperature, forces, coordinates, velocities, and minimum distances. Abort on NaN/Inf, an unphysical collision, runaway temperature, or a force/velocity threshold selected for the system. Mark the run `hold` or `completed_with_failures`; do not continue into another adsorbate after a CUDA exception.
8. **Isolate CUDA failures.** Run each adsorbate in a fresh process. For diagnosis, set `CUDA_LAUNCH_BLOCKING=1`, run one forward with `execution_mode="general"`, `compile=False`, `tf32=False`, `merge_mole=False`, and `base_precision_dtype=torch.float32`, then compare with CPU/general. The automatic `execution_mode=None` may select the Triton `umas_fast_gpu` backend. If CPU/general and fresh GPU/general both return finite energy/forces, a later temperature explosion is numerical/trajectory failure rather than a deterministic first-forward CUDA bug. If a kernel fails, terminate that process and do not reuse its CUDA context.
9. **Audit and interpret.** Require `status=completed`, all replicas complete, finite-value and collision gates passed, and a recorded pre-relaxation result. Retain hashes, fairchem version, checkpoint identity, protocol, seeds, warnings, and anomalous frames. UMA-MD omits electrode potential, pH, implicit solvent, explicit electrolyte, entropy, reconstruction pathways, and kinetic barriers unless represented in the input/model; calibrate representative and closest-contact frames against same-protocol DFT before mechanistic claims.

## Protocol and Failure Reference

Load [references/failure-diagnostics.md](references/failure-diagnostics.md) when a run fails, when reviewing a custom MD script, or when changing defaults. It contains the failure matrix, clean-process backend probe, geometry checks, and the distinction between a true initial-forward failure and a stale CUDA-context error.

## Tool Contract

Use the governed tool with the equivalent arguments below:

```text
run_uma_surface_md(
  adsorbed_path=<standardized adsorbed.extxyz>,
  output_dir=<new workspace-relative directory>,
  model_name="uma-s-1p2p1",
  task_name="oc25",
  device="cuda",
  supercell=[2, 2, 1],
  ensemble="nvt",
  temperature_k=300,
  timestep_fs=0.5,
  equilibration_ps=5,
  production_ps=20,
  friction_per_fs=0.01,
  fixed_bottom_layers=2,
  pre_relax=true,
  fmax_ev_per_angstrom=0.05,
  max_relax_steps=200,
  seeds=[1729, 2718, 3141]
)
```

The governed runner's `friction_per_fs=0.01` is interpreted as `0.01 / units.fs` internally and corresponds to about `10 ps^-1`; report this actual convention. For H/O-rich manual diagnostics, use the fairchem README-compatible `0.001 / units.fs` unless a protocol has been deliberately calibrated.
