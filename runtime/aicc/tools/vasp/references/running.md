# Running VASP: Templates, Defaults, and Task Rules

> Load this when: setting up any VASP run — ENCUT/k-mesh/ISMEAR policy, INCAR templates per task type, and the task-specific rules for electronic analysis and reaction energetics. For detailed VTST NEB/Dimer transition-state setup, also load `vtst-neb-dimer.md`. For AIMD, trajectory analysis, and enhanced sampling, load `aimd.md`.

Community-standard starting points. A reproduction target's published settings always override these. Lines marked `# adjust` are system-dependent. When a run crashes, warns, or won't converge, go to `errors.md` and match the exact string before changing anything here — don't guess.

Before writing generated VASP inputs, record an input-standard note in the
engine-input-set or method fingerprint: task type, source reference used from
`__NEBULAMAT_AICC_ROOT__/tools/vasp`, ENCUT policy, k-policy, smearing, spin/U policy, executable
(`vasp_std`/`vasp_gam`/`vasp_ncl`), parallel layout (`NPAR=4` for routine CPU
production relax/static work, `KPAR` when deliberately used, or an explicit
GPU/site-default rationale), and any intentional departure from this file.
This prevents a generic agent from inventing INCAR defaults or choosing an expensive
k-mesh by accident.

## Global policies

**POTCAR / PAW potential choice** — Record the licensed POTCAR root, functional
family, and element-to-potential mapping before generating inputs. For new PBE PAW
work in this local workflow, the fallback mapping is the standard no-suffix potential
for each element (`Fe`, `Ti`, `O`, etc.) only after checking that no paper, user
instruction, benchmark, element-specific guidance, or project convention calls for a
different variant. Treat this as a local reproducibility default, not a universal VASP
recommendation. Use suffix variants such as `_pv`, `_sv`, `_d`, or harder/softer
alternatives when the source method requires them, semicore states are chemically
important, element-specific guidance or a convergence/validation test supports the
choice, or a project/group convention explicitly sets them. Do not mix suffix choices
inside a compared energy expression. Whether POTCAR is built by VASPKIT or by
concatenating files directly, independently check POSCAR species order against POTCAR
`TITEL` lines and record the mapping; never commit or print POTCAR contents.

**ENCUT** — explicit, never default. ≥ 1.3 × largest ENMAX in POTCAR for cell relaxations (`ISIF=3`); 520 eV is a common fixed value for oxide databases (Materials Project convention). Fixed-cell runs: 400–520 eV typical; keep identical across any energies you compare.

**k-mesh** — `KSPACING` (Å⁻¹, 2π included) or explicit KPOINTS. Smaller KSPACING means
denser and slower. Do not choose a very small value as a generic "safer" default; use
the range appropriate to the task and record convergence reasons for denser meshes:
| Use | KSPACING | Notes |
|---|---|---|
| smoke test | 0.5 | never for production numbers |
| insulators, production | 0.25–0.30 | check convergence for small gaps |
| metals, production | 0.15–0.20 | smearing-sensitive properties need tests |
| slabs | as above in-plane | exactly 1 k-point along vacuum (Γ-centered) |
| molecules in a box | Γ-only | `KSPACING` large or 1×1×1 |

Γ-centered (`KGAMMA=.TRUE.`) for hexagonal cells and slabs, always safe elsewhere. For
slabs, an explicit Γ-centered KPOINTS file is often clearer than relying on KSPACING,
because the vacuum direction must remain exactly one k-point.

**Slab KPOINTS default** — after `structure-prep` has made `c` the surface normal /
vacuum direction, use an explicit Γ-centered mesh with `k_c = 1`. For routine slab
relax/static/adsorption-energy jobs, any in-plane lattice vector `>= 13 Å` defaults
to one k-point along that direction. Therefore a slab with both `a` and `b >= 13 Å`
defaults to `1 1 1` and should use `vasp_gam` when the site provides it and the task is
compatible with the Gamma binary (not SOC/noncollinear). For shorter directions, start
from `k_i = ceil(13 Å / L_i)` and keep the mesh anisotropic when the cell is anisotropic:
examples are `10 x 18 Å -> 2 1 1`, `7 x 7 Å -> 2 2 1`, and only smaller in-plane cells
need `3` or more. Denser meshes are allowed for metallic Fermi surfaces,
DOS/work-function-quality electronic analysis, meV-scale energy differences, or an
explicit convergence test; record that reason in the method fingerprint. For energies
in one expression, keep comparable k-density per surface area rather than blindly
copying the same integers between different in-plane cells.

**ISMEAR** —
- `0` (Gaussian, `SIGMA=0.05`): insulators, molecules, unknown systems — the safe default
- `1` (MP1, `SIGMA=0.1–0.2`): metals; check the smearing entropy term `T*S < 1–2 meV/atom`
- `-5` (tetrahedron+Blöchl): DOS and accurate total energies; **never** for relaxations (inaccurate forces) and needs ≥ 4 irreducible k-points

**Parallelization** — Treat these as performance knobs, not physics settings, but do
not ignore them for production CPU jobs. Local default: for routine CPU VASP
relax/static jobs, write `NPAR=4`. Do not substitute `NCORE=4` as the default; use
`NCORE` only when a site guide or timing benchmark says it is faster for the local VASP
build. For GPU/OpenACC VASP, omit `NPAR` and `NCORE` by default; do not carry CPU
parallel tags into GPU inputs unless the GPU module documentation explicitly recommends
them (launch template and GPU caveats: `gpu-openacc.md`). Frequency/phonon
finite-difference jobs can be sensitive to parallel layout; avoid carrying over
`NPAR`/`NCORE` from production relaxations unless it has been tested. `KPAR` can split
independent k-points when there are many k-points and enough nodes/GPUs.

**Executable choice** — `vasp_gam` is for Gamma-only jobs, typically molecules, large supercells, and true `1 1 1` Gamma KPOINTS. Use `vasp_std` for ordinary k-mesh calculations. Use `vasp_ncl` for SOC or noncollinear calculations, with the matching INCAR settings and a module that provides the binary.

**Precision defaults** — Do not add expensive precision knobs by habit. `PREC` default/normal production settings and no `ADDGRID` are often enough for screening and routine relaxations. Add `PREC=Accurate`, `ADDGRID`, finer FFT grids, or tighter `EDIFF` only when the target property needs it: stresses, phonons/frequencies, Bader/charge density, small energy differences, or a known force-noise problem.

**NELM** — Do not copy smoke-test limits into real jobs. `NELM=100` is a routine starting point; `NELM=200-300` is normal for magnetic, +U, redox-active, metallic-slab, hybrid, or adsorbate-on-oxide systems and is not by itself a sign that the calculation is wrong. If a production run needs more SCF headroom, record it with the method fingerprint and keep comparable energies on consistent settings.

## Static SCF

```ini
SYSTEM  = static
PREC    = Normal          # use Accurate only for final high-precision properties
ENCUT   = 520            # adjust
EDIFF   = 1E-6
ALGO    = Normal
NELM    = 100
ISMEAR  = 0              # 1 for metals
SIGMA   = 0.05
LREAL   = .FALSE.        # Auto for > ~30 atoms (small speed/accuracy tradeoff)
ISPIN   = 1              # 2 + MAGMOM for magnetic systems
LWAVE   = .TRUE.
LCHARG  = .TRUE.
NPAR    = 4              # CPU default; omit NPAR/NCORE for GPU/OpenACC
```

## Ionic relaxation (fixed cell — slabs, adsorbates, defects)

```ini
PREC    = Normal          # use Accurate if forces/stresses are noisy or final precision matters
ENCUT   = 520            # adjust
EDIFF   = 1E-5           # 1E-6 if forces noisy near convergence
EDIFFG  = -0.02          # eV/A; -0.01 for phonon/NEB prerequisites
IBRION  = 2              # CG; switch to 1 (DIIS) near the minimum
NSW     = 300
NELM    = 100            # 200-300 is normal for hard magnetic/redox/slab systems
ISIF    = 2
ISYM    = 0              # slabs/surfaces/adsorbates: do not constrain surface symmetry
ISMEAR  = 0              # 1 for metals
SIGMA   = 0.05
LREAL   = Auto           # .FALSE. for final static refinement
LWAVE   = .FALSE.
LCHARG  = .FALSE.
NPAR    = 4              # CPU default; omit NPAR/NCORE for GPU/OpenACC
```

Slab extras: use selective dynamics in POSCAR for fixed bottom layers. Set `ISYM=0` for
slab, surface, adsorbate-on-surface, interface, and asymmetric 2D calculations,
including the final static single point after relaxation. Symmetry detection can
silently constrain or re-symmetrize surface distortions, adsorbate displacements, fixed
layers, magnetic order, or reconstruction modes that are physically allowed in the
chosen slab. Do not enable `LDIPOL=.TRUE.` / `IDIPOL=3` by default for slab relaxations
or routine energies; it can make SCF convergence much harder. Add the dipole correction
only when the task specifically needs a documented z-direction electrostatic-potential
/ work-function `LOCPOT` analysis or a tested asymmetric-slab correction. After
relaxation, do one static run with production settings for the final energy.

## Cell relaxation (bulk)

```ini
IBRION  = 2
ISIF    = 3
NSW     = 100
ENCUT   = 700            # >= 1.3 x ENMAX, mandatory for ISIF=3
EDIFF   = 1E-6
EDIFFG  = -0.01
ISMEAR  = 0              # never -5 while the cell changes
SIGMA   = 0.05
NPAR    = 4              # CPU default; omit NPAR/NCORE for GPU/OpenACC
```

Pulay stress protocol: relax -> copy CONTCAR to POSCAR -> relax again, until volume change < ~0.3 %. Finish with a static run at production ENCUT.

## Partial cell relaxation for slabs / 2D materials

For slab and 2D systems, do not let vacuum thickness collapse during cell optimization. The conservative default is fixed-cell relaxation (`ISIF=2`) after building a converged slab. If the in-plane lattice must relax while keeping the vacuum direction fixed, use a VASP build that supports `IOPTCELL` (a constrained-cell-relaxation patch, not a stock VASP tag) and document the matrix:

```ini
ISIF     = 3
IOPTCELL = 1 1 0  1 1 0  0 0 0   # relax x-y cell components; keep z/vacuum fixed
```

Check the final lattice vectors manually. If `IOPTCELL` is unsupported by the local VASP build, fall back to controlled manual in-plane scans or a cell shape supported by the code version.

## Dispersion corrections

Use one dispersion scheme consistently across every energy in the same reaction or surface-energy expression. Common DFT-D3 choices are:

```ini
IVDW = 11    # DFT-D3 zero-damping
IVDW = 12    # DFT-D3(BJ), Becke-Johnson damping
```

Do not mix corrected and uncorrected energies in adsorption, surface thermodynamics, or reaction barriers. Record the exact `IVDW` value because D3 and D3(BJ) can change trends for weak adsorption.

## HSE / hybrid functional starting point

Hybrid calculations are expensive; converge the structure and magnetic state with a semilocal functional first, then start HSE from a good WAVECAR/CHGCAR when appropriate.

```ini
LHFCALC  = .TRUE.
AEXX     = 0.25
HFSCREEN = 0.2
ALGO     = All       # Damped can be more stable for difficult cases
TIME     = 0.4
ISYM     = 3
```

For HSE slabs/surfaces/adsorbates, override the generic `ISYM=3` starting point with
`ISYM=0` unless the calculation is deliberately enforcing a tested symmetry. For HSE
band structures, use the zero-weight k-path strategy described in `dos-band.md`; do not
rely on the simple semilocal `ICHARG=11` line-mode workflow. Keep HSE k-meshes modest,
test convergence on smaller cells, and record whether `ALGO=All` or `ALGO=Damped` was
used.

## DOS (after a converged static run in the same directory)

```ini
ICHARG  = 11             # read converged CHGCAR, fixed density
ISMEAR  = -5
LORBIT  = 11             # PDOS, no POTCAR-specific RWIGS needed
NEDOS   = 2001
NSW     = 0
EDIFF   = 1E-6
```

Use a denser k-mesh than the SCF (1.5–2×). For PDOS comparisons across systems, align to the vacuum level (slabs, via LVHAR/LOCPOT) or a deep core state.

## Band structure

```ini
ICHARG  = 11
ISMEAR  = 0
SIGMA   = 0.05
LORBIT  = 11
NBANDS  = <1.5-2x default>   # enough empty bands
```

KPOINTS in line mode along the high-symmetry path for the structure's space group (pymatgen `HighSymmKpath`). Hybrid functionals can't use ICHARG=11 — use a zero-weight k-point scheme instead.

## Charge density / Bader

```ini
LCHARG  = .TRUE.
LAECHG  = .TRUE.         # AECCAR0/2 for all-electron density
NGXF    = <2x default>   # finer FFT grid improves Bader partitioning
NGYF    = <2x default>
NGZF    = <2x default>
```

Then: `chgsum.pl AECCAR0 AECCAR2` -> `bader CHGCAR -ref CHGCAR_sum`. Bader on the pseudo CHGCAR alone is wrong for charge-state claims.

## NEB / climbing-image NEB (VTST quick template)

```ini
IMAGES  = 4              # small default; use 6 for larger paths; cores divisible by IMAGES
SPRING  = -5
LCLIMB  = .TRUE.         # CI-NEB (VTST)
ICHAIN  = 0
IBRION  = 3
POTIM   = 0              # let VTST optimizers drive
IOPT    = 1              # LBFGS; 7 = FIRE if LBFGS oscillates
EDIFF   = 1E-7           # force accuracy matters for TS searches
EDIFFG  = -0.05          # loose first pass; tighten to -0.03 after
ISMEAR/SIGMA/ENCUT/k-mesh: identical to the endpoint relaxations
```

Directory layout `00/`(initial) through `0N/`(final) with relaxed endpoints' POSCAR+OUTCAR in `00` and `0N`. Check interpolated images for unphysical bond crossings before submitting. For CPU jobs, total cores must divide cleanly over `IMAGES`; if `NPAR` is set, total cores must be divisible by `IMAGES * NPAR`. For GPU jobs, prefer one image per GPU. For local VTST modules, `module load vtstscripts`, IDPP, Dimer, `nebresults.pl`, and convergence monitoring with `grep RMS OUTCAR`, load `references/vtst-neb-dimer.md`.

## Task rules beyond the templates

**Electronic analysis** — requires a *converged* static/relax run first; band/DOS runs read its CHGCAR (`ICHARG=11`). Energy comparisons between systems need an aligned reference (vacuum level via LOCPOT for slabs, a deep core state otherwise) — never compare raw eigenvalues across calculations.

**Reaction energetics** — write the energy expression *first*, with reference states and sign convention, e.g. `E_ads = E(slab+CO) - E(slab) - E(CO_gas)`; gas molecule in a >=15 A box, Gamma-only, same functional. Every energy entering one expression must use identical functional, ENCUT, k-density (per area), and convergence criteria; same cell for slab and slab+adsorbate. Report which corrections (ZPE, entropy, solvation, dipole) are and are not included.

**Electrochemical CHE / implicit solvent** — for OER/ORR/HER step diagrams, write the CHE cycle before running: adsorbate states, H2/H2O references, O2 back-calculation, pH, and potential scale (SHE/RHE). Use `__NEBULAMAT_AICC_ROOT__/knowledge/electrochemistry.md` for CHE formulas and constant-potential concepts; use `electrochemistry.md` here for `oer.xlsx`-style VASP energy assembly, VASPsol tags, and VASPsol++ setup.

**NEB / Dimer transition states** — both endpoints fully relaxed with identical settings before imaging; interpolated images checked for atoms passing through each other; climbing-image (`LCLIMB=.TRUE.`) for barriers. Use a VTST-enabled VASP build. A converged TS should show exactly one imaginary mode along the path if frequencies are computed.

**AIMD / finite-temperature sampling** — optimize a reasonable starting structure, heat/anneal to the target temperature, equilibrate, then run production long enough for the property. Use `IBRION=0`, explicit `NSW*POTIM`, `ISYM=0`, and record thermostat (`MDALGO`, `SMASS`), frame stride (`NBLOCK`), discarded equilibration frames, and analysis windows. Use Gamma-only `vasp_gam` for true `1 1 1` AIMD supercells when physically valid. Detailed templates and RDF/MSD/VACF/free-energy dynamics guidance live in `aimd.md`.
