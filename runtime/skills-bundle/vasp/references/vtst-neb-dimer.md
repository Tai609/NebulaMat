# VTST NEB, CI-NEB, Dimer, and IDPP

> Load this when: setting up or troubleshooting VASP transition-state searches with VTST, including CI-NEB, Dimer, `nebmake.pl`, `nebresults.pl`, `modemake.pl`, `neb2dim.pl`, or IDPP interpolation.

Use this together with `running.md` for the underlying VASP settings and `validation.md` for final convergence rules.

## Site setup

- VTST is not only a script bundle. Transition-state methods need a VASP binary compiled with VTST support — which module/binary is VTST-enabled is a site fact: look it up in the private cluster guide (or ask the user), never assume a naming convention.
- The helper scripts (`nebmake.pl`, `nebresults.pl`, ...) are a separate install; record their module name or path in the cluster guide too.
- If the helper scripts are missing from the environment, consult/download VTST tools from https://theory.cm.utexas.edu/vtsttools/ after user approval.
- Before submitting a TS job, record the exact VASP module and script module in the provenance notes.

## Method choice

| Situation | Prefer |
|---|---|
| relaxed initial and final states are known | CI-NEB |
| a reasonable TS-like structure is already known | Dimer |
| CI-NEB gives a high-energy image but not a clean saddle | CI-NEB rough pass -> Dimer refinement |
| linear interpolation creates bad contacts | IDPP interpolation |

CI-NEB requires both endpoints. Dimer can run from one TS guess, but the initial/final minima are still needed for the barrier and reaction context.

## Endpoint requirements

1. Optimize initial and final states first, using identical functional, ENCUT, k-point policy, smearing, spin, U, constraints, and slab/cell setup.
2. Tighten endpoint relaxations enough for TS work: usually `EDIFFG=-0.01` to `-0.02` for endpoints, then use the same production electronic settings in the TS run.
3. Preserve atom order. Initial and final POSCAR/CONTCAR files must have one-to-one atom correspondence. If interpolation looks chaotic, atom order is the first thing to check.
4. Compare endpoints with:

```bash
dist.pl ini/CONTCAR fin/CONTCAR
```

As a rule of thumb, values below about 5 A are usually workable. Large values often mean atom order mismatch or a reaction path that needs decomposition into smaller steps.

## CI-NEB setup

Create images with VTST linear interpolation:

```bash
nebmake.pl ../is/CONTCAR ../fs/CONTCAR 4
cp ../is/OUTCAR ./00/
cp ../fs/OUTCAR ./05/
```

The third argument is the number of intermediate images, so the example produces `00` through `05`. A practical image-count starting point is 4 intermediate images for small systems and 6 for larger or more complex paths, then adjust by path complexity, cost, and available CPU/GPU resources. The older `dist.pl_value / 0.8` rule is only a rough sanity check. For CI-NEB, more images are not automatically better; use enough to describe the path and to map cleanly onto the hardware.

Check the path before submitting:

```bash
nebmovie.pl 0
```

Open `movie.xyz` in a viewer and look for atom crossings, broken adsorbate geometry, or unrealistically short bonds.

Minimal CI-NEB tags, to be combined with the endpoint relaxation settings:

```ini
EDIFF  = 1E-7      # force accuracy matters; 1E-5 only for a rough pass
EDIFFG = -0.03     # -0.05 for rough/complex first pass
IBRION = 3
POTIM  = 0
NSW    = 300
ISIF   = 2
ISYM   = 0

ICHAIN = 0
LCLIMB = .TRUE.
IOPT   = 1         # also try 2; use 7 for rough/robust early passes
IMAGES = 4
SPRING = -5
```

For difficult mechanisms, a rough CI-NEB (`EDIFF=1E-5`, `EDIFFG=-0.5` to `-0.1`, often `IOPT=7`) can be used only to produce a Dimer guess. Do not report barriers from such a rough pass.

Parallelization rules:

- CPU jobs: total cores must be divisible by `IMAGES`. If `NPAR` is set, total cores must also be divisible by `IMAGES * NPAR`; choose `NPAR` only after deciding the image count and scheduler core count.
- GPU jobs: prefer one image per GPU. For example, if inserting 4 intermediate images, request 4 GPUs and set `IMAGES=4`.
- For best efficiency, image-level parallelism should match the available node/GPU layout where possible.

## IDPP interpolation

Use IDPP when linear `nebmake.pl` images contain unrealistic close contacts or a curved molecular/surface reaction path.

Generate IDPP images with a standard library implementation (no bespoke script needed):

- **pymatgen**: `IDPPSolver.from_endpoints([ini, fin], nimages=4, sort_tol=1.0).run()` (module `pymatgen.analysis.diffusion.neb.pathfinder`, package `pymatgen-analysis-diffusion`), then write `00`, `01`, … image dirs.
- **ASE**: build `[ini] + copies + [fin]` and call `NEB(images).interpolate("idpp")`, then write each image's `POSCAR`.

Run either via `uv run --with <pkg>` so the dependency resolves into an isolated env.

After IDPP, still run `nebmovie.pl 0` or inspect structures directly. IDPP improves initial guesses; it does not prove the path is physical.

## Constrained optimization (ICONST) — bond/angle scan as a TS fallback

When CI-NEB is infeasible (no converged endpoints, a saturated cluster, an unclear path), a constrained relaxation along the reaction coordinate gives a barrier *estimate*. VASP reads the coordinate(s) from an `ICONST` file (`R`=bond, `A`=angle, `T`=torsion, then the 1-based atom indices, then a STATUS integer); the optimizer relaxes all other DOF at each fixed value of the constrained coordinate.

- **Take the STATUS flag from the VASP wiki `ICONST` page — do not guess it.** It differs by VASP version and by whether the VTST optimizer is active, and **a wrong flag silently leaves the coordinate free** (the optimizer just relaxes to the nearest minimum and the "scan" is meaningless). This is a real, easy-to-miss failure.
- **Always verify the constraint actually held**: after the run, measure the constrained distance/angle in `CONTCAR`/`XDATCAR` and confirm it equals the target at every step — never assume `ICONST` worked.
- **Robust alternative if unsure:** a manual relaxed scan — a series of jobs, each with the two (or three) defining atoms frozen by **selective dynamics** at the target separation, relaxing everything else. The scan maximum is a TS *guess*; refine it with Dimer or CI-NEB.
- A constrained-opt barrier is a path/thermodynamic estimate, **not a validated TS** — refine and confirm with a frequency calculation (exactly 1 imaginary mode along the reaction coordinate) when the claim matters.

## Monitoring CI-NEB

Common VTST monitors:

```bash
nebef.pl
nebefs.pl
nebmovie.pl 1
nebresults.pl
```

- `nebef.pl` reports per-image force, energy, and energy relative to the initial state.
- All intermediate images must satisfy the force criterion. A single converged image is not enough.
- `nebresults.pl` runs the common post-processing scripts, creates barrier/spline outputs, and may gzip image `OUTCAR` files. If needed:

```bash
gunzip 0*/OUTCAR.gz
```

The spline extrema from `nebspline.pl`/`exts.dat` are analysis aids, not automatically validated transition states. Usually focus on the highest-energy image and verify it.


## Worked example patterns

These are distilled example patterns only; do not assume any local training directory exists.

### Endpoint -> CI-NEB -> Dimer

Layout:

```text
example-neb-dimer/
  is/          relaxed initial state
  fs/          relaxed final state
  ts-cineb/    00/ 01/ 02/ plus INCAR/KPOINTS/results
  ts-dimer/    POSCAR MODECAR INCAR KPOINTS OSZICAR CENTCAR NEWMODECAR
```

Reusable pattern:

- Keep endpoint folders named `is` and `fs`; build the CI-NEB folder separately.
- `ts-cineb` in this historical small Au diffusion example used `IMAGES=1`, but this is no longer the preferred default. For new small-system CI-NEB jobs, start from `IMAGES=4` when resources allow; use `IMAGES=6` for larger or more complex paths, then enforce the CPU/GPU divisibility rules above.
- `ts-dimer` reuses the same electronic settings but switches to `ICHAIN=2`, `IOPT=2`, and uses `MODECAR` for the initial mode.
- The Dimer example's final OSZICAR line is the model for energy extraction: use the final `E0`, not the `DIMCAR` energy.

Example Dimer final line shape:

```text
207 F= ... E0= ... d E=...
```

### Multi-image surface reaction CI-NEB

Layout:

```text
example-cineb-surface-reaction/
  00/ ... 05/       endpoint and 4 intermediate image folders
  INCAR KPOINTS     shared NEB inputs
  neb.dat nebef.dat exts.dat spline.dat mep.eps vaspgr/
  slurm LOG         submitted job record
```

Reusable pattern:

- A 4-image CI-NEB surface reaction used `IMAGES=4`, `ICHAIN=0`, `LCLIMB=.TRUE.`, `IOPT=7`, `EDIFF=1E-6`, `EDIFFG=-0.03`, `NSW=1000`, `ISPIN=2`, and `IVDW=11`.
- `nebef.dat` gives the compact force/energy table. In this example the largest relative image energy is around 0.66 eV, while the highest spline extremum in `exts.dat` is an analysis aid rather than a replacement for image-based checking.
- `vaspgr/vaspout*.eps`, `mep.eps`, `spline.dat`, and `exts.dat` are products of `nebresults.pl`/VTST post-processing and should be regenerated for each run.
- The Slurm script directly called a VTST-compiled binary path (`.../vasp.5.4.4-optcell-vtst/bin/vasp_gam`). In normal skill use, prefer a cluster-guide/module entry, but always confirm that the selected VASP executable is VTST-enabled.

For compressed endpoint/image outputs, use `zgrep` instead of unpacking unless a tool requires the raw file:

```bash
zgrep 'FORCES: max atom, RMS' 0*/OUTCAR.gz | tail
zgrep 'reached required accuracy\|OPT:.*converged' 0*/OUTCAR.gz
```

## Dimer setup

Use Dimer when a TS-like structure is available, or after a rough CI-NEB identifies the high-energy part of the path.

Prepare `POSCAR` from a hand-built TS guess or a high-energy NEB image. Avoid short contacts; bad guesses often diverge in the first few ionic steps.

Create `MODECAR`:

```bash
modemake.pl ../is/CONTCAR ../fs/CONTCAR
# or
modemake.pl ../is/CONTCAR ./POSCAR
```

`MODECAR` defines the initial Dimer direction, ideally along the reaction coordinate. If omitted, VTST can guess randomly, but that is less reliable.

Minimal Dimer tags:

```ini
EDIFF  = 1E-7
EDIFFG = -0.03
IBRION = 3
POTIM  = 0
NSW    = 300
ISIF   = 2
ISYM   = 0

ICHAIN = 2
IOPT   = 2         # also try 1 or 7 if convergence is poor
# DdR = 5E-3
# DRotMax = 1
# DFNMin = 0.01
# DFNMax = 1.0
```

If converting a NEB calculation to Dimer, `neb2dim.pl` can create a `dim/` folder, but manually checking is still required. A conservative manual workflow is:

1. Run rough CI-NEB and `nebresults.pl`.
2. Copy the highest-energy image `CONTCAR` to `dim/POSCAR`.
3. Generate `MODECAR` with `modemake.pl initial_state dim/POSCAR`.
4. Remove CI-NEB-only tags (`LCLIMB`, `IMAGES`, `SPRING`) and use Dimer tags.

## Monitoring Dimer

Important files:

- `DIMCAR`: Dimer force, torque, energy, curvature, and rotation angle history.
- `CENTCAR`: current Dimer center structure.
- `NEWMODECAR`: updated Dimer direction.

Interpretation:

- `Torque` should generally decrease during rotations; persistent noisy torque suggests insufficient force accuracy.
- `Curvature` should become negative near a first-order saddle. Positive curvature means the search is still far from a TS or the mode is wrong.
- `DIMCAR` energy is not the final TS energy. Use the last `E0` from `OSZICAR` for the TS energy after convergence.

View the Dimer mode:

```bash
dimmode.pl CENTCAR NEWMODECAR 32 0.5
```

`CENTCAR` first line should contain the element composition for this script to behave.

## Convergence and final validation

For VTST optimizers, the most useful force monitor is:

```bash
grep RMS OUTCAR
```

Use the final `FORCES: max atom, RMS` line. The final max atom force must be below `|EDIFFG|` for the free atoms. Also check:

```bash
grep converged OUTCAR
tail -1 OSZICAR
```

Use `tail -1 OSZICAR` and the final `E0` value for the TS energy. Do not use the `DIMCAR` energy as the final electronic energy.

A reported transition state should be validated by frequency analysis when feasible:

- exactly one imaginary mode;
- imaginary mode follows the intended reaction coordinate;
- no extra imaginary modes from unconverged adsorbate, slab, or molecular motions.

## Common problems

| Symptom | Likely cause | Fix |
|---|---|---|
| `nebmake.pl` images look scrambled | initial/final atom order mismatch | reorder atoms and regenerate images |
| early CI-NEB forces exceed ~10 eV/A | bad interpolation or atom overlap | use IDPP or manually fix the bad image |
| NEB image energy below both endpoints | hidden intermediate minimum, or endpoints not true minima | reoptimize endpoints; consider splitting path |
| close to convergence but force stalls | force noise or optimizer mismatch | `PREC=Accurate`, `EDIFF=1E-7`, try `IOPT=7`, `IOPT=2`, or `IOPT=0` with suitable VASP optimizer |
| Dimer curvature stays positive | TS guess/mode too far from saddle | improve TS guess, use rough CI-NEB first, regenerate `MODECAR` |
| no imaginary mode after TS convergence | not a TS, or force accuracy too low | tighten `EDIFF`, re-run/refine; consider Dimer |
| more than one imaginary mode | higher-order saddle or noisy forces | tighten force/electronic convergence, adjust guess, refine with Dimer |
