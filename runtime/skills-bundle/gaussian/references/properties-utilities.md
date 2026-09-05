# Gaussian Properties and Utility Programs

> Load this when: selecting Gaussian property keywords, deciding whether Gaussian itself is enough, or handing Gaussian files to utilities/Multiwfn/VMD.

This file is a routing aid, not a replacement for the Gaussian manual. Use it to avoid choosing the wrong property job or losing data needed for post-processing.

## Property routing

| Target | Gaussian route / utility | Notes |
|---|---|---|
| IR/Raman thermochemistry | `Freq` | validate minimum/TS first; record scaling policy if used |
| charges / dipole / multipoles | `Pop` options | Mulliken is diagnostic only; use robust schemes for claims |
| molecular orbitals | `Pop=Regular` or checkpoint -> `formchk` | prefer `.fchk` for downstream analysis |
| ESP / density / orbital cubes | `cubegen` from `.chk`/`.fchk` | record cube type, grid, isovalue, units |
| NMR shielding / chemical shifts | `NMR` | reference compound and solvent/model matter |
| polarizability / hyperpolarizability | `Polar`, `Freq`, `CPHF=RdFreq` as needed | frequency-dependent properties require explicit settings |
| UV/Vis / ECD | `TD`, `CIS`, `EOM`, `SAC-CI`, or `ZIndo` | TD-DFT is routine, but state character and functional matter |
| vibronic / band shape | `Freq=ReadFCHT`, `Freq=FranckCondon`, `Freq=HerzbergTeller` | high setup sensitivity; not a default spectrum workflow |
| hyperfine / g tensors | `Prop`, specialized EPR settings | basis and nuclear-region description matter |
| volume | `Volume` | mostly a utility property, not electronic evidence |

## Utility programs

| Utility | Use |
|---|---|
| `formchk` | convert binary `.chk` to portable `.fchk` for GaussView/Multiwfn/other tools |
| `chkchk` | inspect checkpoint metadata before reuse |
| `cubegen` | generate cube files for density, spin density, orbitals, ESP, etc. |
| `cubman` | manipulate cube files, e.g. density differences |
| `freqchk` | inspect/reuse frequency data from checkpoint |
| `newzmat` | coordinate conversion / Z-matrix support |

Preserve `.log` and `.chk` for important jobs; `.fchk` is portable, but it is derived data and should be regenerable.

## Handoff rules

- For wavefunction analysis, convert `.chk` to `.fchk` and use `__NEBULAMAT_AICC_ROOT__/tools/multiwfn/`.
- For atomistic rendering or trajectory-style visualization, use the relevant visualization tool rather than hand-rolling figures.
- For density-difference work, preserve coordinate orientation. Consider `nosymm` upstream if coordinate alignment is central to the analysis.
- Gaussian property output does not rescue an invalid upstream calculation; validate SCF/Opt/Freq/state first.

## Common traps

- Do not treat Mulliken charge as final evidence, especially with large or diffuse basis sets.
- Do not compare orbital energies across unrelated methods/solvent models as if they were observables.
- Do not infer charge transfer magnitude from an isosurface picture alone.
- Do not generate publication figures without recording isovalue, grid/cutoff, sign/color convention, and source file.
- Do not delete checkpoint files before downstream property/cube/wavefunction analyses are finished.
