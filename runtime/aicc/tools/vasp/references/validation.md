# Validating VASP Calculations

> Load this when: about to submit a run (preflight) or judging whether a finished run is usable (post-run).

## Preflight (mandatory before submission)

Run `uv run scripts/check_inputs.py RUNDIR`. It verifies:

- POSCAR species order == POTCAR order (the silent killer of VASP results)
- MAGMOM length == atom count; LDAUL/LDAUU/LDAUJ lengths == species count; LMAXMIX present with +U
- KPOINTS exists or KSPACING set; ENCUT explicit; KSPACING is not silently too dense
  or smoke-test coarse for the declared task; explicit slab KPOINTS obey the local
  routine default of `k_c = 1` and one in-plane k-point for each in-plane vector
  `>= 13 Å`
- `ISMEAR=-5` not combined with relaxation; ISIF=3 with low ENCUT flagged
- CPU-like production relax/static jobs should use local default `NPAR=4`; missing
  `NPAR`, defaulting to `NCORE=4`, or using a non-default `NPAR` without a benchmark
  rationale gets a performance warning. GPU/OpenACC jobs omit `NPAR`/`NCORE` by
  default; frequency jobs avoid untested parallel knobs.

For production HPC inputs, prefer:

```bash
uv run scripts/check_inputs.py --strict-performance RUNDIR
```

This turns performance warnings such as an excessively dense `KSPACING`, a large-slab
`2 2 1` mesh where `1 1 1`/`vasp_gam` is the local routine default for compatible
Gamma-only jobs, or a missing CPU parallel-layout record into a failed preflight. Use
the non-strict form only when the warning has been reviewed and the reason is recorded
in the engine-input-set or method fingerprint.

For a new executable, queue template, module, POTCAR location, or script-generated input family, a **smoke test is optional but useful** before committing real walltime. It is an environment/input-start check only: very short walltime, cheap k-mesh, usually `NSW=0`, and sometimes `NELM=5`. A NELM-limited smoke test is expected to be electronically unconverged, so parse it with `uv run scripts/parse_vasp.py RUNDIR --smoke` and never use its energy, force, charge, or magnetization as evidence. Do not run a separate smoke test for every near-identical generated job once the shared template and executable have been checked. For hard magnetic, +U, redox-active, metallic-slab, or adsorbate-on-oxide systems, do not let smoke-test economy leak into production inputs: production/pre-production SCF headroom of `NELM=200-300` is normal when justified.

Selective dynamics: if the slab is supposed to have fixed layers, open POSCAR and confirm the `F F F` flags survived structure handling — they are easy to lose in conversions.

## Post-run

Run `uv run scripts/parse_vasp.py RUNDIR` — exits 0 only for a finished, converged run; reports energy, max force, magnetization, and known error strings. (`uv run` guarantees a modern interpreter; the cluster's system python may be too old.) For a fixed-bottom slab, add `--free-only`: it reads the CONTCAR/POSCAR selective-dynamics flags and reports the max force over the *unconstrained* atoms only — the frozen bottom otherwise dominates and a converged minimum can look unconverged.

Hard rules:

- A static calculation whose final SCF hits `NELM` is unconverged. For relaxations, the final ionic step must be electronically converged; repeated `NELM` hits are a failed trajectory. An isolated early `NELM` hit can be treated as a warning if later steps and the final step converge, but record it and consider restarting from the converged geometry with more SCF headroom.
- `reached required accuracy` is the only acceptable end state for a relaxation; ending at NSW is not convergence.
- Check the converged magnetization against the initialization — a known magnet at ~0 μB means a wrong local minimum (see errors.md).
- "Finished" ≠ converged ≠ scientifically valid. Energies from unconverged runs must never enter reaction energetics.

## Per-task convergence criteria

| Task | Converged when |
|---|---|
| static | final SCF below EDIFF within NELM; smearing entropy `T*S` < 1–2 meV/atom for metals; executable matches KPOINTS/SOC (`vasp_gam`/`vasp_std`/`vasp_ncl`) |
| relax (ions) | final ionic step electronically converged; max force below \|EDIFFG\| on all *free* atoms; final static refinement done (narrow soft-mode exception below) |
| relax (cell) | volume change < ~0.3 % between successive restart cycles (Pulay protocol); for slab/2D in-plane relaxation, fixed vacuum direction verified if `IOPTCELL` is used |
| DOS/bands | k-mesh densified vs SCF; no relaxation-trajectory DOS used; `ISMEAR=-5` only with enough k-points; reference alignment, spin convention, and PDOS selections stated |
| electronic analysis | upstream runs converged; charge-density difference references use identical cell/grid/settings; Bader uses `AECCAR0+AECCAR2`; spin/DOS/partial-charge/work-function/COHP evidence is tied to the stated claim |
| NEB / CI-NEB | all images below force criterion; barrier stable when tightening EDIFFG -0.05 -> -0.03; inspect `nebef.pl` and final `grep RMS OUTCAR` lines |
| Dimer | final max atom force from `grep RMS OUTCAR` below \|EDIFFG\|, negative curvature near convergence, final energy taken from last `E0` in OSZICAR |
| surface thermodynamics | bulk/slab settings compatible; stoichiometry and surface area checked; chemical-potential bounds stated; gas/adsorbate corrections traceable |
| AIMD | no repeated SCF failures or NELM-hit steps; timestep and thermostat recorded; temperature and potential energy stationary after equilibration; NVE drift checked when needed; discarded frames, production length, frame stride, and atom selections stated |

## Floppy / weakly-bound adsorbates — a narrow convergence exception (use sparingly, always disclose)

Default stays: force below `|EDIFFG|` on all free atoms. A weakly-bound or physisorbed adsorbate (a methyl/hydroxyl rotor, a tilting H₂O, a floppy chain) can keep a residual force on its own soft modes long after the *binding* is converged and the energy is stationary. Accepting that as "converged" is legitimate **only under ALL** of these, and **only with the caveat carried into the deliverable**:

1. **The residual is on the adsorbate's soft modes** — a rotation / translation / floppy dihedral of the weakly-bound fragment — **not** on the binding coordinate (the adsorbate–surface bond) and **not** on any slab/substrate atom. Check per-atom forces (`parse_vasp.py`); if the binding atom or a slab atom is above `|EDIFFG|`, it is **not** converged. And the residual itself must be **small** — within a small multiple of `|EDIFFG|`: a soft mode is a small lingering force, not any large force that happens to land on the adsorbate, and a residual several times `|EDIFFG|` is unconverged no matter where it sits.
2. **The energy is genuinely stationary, not still descending.** Require dE < ~1 meV/step over the last several steps **and** that those steps are *not monotonically decreasing* — a slow monotonic descent is an unfinished relaxation masquerading as a plateau. If it's still drifting one way, keep relaxing.
3. **Disclose it, and the caveat travels into the deliverable.** Report it as "energy-converged; residual ~X eV/Å on the adsorbate soft modes" in the report/SI, not just working notes. Never strip the caveat from the final document, and never present such a number as fully force-converged.

If any condition fails it is **not** converged — tighten `EDIFF`, switch `IBRION=1` near the minimum, or follow the floppy-physisorbate recipe in `errors.md`. When a decisive quantity (an adsorption energy, a contrast that flips a conclusion) rests on it, confirm the **binding-coordinate** force is converged rather than leaning on the energy plateau alone. This rung is an exception, not a shortcut — it exists so honest soft-mode cases are reportable, **not** to wave through unconverged numbers.

Convergence *testing* (ENCUT, k-mesh, slab thickness, vacuum) is part of the scientific result when the quantity is sensitive — report what was tested, not just the final settings.

## VTST force checks

For VTST optimizers, especially Dimer, `DIMCAR` force is not the final atom-force convergence criterion. Check:

```bash
grep RMS OUTCAR
grep converged OUTCAR
tail -1 OSZICAR
```

Use the last `FORCES: max atom, RMS` line from `OUTCAR`; max atom force should be below `|EDIFFG|` for the free atoms. Use the final `E0` in `OSZICAR` as the transition-state energy. For detailed CI-NEB/Dimer setup and troubleshooting, load `references/vtst-neb-dimer.md`.

## AIMD-specific checks

For AIMD, "finished" only means the requested number of MD steps ended. Inspect `OSZICAR` and `REPORT` for temperature stability, potential-energy stationarity, SCF failures, and thermostat behavior. Do not average over heating or early equilibration. For diffusion, RDF, VACF/VDOS, and free-energy dynamics, preserve the exact frame cut, stride, timestep, selected atoms, and fit/integration window.

## Parsing traps

- The first `volume of cell` line in OUTCAR is the **primitive** cell VASP detected, not your input cell — for body-centered lattices it is half your conventional volume. Compare volumes only between like lines (last-vs-last across runs).

## Provenance to preserve

CONTCAR, OUTCAR, vasprun.xml, the INCAR actually used (not the intended one), KPOINTS, POTCAR TITEL lines, and the job script/ID.
