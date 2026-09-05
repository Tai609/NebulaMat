# Running MLP Workflows: Datasets, Training, Deployment, Active Learning

> Load this when: preparing training data, training/fine-tuning DeePMD or MACE, deploying a model for inference, or setting up an active-learning loop.

## Dataset preparation

- Convert DFT outputs with dpdata: `dpdata.LabeledSystem('OUTCAR', fmt='vasp/outcar').to('deepmd/npy', 'data/sysX')` — one system per composition/cell. ASE-readable formats convert via `ase` → `dpdata`, or `extxyz` for MACE.
- **Only converged DFT frames are labels.** Filter out unconverged SCF steps before conversion; a few bad labels visibly poison force training.
- All labels in one dataset must share functional, ENCUT/basis, k-policy, and U values. Mixing settings is a hard error, not noise.
- Hold out a test split (5–10 %, sampled across systems, never only the tail of a trajectory) before any training.

## DeePMD training

`input.json` essentials: `type_map` (order is the contract with LAMMPS data files), descriptor `se_e2_a` (`rcut` ~6 Å, `sel` auto); the default loss-prefactor schedule (energy ramps up, force ramps down) is sensible; `numb_steps` 4e5–1e6.

```bash
dp train input.json
dp freeze -o graph.pb          # optionally: dp compress -i graph.pb
dp test -m graph.pb -s data/test -n 1000
```

## MACE training / fine-tuning

- `mace_run_train --config config.yml`, `r_max` 5–6 Å.
- Fine-tuning a foundation model (`--foundation_model mace-mp-0` tier) usually beats from-scratch for small datasets; keep epochs modest and watch validation — it overfits fast.
- E0s: prefer isolated-atom reference energies computed with *your* DFT settings over `average`.
- Convert for LAMMPS: `mace_create_lammps_model model.model`.

## Deployment

LAMMPS pair styles and the type-map contract: see `lammps/references/running.md`. For reliability monitoring during MD (model deviation), see validation.md here.

## Active learning loop (DP-GEN style)

1. Train N models on current data (different seeds only).
2. Run exploration MD across the target T/P/composition grid.
3. Select candidate frames by the model-deviation window (thresholds in validation.md).
4. Label candidates with DFT — same settings as the original dataset (preflight via `vasp`).
5. Retrain; repeat until the candidate fraction is ≪ 1 % across the exploration grid.

Per-iteration provenance: dataset hash/paths, input.json/config, seeds, checkpoint, test metrics. A checkpoint without its dataset and config is unreproducible.
