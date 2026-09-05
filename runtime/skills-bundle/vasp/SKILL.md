---
name: vasp
description: Prepare, validate, run, and troubleshoot VASP DFT calculations for periodic materials. Use for static SCF, ionic/cell relaxation, DOS, band structure, charge-density difference, Bader analysis, spin density, partial charge, ELF, work functions, magnetization, adsorption energies, vacancy formation, reaction energies, surface thermodynamics, surface reaction kinetics, electrocatalytic CHE step diagrams, VASPsol/VASPsol++ implicit-solvent and constant-potential setup, vibrational frequencies, Wulff construction, free-energy corrections, AIMD/trajectory analysis/enhanced sampling, and VTST NEB/Dimer transition-state setup. (For LOBSTER COHP/COOP bonding analysis, the `lobster` skill drives the projection; VASP just provides the static wavefunction.)
---

# VASP

Task types: **static** (single-point), **relax** (ions `ISIF=2` / cell `ISIF=3`), **electronic** (DOS/bands/charge-density difference/Bader/spin density/partial charge/ELF/work function — needs a converged run first; for COHP bonding analysis the `lobster` skill takes over from the static), **reaction** (adsorption/vacancy/reaction energies, surface thermodynamics, surface reaction kinetics, electrocatalytic CHE step diagrams, VASPsol/VASPsol++ solvent/electrolyte calculations, vibrational/free-energy corrections, Wulff construction, VTST NEB/Dimer transition states), **dynamics** (AIMD heating/equilibration/production, RDF/MSD/VACF/VDOS, diffusion, Blue-moon, slow-growth, metadynamics). A smoke test is a separate optional environment/input-start check, not a production static calculation. Templates and the rules for each live in the references below.

## Required inputs

- Structure (POSCAR, or via `structure-prep`)
- POTCAR source + element→potential mapping — never invent potentials, never print POTCAR contents (licensed); record TITEL lines only
- k-mesh policy (KPOINTS or KSPACING), spin policy (ISPIN/MAGMOM), U values if applicable
- For reproductions: the source paper's settings override all local defaults

## Where to find what

| Situation | Go to |
|---|---|
| setting up a run: ENCUT/k-mesh/ISMEAR policy, INCAR template per task, reaction rules | `references/running.md` |
| DOS/band analysis: DOS/PDOS, band structures, adsorbate-surface orbital interactions, d-band center | run it: `references/dos-band.md`; science/interpretation: `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`; VASPKIT extraction: `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/dos-band.md` |
| scientific figure choice: structures, density fields, numerical plots, molecular visualization path | `__NEBULAMAT_AICC_ROOT__/knowledge/scientific-visualization.md` |
| electronic-structure analysis: charge transfer, charge-density difference, Bader, spin density, partial charge, work function, ELF | run it: `references/electronic-analysis.md`; for charge-density difference used to explain adsorption/interface/metal-support/dopant interactions, also load `references/dos-band.md` for partner PDOS; science/interpretation: `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`; render CHGCAR-like fields: `references/volumetric-visualization.md`; VASPKIT-derived files: `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/electronic-analysis.md` |
| COHP/COOP bonding analysis with LOBSTER: ICOHP, pCOHP, atom-pair bonding/antibonding, spilling checks | run it with the `__NEBULAMAT_AICC_ROOT__/tools/lobster` skill (it owns the VASP-static settings + projection); science in `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md` |
| VTST transition states: CI-NEB, Dimer, IDPP interpolation, VTST scripts, `grep RMS OUTCAR` | `references/vtst-neb-dimer.md` |
| surface thermodynamics: surface energy, chemical-potential/oxygen-coverage phase diagrams, single-atom/defect stability diagrams, frequencies, free-energy corrections, Wulff construction | science & equations: `__NEBULAMAT_AICC_ROOT__/knowledge/surface-thermodynamics.md`; run frequencies/slabs via `references/running.md`; VASPKIT correction menus and gas `G(T,p)` helpers: `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/thermochemistry.md` |
| surface reaction kinetics: TST/Eyring rates, adsorption/desorption rates, LH/ER/MvK mechanisms, RDS/TDTS/TDI, BEP, volcano preparation | science: `__NEBULAMAT_AICC_ROOT__/knowledge/reaction-kinetics.md`; for CatMAP execution use `__NEBULAMAT_AICC_ROOT__/tools/catmap/SKILL.md` |
| electrochemistry: CHE OER/ORR/HER step diagrams, pH/electrode-potential corrections, VASPsol implicit solvent, VASPsol++ constant-potential setup | science: `__NEBULAMAT_AICC_ROOT__/knowledge/electrochemistry.md`; VASP/VASPsol execution: `references/electrochemistry.md`; free-energy bookkeeping: `__NEBULAMAT_AICC_ROOT__/knowledge/thermochemistry-and-free-energy.md` |
| AIMD and finite-temperature sampling: heating/equilibration/production, RDF/MSD/VACF/VDOS, diffusion coefficients, constrained MD, slow-growth, metadynamics | run it: `references/aimd.md`; science/analysis: `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-dynamics.md`; VASPKIT post-processing: `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/aimd-postprocessing.md` |
| DFT+U and MAGMOM: setting `LDAU*`/`MAGMOM` in INCAR | how to set it: `references/u-values-magmom.md`; which U / which moment (chemistry): `__NEBULAMAT_AICC_ROOT__/knowledge/hubbard-u-and-magnetism.md` |
| running VASP on GPUs: OpenACC build choice, launch template, ranks per GPU, parallel-tag caveats | `references/gpu-openacc.md`; for generic Slurm GPU requests also use `__NEBULAMAT_AICC_ROOT__/tools/hpc-submit/references/running.md` |
| before submitting: preflight checks + optional environment/input smoke test | `uv run scripts/check_inputs.py`, then `references/validation.md` |
| run crashed / warning string / SCF won't converge | `references/errors.md` |
| run finished — is it usable? convergence criteria per task | `scripts/parse_vasp.py`, then `references/validation.md` |
| Bader net-charge summary (per element + per-atom spread) | `scripts/bader_summary.py` (run `bader` first; see `references/electronic-analysis.md`) |
| working examples to copy and adapt | `examples/` |
| not covered locally (manual, wiki, VTST, forum) | `references/resources.md` |

## Workflow

1. Pick the task type; before writing INCAR/KPOINTS/POTCAR/job scripts, load
   `references/running.md` and the relevant task reference. Record the chosen
   ENCUT, k-policy (`KSPACING` or explicit KPOINTS), smearing, spin/U policy,
   executable, and parallel layout (`NPAR=4` for routine CPU production relax/static
   jobs, optional `KPAR`, or an explicit GPU/site-default rationale) in the
   engine-input-set or method fingerprint.
2. Preflight: `uv run scripts/check_inputs.py RUNDIR` must pass; for production HPC
   inputs, use `uv run scripts/check_inputs.py --strict-performance RUNDIR` unless
   the performance warnings are explicitly reviewed and waived. Use the optional
   smoke-test policy for novel executables, queue templates, or generated input
   families.
3. Execute via `hpc-submit`.
4. Validate: `uv run scripts/parse_vasp.py RUNDIR` (add `--free-only` for fixed-bottom slabs); criteria in `validation.md`. On failure → `errors.md`, change one thing, rerun.

## Hard guardrails

- POSCAR species order must match POTCAR — checked, not assumed.
- Do not hand-write INCARs from memory. The VASP input generator must consume
  `references/running.md`, and any departure from its k-mesh, smearing, precision,
  NELM, or parallelization policy must be recorded with a reason. For this local
  collection, routine CPU production VASP relax/static inputs default to `NPAR=4`;
  GPU/OpenACC inputs omit `NPAR`/`NCORE` by default.
- No energy from an unconverged run enters any comparison or reaction expression.
- Energies in one expression: identical functional, ENCUT, k-density, convergence settings.
- Slab, surface, adsorbate-on-surface, interface, and asymmetric 2D calculations
  default to `ISYM=0` for relaxations and final static runs, unless a tested symmetry is
  deliberately being enforced and that choice is recorded.
- Preserve CONTCAR, OUTCAR, vasprun.xml, and the INCAR actually used.
