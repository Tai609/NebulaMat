# DeePMD Troubleshooting

> Load this when: DeepMD training fails, metrics look suspicious, or DPMD in LAMMPS behaves unphysically.

| Symptom | Likely cause | Fix |
|---|---|---|
| `dp train` loss becomes NaN early | learning rate too high, corrupted labels, huge force outliers | inspect energy/force distributions, remove unconverged frames, lower `start_lr` |
| `dp test` energy looks fine but force RMSE is poor | noisy DFT forces, loose SCF convergence, bad force labels | relabel with tighter electronic convergence; filter failed SCF frames |
| validation error much worse than training | overfitting or validation set outside training distribution | add representative data; reduce model/training aggressiveness; use active learning |
| good test error but LAMMPS DPMD explodes | training set misses hot/distorted/reactive states | run model-deviation exploration, label high-deviation frames, retrain |
| LAMMPS forces/energies are nonsense immediately | atom type order mismatch with `type_map` | verify `type_map.raw`, `type.raw`, data file masses/types, and `input.json` order |
| `dp compress` fails or compressed model behaves differently | incompatible descriptor/network option or version mismatch | validate with uncompressed `graph.pb`; simplify/resave using the installed DeePMD-kit docs |
| `dpdata` conversion gives wrong element order | POSCAR/OUTCAR order or parser mismatch | inspect `type_map.raw` and `type.raw`; regenerate data with explicit, consistent source files |
| model deviation high for most exploration frames | initial data too narrow or target state absent | add AIMD at target T/P/composition/defects before production |
| diffusion coefficient is erratic | trajectory too short, wrong coordinates, equilibration included | use unwrapped coordinates, discard equilibration, fit only long-time diffusive regime |

## Debug order

1. Check labels: frame count, DFT convergence, energy/force outliers, consistent method fingerprint.
2. Check type order: `input.json`, `type_map.raw`, LAMMPS data atom types, `mass` lines.
3. Check learning curve: overfit, underfit, NaN, noisy validation.
4. Check held-out test metrics and parity plots.
5. Check LAMMPS setup: units `metal`, timestep in ps, unwrapped trajectory for MSD.
6. Run model-deviation exploration before trusting production.

Most DeePMD failures are data-distribution failures. Longer training rarely fixes missing chemistry.
