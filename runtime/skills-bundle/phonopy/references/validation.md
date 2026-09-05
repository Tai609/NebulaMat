# Validating Phonon Calculations

> Load this when: judging a phonon spectrum — imaginary modes, convergence, and what may be claimed from it.

## Imaginary modes: classify before reacting

- **Tiny imaginary pockets at Γ on acoustic branches** (|ν| < ~0.1 THz): usually numerical — supercell too small, forces not tight enough, FFT grid. Tighten and re-check before claiming anything.
- **Finite imaginary branches across the zone**: a real dynamical instability — the structure is not a 0 K minimum. Follow the mode eigenvector to a lower-symmetry structure, or report the instability as the finding.
- Never delete or hide imaginary modes to make thermal properties computable; thermal properties from an unstable spectrum are undefined.

## Sanity checks

- Acoustic branches go to exactly zero at Γ (acoustic sum rule); a gap there means translational invariance is broken (residual forces, inconsistent settings across displacements).
- Polar materials without a BORN file show wrong LO-TO behavior near Γ — required, not optional, for ionic compounds.
- Compare at least the high-frequency cutoff and any measured Raman/IR mode against experiment when available.

## Convergence to report

Phonon results are only as good as: supercell dimension (`--dim`), displacement amplitude, force-calculation settings (EDIFF, k-mesh), and the relaxation tightness underneath. State which of these were actually tested; "converged with default settings" is not a convergence statement.

## Provenance

`phonopy_disp.yaml`, FORCE_SETS, the per-displacement run directories (or their parsed summaries), `band.conf`/`mesh.conf`, and BORN if used.
