# Validating LAMMPS Simulations

> Load this when: judging whether an MD run is usable — setup sanity, equilibration evidence, stability, and what may be computed from which segment.

## Pre-run

- Pair style + potential files exist; atom types map to the intended species (check masses!); units/atom_style consistent with the pair style (table in running.md).
- Minimization succeeds before dynamics (`minimize 1.0e-8 1.0e-10 5000 50000`); a structure that won't minimize will not survive MD.
- ReaxFF: `fix qeq/reaxff` present; ffield covers all elements and was fitted for this chemistry.
- MLP pair styles: model validated for this composition/T-range (see `deepmd` or the relevant MLP skill).

## Post-run

Run `uv run scripts/parse_lammps.py log.lammps` — exits 0 only when all run segments completed cleanly; reports last thermo state, lost atoms, energy drift per segment.

## Equilibration evidence (required before any production observable)

- T and P fluctuate around targets with no drift; density plateaued (NPT).
- Observables computed only over the production segment — never across equilibration.
- Statistical honesty: report block averages or standard errors over independent segments, not single-frame values.

## Stability bars

| Check | Bar |
|---|---|
| NVE total-energy drift | ≲ 1e-4 of \|E\| per ns (timestep too large if exceeded) |
| Lost atoms | zero — any loss invalidates the trajectory |
| Temperature spikes at start | tolerate brief equilibration transient only; persistent spikes = bad geometry or timestep |
| Bond/charge blowups (ReaxFF) | inspect species.out; nonsense species = timestep or ffield misuse |

## Provenance to preserve

Input script, data file + its construction provenance, potential file identity (name/version/source — not the contents if licensed), log file, dump files, restart files, and the random seed.
