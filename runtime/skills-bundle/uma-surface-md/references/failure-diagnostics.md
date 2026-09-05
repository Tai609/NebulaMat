# UMA Surface MD Failure Diagnostics

Use this reference after preserving the raw output and before changing model or GPU settings.

## Failure matrix

| Observation | First hypothesis | Required check | Decision |
| --- | --- | --- | --- |
| CUDA error at step 0 | Invalid geometry, unsupported fast backend, or stale context | Fresh process; validate finite coordinates and MIC distances; run one CPU/general and one GPU/general forward | Do not label it a model failure until the clean-process probes agree |
| First forward is finite, then `T` or `Ekin` explodes | Unrelaxed structure, timestep too large, wrong friction, or bad PBC | Record initial `maxF`; run LBFGS; use `pbc=(True,True,False)`; reduce timestep; verify friction units | Hold the trajectory and rerun from a relaxed structure |
| Second adsorbate has zero records after first CUDA failure | Reused a poisoned CUDA context | Run one adsorbate per process and terminate on any CUDA exception | Treat the second result as invalid until independently rerun |
| Minimum distance passes but force is several eV/A | Geometry is collision-free but not at a local minimum | Run a same-model pre-relaxation and inspect final forces | Do not start production MD from the raw geometry |
| H2O fails immediately with an unusually short H-H bond | Vector-construction or broadcasting bug | Check O-H, H-H, and H-O-H geometry explicitly; inspect the exact extxyz used | Rebuild the adsorbate deterministically; do not patch coordinates by eye |

## Clean-process backend probe

Set `CUDA_LAUNCH_BLOCKING=1` before importing torch. Load the checkpoint with a custom `InferenceSettings` object for the diagnostic pass:

```python
import torch
from fairchem.core.units.mlip_unit import InferenceSettings, load_predict_unit

settings = InferenceSettings(
    execution_mode="general",
    compile=False,
    tf32=False,
    merge_mole=False,
    activation_checkpointing=True,
    base_precision_dtype=torch.float32,
)
predictor = load_predict_unit(
    checkpoint,
    inference_settings=settings,
    device="cuda",
)
```

Run exactly one energy/force evaluation in a fresh process, then repeat with `device="cpu"`. If both are finite, test the trajectory separately. If only the automatic/Triton path fails, preserve the fairchem version, torch/CUDA version, GPU compute capability, checkpoint hash, and minimal structure before filing a backend issue.

## Geometry checks

```python
atoms.set_pbc((True, True, False))
distances = atoms.get_all_distances(mic=True)
distances[distances == 0] = float("inf")
minimum_distance = distances.min()
```

Do not use `np.linalg.inv(cell.T)` for ASE row-vector cells. Do not loop over a z-periodic image for a slab. Report the global minimum, the adsorbate-to-slab minimum, and expected intramolecular distances separately. For a manually built H2O, construct two unit vectors in a plane, for example `d1 = cos(theta/2)*normal + sin(theta/2)*tangent` and `d2 = cos(theta/2)*normal - sin(theta/2)*tangent`; never add a scalar `+/- 0.5` to a 3-vector as a substitute for the second tangent direction.

## Safe restart sequence

1. Copy the original input into a new run directory and record its SHA-256.
2. Validate the standardized manifest, cell, composition, pbc, finite coordinates, and distances.
3. Probe one fresh forward with CPU/general and GPU/general.
4. Pre-relax with the bottom slab layers fixed to `maxF <= 0.05 eV/A` where possible.
5. Run a short 100-500 step test at `0.1-0.25 fs`, with finite-value, collision, temperature, force, and velocity guards.
6. Only after the short test is clean, use the governed 0.5 fs protocol and multiple seeds.
7. If any CUDA exception occurs, stop the process, preserve the traceback and last frame, and restart the next system in a new process.

Do not hide failures by catching an exception and writing `status=completed`. A failed replica or missing trace is a quality-gate hold, not evidence of stability.
