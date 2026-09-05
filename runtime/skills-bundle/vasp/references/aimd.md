# Running AIMD and Enhanced Sampling in VASP

> Load this when: setting up a VASP AIMD run (heating/NVT/NVE), constrained/free-energy dynamics (Blue-moon, slow-growth, metadynamics), or validating a trajectory from `OUTCAR`/`OSZICAR`/`REPORT`. For *what the trajectory means and how to analyze it* (RDF/VACF/VDOS/MSD interpretation, diffusion fitting, CV choice, sampling discipline), see `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-dynamics.md`. For VASPKIT post-processing, `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/aimd-postprocessing.md`.

AIMD is statistical sampling (see the knowledge doc) — this file is the VASP *operation*. Standard
flow: relax a sensible start → heat/anneal (velocity rescaling) → equilibrate with a thermostat →
production. When restarting from a relaxation `CONTCAR`, check for a trailing velocity block and
delete unintended velocities before generating fresh Maxwell velocities.

## Core INCAR controls

Trajectory length = `NSW * POTIM`. `POTIM=2 fs` is often fine for heavy atoms; use `0.5–1 fs` for
H-rich systems, high T, or noisy forces, and check energy drift.

```ini
IBRION  = 0
NSW     = 20000        # set from target trajectory length
POTIM   = 1            # fs
ISYM    = 0            # no symmetry during dynamics
LCHARG  = .FALSE.
LWAVE   = .FALSE.
NELM    = 100
EDIFF   = 1E-5         # tighten if energy drifts / SCF unstable
NBLOCK  = 1            # write every step (velocities/VACF/detailed traj); raise to cut IO
# KBLOCK = NSW         # block-averaged outputs (PCDAT/DOSCAR) together with NBLOCK
```

`NBLOCK` sets how often XDATCAR/CONTCAR blocks are written (use 1 when velocities/VACF/detailed
trajectory are needed); `KBLOCK` governs PCDAT/DOSCAR block averaging.

## Heating / annealing

```ini
IBRION=0
NSW=5000
POTIM=1
SMASS=-1          # velocity scaling for the temperature ramp (prep, not production)
TEBEG=100
TEEND=1400
NBLOCK=20
ISYM=0
LCHARG=.FALSE.
LWAVE=.FALSE.
```

## NVT production

```ini
IBRION=0
NSW=100000
POTIM=1
MDALGO=2          # 1 Andersen, 2 Nose-Hoover, 3 Langevin, 21 metadynamics
SMASS=0           # short Nose-Hoover period; good default for H-containing systems
TEBEG=300
TEEND=300
NBLOCK=1
ISYM=0
LCHARG=.FALSE.
LWAVE=.FALSE.
```

`SMASS=-3` is NVE (short conservation checks only). Heavier/slower systems can test larger `SMASS`.

## NVE conservation check

```ini
IBRION=0 ; NSW=2000 ; POTIM=1 ; SMASS=-3 ; TEBEG=300 ; TEEND=300 ; ISYM=0 ; LCHARG=.FALSE. ; LWAVE=.FALSE.
```

Total energy should not drift; drift ⇒ timestep too large, SCF too loose, precision/noise too high, or the structure is unstable.

## Practical setup notes

- `vasp_gam` + Gamma-only KPOINTS for large liquids/diffusion/molecular boxes when acceptable; `vasp_std` for non-Gamma; `vasp_ncl` for SOC.
- Keep functional, `ENCUT`, PAW mapping, `+U`, dispersion, spin policy identical across a temperature series or comparative study. DFT-D3 (`IVDW=11/12`) is usually cheap enough to keep when weak interactions matter.
- Thermostat/enhanced-sampling features need a VASP build compiled with MD support — if `MDALGO`/`ICONST`/Blue-moon/metadynamics fail at startup, check the local module/build.
- Keep the scientifically justified `LDAU` from the static runs (`u-values-magmom.md`); slab dipole corrections slow SCF — use only when needed.
- GPU/OpenACC: omit `NPAR`/`NCORE` unless the module documentation explicitly
  recommends them. CPU: start from the local default `NPAR=4` unless a benchmark or
  site guide says otherwise. A short timing test pays off — AIMD is many similar SCF
  steps.

## Trajectory validation (operation)

```bash
grep -n "reached required accuracy" OUTCAR | tail
grep "=" OSZICAR > energy.txt
tail REPORT
```

`OSZICAR`/`REPORT` show temperature, energies, thermostat energy, and SCF failures. (What a healthy
trajectory looks like and the red flags are in the knowledge doc.) Convert XDATCAR→xyz for
VMD/OVITO with an explicit frame stride; diffusion/MSD needs the unwrapped trajectory. Extract
RDF/VACF/VDOS/MSD with VASPKIT (`__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/aimd-postprocessing.md`); interpret them
with `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-dynamics.md`.

## Constrained / free-energy dynamics (VASP tags)

VASP uses `ICONST` to define collective variables — distances (`R`), angles (`A`), dihedrals (`T`),
Cartesian components (`X/Y/Z`), combinations (`S`); status `0` fixes a coordinate. Record atom
numbering, CV expression, and meaning. (Choosing a good CV is the science — knowledge doc.)

**Blue-moon (PMF):** constrained windows along the CV, `LBLUEOUT=.TRUE.`:

```ini
IBRION=0 ; NSW=10000 ; POTIM=1 ; MDALGO=2 ; SMASS=0 ; TEBEG=300 ; TEEND=300 ; NBLOCK=1 ; LBLUEOUT=.TRUE.
```

Extract and average per window, then integrate the mean force:

```bash
grep b_m REPORT > bm.txt
grep cc  REPORT > cc.txt
```

**Slow-growth:** add `INCREM` (sign/magnitude = scan direction/speed) to the Blue-moon block; run forward and backward; smaller `INCREM` + longer trajectory is more reliable.

**Metadynamics:** `MDALGO=21` with `HILLS_H`/`HILLS_W`/`HILLS_BIN`; small hills for quantitative profiles, larger for exploration; post-process `HILLSPOT`.

## Reporting (operation)

VASP version/build (thermostat/enhanced support on?), executable + parallel layout, cell/coverage,
fixed atoms, `NSW`/`POTIM`/ensemble/thermostat/`SMASS`/`MDALGO`/`TEBEG`/`NBLOCK`. The analysis-side
reporting (equilibration cut, fit window, uncertainty) is in the knowledge doc.
