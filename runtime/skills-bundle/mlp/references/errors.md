# MLP Training & Deployment Troubleshooting

> Load this when: training diverges, metrics look wrong, or a deployed model misbehaves in MD.

| Symptom | Likely cause | Fix |
|---|---|---|
| Loss becomes NaN early in training | learning rate too high, or corrupted frames (energy spikes from unconverged DFT) | filter the dataset for outlier energies/forces first; then lower start_lr |
| Great `dp test` metrics but MD explodes | training distribution too narrow (only near-equilibrium frames) | add perturbed/high-T frames; active learning; monitor model deviation in MD |
| LAMMPS forces nonsense with DeePMD model | atom-type order mismatch between data file and `type_map` | the data-file types must follow the model's type_map order exactly |
| Energy RMSE fine, force RMSE terrible | label noise (loose EDIFF in labeling DFT) or loss prefactors skewed | relabel with EDIFF ≤ 1e-6; check force-loss weighting |
| Per-system constant energy offset in parity plot | inconsistent DFT settings across dataset chunks, or E0/bias handling | verify all labels share one method fingerprint; fix E0s (MACE) |
| MACE fine-tune degrades on general structures | catastrophic forgetting from too-aggressive fine-tuning | lower LR, fewer epochs, early-stop on a validation set that includes general structures |
| GPU OOM during training | batch size / model size / r_max too large | reduce batch size first; then model channels; r_max last (physics) |
| Validation loss plateaus far above training loss | overfitting (small dataset) | more data > regularization; foundation-model fine-tune instead of from-scratch |

When the cause is data (it usually is): fix the dataset and retrain — do not paper over label problems with longer training.
