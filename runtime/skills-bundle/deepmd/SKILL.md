---
name: deepmd
description: DeePMD-kit and Deep Potential Molecular Dynamics workflows. Use for dpdata dataset conversion from VASP/CP2K, DeepMD input.json setup, dp train/freeze/compress/test, DP descriptor PCA/t-SNE dataset-distribution visualization, DP model deviation, DPLibrary reuse checks, and LAMMPS DPMD deployment.
---

# DeePMD-kit / DPMD

Deep Potential Molecular Dynamics uses a trained DP model to provide energies and forces during MD. The MD workflow is the same statistical sampling problem as AIMD; the force provider changes from DFT to the learned potential.

## Where to find what

| Situation | Go to |
|---|---|
| prepare dpdata datasets, write `input.json`, train/freeze/compress/test, run LAMMPS DPMD | `references/running.md` |
| scheduler/job script for `dp train`, GPU training, `dp test`, or DPMD deployment | `__NEBULAMAT_AICC_ROOT__/tools/hpc-submit/SKILL.md`; read the target `~/.cluster-agents.md` before writing the script |
| decide whether a DP model is usable, read `lcurve.out`/`dp test`, model-deviation thresholds, or read the automatic DPMD handoff verdict | `references/validation.md` |
| visualize dataset coverage/distribution with short DPA1 descriptors, PCA, or t-SNE | `references/dataset-embedding.md` |
| run the default one-chain DeepMD workflow: `dp train` -> lcurve plot -> `dp freeze` -> `dp test` -> parity plots -> DFT train/val/test PCA -> QA verdict | `scripts/run_deepmd_chain.py`; see `references/running.md` |
| produce or debug individual post-training diagnostics | `scripts/plot_deepmd_postprocess.py`, `scripts/deepmd_descriptor_pca.py`, `scripts/check_deepmd_qa.py` |
| training fails, NaN loss, bad metrics, type-map mismatch, MD instability | `references/errors.md` |
| DeepMD docs, DP-GEN, DPLibrary, related MLP programs | `references/resources.md` |
| working examples to copy and adapt | `examples/` |

## Hard guardrails

- The training distribution must cover the production task: composition, phase, defects/interfaces, volume/strain, temperature, and relevant reactive/diffusive events.
- Default initial-dataset strategy: generate more DFT/AIMD labels from multiple
  physically plausible starting models and multiple temperatures before training the
  first production DP model. Prefer this direct coverage expansion over default
  4-model committee active learning unless the user explicitly requests concurrent
  learning, model-deviation exploration, or the validation risk justifies the cost.
- Unless there is a documented special reason, collect at least `10000` filtered
  DFT-labeled frames before the first dataset split and production training. Count
  converged, chemically sensible frames after filtering, not raw AIMD ionic steps. If a
  smaller set is used for a smoke test, expensive pilot, strict reproduction, or
  user-directed quick run, label the result as non-production/pilot until more labels
  are added.
- For high-temperature diffusion, transport, or reactive MD work, include training
  frames at temperatures at least as high as the final DPMD temperature;
  low-temperature-only AIMD gives a narrow potential-energy surface.
- One dataset means one DFT method fingerprint: functional, ENCUT/basis, k-point policy, U values, spin policy, convergence thresholds, and pseudopotential family.
- The `type_map` order is a contract. It must match dpdata output and LAMMPS atom types.
- Production DPMD requires validation outside the training frames: held-out error,
  learning-curve review, parity plots, dataset coverage checks, physics checks, and
  short stability tests. A 4-model committee model-deviation monitor is optional and
  should be used only when requested or when uncertainty/extrapolation risk is the main
  objective.
- Default DeepMD execution is chained, not interactive. After DFT label sources are
  identified, proceed through conversion/splitting, `dp train`, learning-curve plot,
  `dp freeze`, held-out `dp test`, parity plots, DFT-all descriptor PCA, and the QA
  verdict without pausing between phases. Stop only for a failed command, missing
  required data, an unresolved scientific choice, or a long/expensive DPMD submission
  that has not already been approved.
- Dataset PCA/t-SNE maps are coverage diagnostics only. They can reveal missing or duplicated regions, but they do not replace `dp test`, model deviation, or physics validation.
- Before LAMMPS DPMD handoff or report use, run the fixed chain or create the fixed
  DeepMD QA package:
  `deepmd_lcurve_energy_force_lr.png`, `deepmd_dp_test_energy_parity.png`,
  `deepmd_dp_test_force_parity.png`, `deepmd_dp_test_force_residual_hist.png`,
  `deepmd_descriptor_pca_dft_all.png`, `postprocess_summary.json`, and
  `deepmd_descriptor_pca_dft_all/summary.json`. Run `scripts/check_deepmd_qa.py`
  against the package and do not treat the model as handoff-ready until the automatic
  verdict passes or a visible waiver/limitation is recorded.
- The descriptor PCA for the fixed QA package is run over all compatible DFT-labeled
  `train`, `val`, and `test` frames by default. DPMD trajectory overlays are useful
  follow-up diagnostics, but they do not replace the DFT-all split coverage map.
- Scientific observables come from equilibrated production trajectory segments only; use `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-dynamics.md` for MSD/RDF/VACF/free-energy interpretation and `__NEBULAMAT_AICC_ROOT__/knowledge/machine-learning-potentials.md` for MLP-wide principles.
