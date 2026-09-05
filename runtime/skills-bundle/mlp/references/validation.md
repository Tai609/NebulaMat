# Validating ML Potentials

> Load this when: deciding whether a trained model may be used for production, or monitoring its reliability during MD.

## Regression gates (held-out test set, never training data)

| Metric | Production bar |
|---|---|
| energy RMSE | ≲ 1–5 meV/atom |
| force RMSE | ≲ 50–100 meV/Å |
| parity plots | no systematic curvature or per-system bias |

## Physics gates (regression metrics alone are insufficient)

- Equation of state / lattice constant vs the labeling DFT.
- One known barrier or defect/adsorption energy vs DFT.
- Short NVE MD with acceptable energy drift (bar in `lammps/references/validation.md`).

## In-distribution monitoring during MD

A potential is only valid inside its training distribution:

- **DeePMD**: run with a 4-model ensemble and monitor force model deviation (`pair_style deepmd graph0.pb ... out_file md.out`). DP-GEN convention: max deviation < ~0.05 eV/Å trusted; 0.05–0.20 candidate for labeling; > 0.20 unreliable — tune to system stiffness.
- **MACE**: committee/ensemble disagreement plays the same role.
- Frames beyond the trust range mean the simulation left the training distribution — results there are not data; they are candidates for the next training iteration.

## Reporting rules

- Always state: dataset size and composition coverage, test-split protocol, and the labeling DFT settings.
- Never quote model quality from training-set error, and never extrapolate a validation claim to compositions/temperatures the test set didn't cover.
