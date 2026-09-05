---
name: mlp
description: Umbrella routing for machine-learning interatomic potential workflows. Use for general MLP method choice and cross-program validation; route DeePMD-kit/DPMD operation to `deepmd`, and keep MACE, NequIP, GPUMD/NEP, LASP, GemNet-OC, EquiformerV2, and other programs in separate tool skills when detailed commands are needed.
---

# Machine-Learning Potentials

Covers MLP-wide routing and legacy generic notes. DeePMD-kit/DPMD now lives in `__NEBULAMAT_AICC_ROOT__/tools/deepmd`; future MACE, NequIP, GPUMD/NEP, LASP, GemNet-OC, EquiformerV2 content should live in their own tool skills. MD deployment mechanics live in `lammps`; DFT label generation in `vasp` or `cp2k`; tool-agnostic MLP science lives in `__NEBULAMAT_AICC_ROOT__/knowledge/machine-learning-potentials.md`.

## Where to find what

| Situation | Go to |
|---|---|
| DeePMD-kit/DPMD dataset prep, `input.json`, `dp train/freeze/test`, model deviation | `__NEBULAMAT_AICC_ROOT__/tools/deepmd/` |
| general MLP concepts, dataset design, symmetry/equivariance, program taxonomy | `__NEBULAMAT_AICC_ROOT__/knowledge/machine-learning-potentials.md` |
| legacy generic dataset prep, training configs, fine-tuning, deployment, active-learning loop | `references/running.md` |
| is this model production-ready? RMSE gates, physics checks, model-deviation thresholds | `references/validation.md` |
| training diverges, NaN loss, type-map mismatches, MD explodes despite good metrics | `references/errors.md` |
| working examples to copy and adapt | `examples/` |
| not covered locally (DeePMD/MACE/DP-GEN docs) | `references/resources.md` |

## Hard guardrails

- Only converged DFT frames become labels; one dataset = one method fingerprint (no mixed settings).
- Model quality is quoted from held-out data only — never training-set error.
- A potential is valid only inside its training distribution: production MD monitors model deviation; out-of-range frames are candidates for retraining, not data.
- Per-iteration provenance: dataset paths/hash, config, seeds, checkpoint, test metrics.
