# Machine-Learning Potentials: Concepts, Data, Validation, Program Families

> Covers: tool-agnostic MLP principles, dataset design, symmetry and locality, validation, active learning, and how major MLP program families differ.

Machine-learning potentials map atomic structures to energies and forces so molecular dynamics can run near the speed of classical force fields while trying to reproduce a chosen quantum-mechanical labeling method. They are interpolation models over a training distribution, not universal replacements for DFT.

## What an MLP learns

Most atomistic MLPs write the total energy as a sum of local atomic contributions:

```text
E_total = sum_i E_i(environment_i)
F_i = -dE_total / dR_i
```

The model must respect:

- Translation invariance: shifting the whole cell changes nothing.
- Rotation invariance/equivariance: energy is unchanged by rotation; vector/tensor quantities rotate correctly.
- Permutation invariance: exchanging atoms of the same element changes nothing.
- Locality: each atom sees neighbors inside a cutoff; long-range electrostatics, charge transfer, and magnetism need special treatment or separate validation.

For MD, forces are as important as energies because they determine trajectories. A model with acceptable energy error but poor forces is usually not usable for production MD.

## Dataset design

The dataset defines the model's domain. Cover:

- compositions and atom types.
- phases, surfaces, defects, interfaces, adsorbates, and charge states relevant to the target.
- temperature/pressure/strain range.
- distorted and transition-like structures, not only relaxed minima.
- rare events or diffusion pathways if the production question depends on them.

One dataset should have one label method fingerprint: functional, pseudopotentials/basis, k-point policy, cutoff, Hubbard U, spin, dispersion, solvation, SCF thresholds, and stress convention. Mixing inconsistent DFT settings usually appears as irreducible error or energy offsets.

For DeePMD-style initial datasets, the default non-special bootstrap target is at least
`10000` filtered DFT-labeled frames before the first split and production training. This
means converged, chemically sensible frames after filtering, not raw AIMD ionic steps.
Smaller datasets are reasonable for smoke tests, very expensive pilots, strict
reproductions, or explicit quick runs, but they should be labeled as pilot/exception
models until more labels are added.

Split data before training:

- Training set: parameter optimization.
- Validation set: model selection and early stopping.
- Test set: final model report only.

Never report training error as model quality.

## Validation hierarchy

Regression metrics are necessary but insufficient:

1. Held-out energy/force/stress errors.
2. Parity plots split by composition, temperature, phase, and data source.
3. Physics checks: lattice constants, equation of state, defect/surface/adsorption energies, barriers, RDF/MSD trends, or phonons, depending on the use case.
4. Short MD stability checks: no atom loss, no unphysical reactions, acceptable energy drift in NVE where applicable.
5. Optional in-distribution monitoring: committee/model-deviation or uncertainty estimates during open-ended exploration or high-risk extrapolation checks.

High uncertainty or high model deviation means the simulation has left the training distribution. Treat those frames as candidates for labeling, not as production data.

## Dataset distribution visualization

For large MLP datasets, make a low-dimensional coverage map after first training/testing
and whenever active-learning or AIMD data are added. For very heterogeneous datasets,
also use it before a long final training run. The useful question is not whether a plot
looks pretty; it is whether the training data cover the structures that the production
simulation will visit.

Common feature choices:

- Raw flattened coordinates: quick, but often dominated by atom count, cell size, and coordinate origin.
- Hand descriptors: coordination numbers, pair distances, composition, volume, energies, force norms, and temperature/source metadata.
- Learned descriptors: embeddings from a short-trained MLP descriptor, such as a DeePMD DPA1 descriptor extracted with `eval_descriptor()`. These often separate chemically meaningful environments better than raw coordinates.

Dimensionality reduction methods:

- PCA: linear, reproducible, fast, and usually easiest to interpret for dataset coverage.
- t-SNE/UMAP: nonlinear and visually useful, but sensitive to hyperparameters and random seed; use as supplementary diagnostics.

Interpretation guardrails:

- A cluster map shows similarity/coverage, not model accuracy. Always combine it with held-out errors, model deviation, and physics checks.
- A sparse island can be either an outlier to remove or an essential rare environment to keep; inspect representative structures.
- If validation/test data overlap training points exactly by source folder, the split may not test extrapolation.
- Keep labels by data source, composition, temperature, defect/surface class, and active-learning round so the plot can guide what to label next.

## Active learning loop

Active learning is optional, not a mandatory first response. A practical bootstrap for
many DeePMD projects is to label a broader AIMD set first: several plausible initial
models, several temperatures, a single consistent DFT fingerprint, and normally at least
`10000` filtered DFT-labeled frames before splitting/training. Use committee or
DP-GEN-style active learning when the target is open-ended exploration, when validation
shows extrapolation gaps, or when the user explicitly asks for uncertainty-guided data
selection.

```text
train committee -> explore with MD/structure search -> detect uncertain frames
  -> label selected frames with DFT -> retrain -> repeat
```

The loop stops when the exploration conditions relevant to the target produce few or no high-uncertainty frames and the model passes physics checks. DP-GEN is the canonical implementation for DeePMD-style concurrent learning, but the logic applies to MACE, NequIP, NEP, and other MLPs.

## Program families

| Program/family | Core idea | Typical strengths | Watch-outs |
|---|---|---|---|
| DeePMD-kit / DP | Deep Potential local descriptors with embedding and fitting networks; strong LAMMPS and DP-GEN ecosystem | production DPMD, large-scale MD, active learning, model deviation | strict `type_map`; training distribution is critical; long-range effects need special handling |
| MACE | higher-order equivariant message passing / ACE-like body-order view | high accuracy and data efficiency; foundation models and fine-tuning workflows | heavier models; careful validation for out-of-domain fine-tuning |
| NequIP / Allegro | E(3)-equivariant graph neural networks; Allegro focuses on local equivariant interactions | data-efficient high-accuracy potentials | GPU/memory cost; deployment build compatibility |
| GPUMD / NEP | neuroevolution potential integrated with GPU MD | very fast GPU MD and thermal transport workflows | separate file formats and training controls; best treated as its own tool |
| LASP | atomistic simulation platform with neural-network potentials and global optimization workflows | reaction/path/search workflows in the LASP ecosystem | licensing/environment details and input formats differ from open MLP stacks |
| GemNet-OC | directional message passing model developed around Open Catalyst datasets | catalyst benchmark performance and pretrained OC models | primarily OC ecosystem/model training; deployment as general MD potential needs care |
| EquiformerV2 | equivariant transformer architecture used in Open Catalyst models | strong universal/foundation model behavior for catalysis/materials screening | expensive inference/training; fine-tuning and deployment workflows differ from MD engines |

This file is the common science layer. Program-specific operation belongs in `__NEBULAMAT_AICC_ROOT__/tools/<program>/`, because commands, data formats, model packaging, LAMMPS/ASE interfaces, and failure modes differ substantially.

## Diffusive/Transport DPMD Practice

For diffusion, transport, electrolyte, interface, or high-temperature DPMD simulations:

- Train on structures at or above the target production temperatures, not only low-temperature minima.
- Include vacancies, defects, disorder, interfaces, distorted hopping environments, and
  other transport bottlenecks when relevant.
- Use unwrapped coordinates and equilibrated production segments for MSD.
- Compute diffusion coefficients from the long-time MSD slope, with dimensionality correction.
- Fit activation barriers from multiple temperatures.
- Compare short DFT/AIMD references to DPMD for RDF, local coordination, and diffusion trend before using long DPMD trajectories for claims.

## Reporting checklist

Always state:

- labeling code and DFT settings.
- data sources, frame counts, compositions, and split protocol.
- model program/version and key architecture/cutoff settings.
- held-out errors with units.
- physics validation checks.
- MD ensemble, timestep, temperature/pressure, equilibration cut, production length, and uncertainty estimate.
