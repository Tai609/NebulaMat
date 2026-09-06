---
name: mattergen-structure-generation
description: Generate auditable candidate crystal structures with the project's pinned MatterGen runtime, including request construction, model/conditioning selection, GPU-cost bounds, workspace-safe output, dry-run preflight, CIF/hash checks, and manifest-backed standardization. Use whenever a user asks to generate, sample, design, or propose crystal/material structures with MatterGen or asks for a new inorganic crystal structure.
---

# MatterGen Structure Generation

Treat MatterGen as a candidate-structure generator, not as evidence of stability, synthesizability, or experimental performance. Every generation request must use the project runner and retain the request, run manifest, raw CIFs, standardized structures, and SHA-256 hashes. Do not call the upstream `mattergen-generate` command directly and bypass the runner.

## Workflow

1. **Classify the request.** Distinguish candidate bulk generation, exact-formula crystal structure prediction (CSP), and surface/adsorption work. The default model supports chemical-system-conditioned bulk candidates; it does not directly generate reliable slabs, adsorption sites, or catalytic conclusions. When the user provides only elements, use an element set and do not guess atom counts. When an exact formula is requested, first confirm that a CSP checkpoint is available.
2. **Complete and review parameters.** Read [parameter policy](references/parameter-policy.md). Ask for missing chemistry, model, sample count, or output intent, or use the documented safe defaults. Never silently increase sampling, switch models, or rewrite a formula into an element set.
3. **Create a workspace-local request.** Write a unique `materials/design/<iteration>/mattergen/request.json` in the active session workspace. Use schema version `1`; `output_dir` must stay inside the workspace and must not point to the repository root, another session, or an absolute path. Default to `pretrained_name: "chemical_system"`; `pretrained_name` and `model_path` are mutually exclusive.
4. **Run preflight first.** Use the runner named by `NEBULAMAT_MATTERGEN_RUNNER`:

   ```text
   <runner> --request <workspace-relative-request.json> --dry-run
   ```

   Stop on a dry-run failure. Do not replace the runner with a hand-written shortcut; it validates model source, workspace boundaries, sample limits, properties, and the standardization policy.
5. **Check the runtime before sampling.** If the desktop-managed environment is not ready, follow the project `AGENTS.md` read-only WSL2 probe using the current workspace's `tools.mattergen.runtime.wsl_python` value from `materials/runtime.json` (or its generated status receipt). Never assume a particular Windows username, WSL distribution, home directory, or fixed `/root/...` path. Reuse a passing WSL2 environment. Only use `NEBULAMAT_MATTERGEN_SETUP` when no usable environment exists, and follow the product approval flow. If native Windows lacks compatible CUDA/PyG wheels, use a registered Linux/WSL2/SSH GPU machine instead of reinstalling verified dependencies.
6. **Execute the same request.** Remove `--dry-run` only after preflight and environment checks pass. Do not overwrite a non-empty output directory; reusing one requires the runner's explicit `--allow-existing` flag and a recorded reason.
7. **Audit the result.** Read `mattergen-run.json` and verify `status=completed`, upstream revision, model, requested sample count, artifact count, and the SHA-256 of every `structure-*.cif`. Check `standardized/standardization-manifest.json` and each structure manifest. Mark the run `hold` for any hash mismatch, missing CIF, or standardization failure.
8. **Pass on standardized structures only.** Raw MatterGen CIFs are provenance/candidate inputs and must not go directly to MatterSim, UMA, or VASP. Downstream bulk work uses manifest-listed standardized bulk; surface work uses a standardized surface with explicit Miller index, layer count, in-plane expansion, atom-count window, and vacuum. Report candidates, parameters, limitations, and suggested validation; never present a candidate as a stable material.

## Parameter Rules

- The default model is `chemical_system` (the project's pinned MatterGen `1.0.3` checkpoint). It accepts a condition such as `properties_to_condition_on: {"chemical_system": "Li-Fe-O"}` and **does not guarantee** the exact stoichiometry of `Li2FeO3`. Do not pass `Li2FeO3` as a chemical system or invent property keys for an untrained model.
- `target_compositions` is for CSP-trained models and requires a matching `sampling_config_name: "csp"`. Leave it empty for the default `chemical_system` model. If the project runner/schema does not expose CSP sampling configuration, stop at parameter review and explain the missing capability instead of guessing.
- `diffusion_guidance_factor` is classifier-free guidance: default `0`; increase it only when the model was trained for the requested condition and the user wants stronger adherence. Higher values usually reduce diversity; they cannot repair a wrong model or impossible formula.
- `batch_size` is one GPU batch and `num_batches` is the sequential batch count. The product is the requested sample count and must stay at or below the runner limit of `1024`. With unknown GPU memory, start at `8` or `16` and increase `num_batches` for more candidates; do not default to `64`.
- `record_trajectories` defaults to `false`. Enable it only for an explicit diffusion-trajectory diagnostic and warn about extra disk use and runtime.
- Standardization is enabled by default: bulk target about `40` atoms with tolerance `0.2`, and minimum distance `0.8 Angstrom`. For the electrochemical adsorption model construction workflow, override the bulk target to about `60` atoms (normally a `48-72` window), then build explicit six-layer surfaces near 60 clean-substrate atoms. Enable a surface only when the user supplies Miller index, layer count, surface target atoms, and vacuum (default `15 Angstrom`); expand only in-plane, never along vacuum.
- Put every sample in a new iteration directory. Never write to `runtime/mattergen`, the project root, a remembered absolute path, or another session; never overwrite an existing result.

## Selection Guide

- **Element set plus candidate bulk:** `chemical_system` model, `properties_to_condition_on.chemical_system`, `target_compositions=[]`, guidance `0`, trajectories off.
- **Exact formula:** execute only with a user-provided CSP checkpoint, confirmed `csp` sampling configuration, and accepted model scope. Otherwise report the missing condition; do not silently fall back to element-set generation.
- **Property conditioning:** confirm the checkpoint's trained properties and units before filling `properties_to_condition_on`. Do not put band gap or energy-above-hull values into the `chemical_system` model.
- **Surface/adsorption:** generate and standardize bulk first, then construct slab/adsorbate separately. MatterGen is not a surface constructor. UMA/DFT must continue to obey their hash, layer, and cost gates.

## Failure Handling

Keep the original error and classify it as parameter/path (repair the request and rerun dry-run), environment/dependency (report native, WSL2, and remote status without blind installation), or model/sampling (check training conditions and CSP configuration rather than raising guidance). Partial generation, failed standardization, or a missing manifest must not enter an expensive calculation; retain files for diagnosis but report the run as not passed.
