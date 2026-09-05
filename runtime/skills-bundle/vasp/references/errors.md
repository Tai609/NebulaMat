# VASP Error Recovery

> Load this when: a VASP run crashed, printed a warning, won't converge, or finished with suspicious results.

Look up the exact string from stdout/OUTCAR before changing anything. Apply ONE fix at a time and record it; shotgun changes destroy comparability.

## Crash / abort messages

| Message (grep target) | Likely cause | Fix |
|---|---|---|
| `ZBRENT: fatal error in bracketing` / `fatal error: bracketing interval incorrect` | line-search confused by noisy forces near the minimum | `cp CONTCAR POSCAR` and restart; tighten `EDIFF=1E-6`; switch `IBRION=1` near convergence |
| `Error EDDDAV: Call to ZHEGV failed` | diagonalization instability, often stale WAVECAR or aggressive ALGO | delete WAVECAR; `ALGO=Normal` (then `All` if it persists); reduce `NCORE`/`NSIM` |
| `WARNING: Sub-Space-Matrix is not hermitian in DAV` | SCF divergence, bad mixing or geometry | check structure for overlapping atoms first; then `ALGO=All`, reduce `AMIX` |
| `TOO FEW BANDS` | NBANDS too small (often after MAGMOM/NELECT change) | raise `NBANDS` ~1.3–2× the message's minimum |
| `BRMIX: very serious problems the old and the new charge density differ` | charge sloshing (slabs, magnetic, charged cells); wrong NELECT | linear mixing: `AMIX=0.2 BMIX=0.0001` (+`AMIX_MAG=0.8 BMIX_MAG=0.0001` if spin-polarized); verify NELECT |
| `VERY BAD NEWS! internal error in subroutine SGRCON/IBZKPT` | symmetry detection failure | `SYMPREC=1E-4` (or 1E-6 the other way); last resort `ISYM=0` |
| `internal error in subroutine PRICEL` | supercell with broken symmetry confuses primitive-cell detection | `ISYM=0`, or rebuild the cell cleanly |
| `RHOSYG internal error` / `POSMAP internal error` (VASP 6) | symmetrization tolerance | `SYMPREC=1E-4`; then `ISYM=0` |
| `Tetrahedron method fails` | `ISMEAR=-5` with < 4 irreducible k-points or during cell change | `ISMEAR=0` (relax) and keep `-5` only for the final static/DOS on a dense mesh |
| `ZPOTRF` (LAPACK) during relaxation | atoms collided — structure exploded | inspect trajectory (XDATCAR); restart from last sane geometry with smaller `POTIM` (0.1–0.2) |
| `inverse of rotation matrix was not found` | distorted/least-squares cell + symmetry | `ISYM=0` |
| segfault / OOM with no VASP message | memory: too many bands per core, huge FFT grids | raise nodes or lower `KPAR`; set `NCORE` to cores-per-node; check `PREC`/NG*F |

## Runs that finish but are wrong

| Symptom | Cause | Fix |
|---|---|---|
| ionic loop ends at `NSW` without `reached required accuracy` | not converged | restart from CONTCAR; near the minimum switch `IBRION=1`; if soft modes thrash, loosen the **force** criterion `EDIFFG` (e.g. `-0.03`) — *not* `EDIFF` (raising EDIFF loosens the electronic SCF and makes forces noisier) |
| SCF hits `NELM` every ionic step, or the final ionic/static step hits `NELM` | electronic convergence broken, final forces/energy unusable | fix SCF first (below) — do not trust the final number |
| only the first ionic step hits `NELM`, later steps converge | rough starting density or difficult first geometry | record as a warning; if the final geometry/energy matters, restart from the later CONTCAR/WAVECAR with more SCF headroom and confirm the final step converges |
| energy oscillates between ionic steps | `POTIM` too large or smearing too small | `POTIM=0.2`; for metals raise `SIGMA` within the `T*S` budget |
| final magnetization ~0 in a known magnet | converged to nonmagnetic local minimum | restart with high-spin MAGMOM (see u-values-magmom.md); consider starting from a converged spin density |
| cell relaxation volume drifts run-to-run | Pulay stress at low ENCUT | `ENCUT >= 1.3 x ENMAX`, iterate relax->copy CONTCAR->relax until ΔV < 0.3 % |
| adsorption energy way off literature | inconsistent references | same ENCUT/k-density/functional everywhere; gas molecule in a big box Γ-only; check dipole correction for polar slabs |

## SCF won't converge (escalation ladder)

1. **Sanity-check the structure first** (distances > 0.7 Å, sensible cell, no overlapping or exploded atoms) — most "SCF problems" are geometry problems. *(If you grepped to this file for `EDDDAV` / `ZHEGV` / `BRMIX` / `Sub-Space-Matrix` / "charge sloshing" / "not converging": do this rung **before** touching ALGO / mixing / SIGMA — a broken structure defeats every electronic fix.)*
2. Early SCF stabilization can be one restart: set `NELM=300`, `NELMDL=-20` (delayed density update), switch to `ALGO=Normal` from Fast/VeryFast, and delete stale WAVECAR/CHGCAR when the prior wavefunction may be inconsistent.
3. For slab calculations, check whether dipole correction was enabled by habit: `LDIPOL=.TRUE.` with `IDIPOL=3` can make SCF much harder to converge. Unless the task needs a z-direction electrostatic-potential/work-function `LOCPOT` analysis or a deliberately documented dipole correction, remove it and restart from a clean charge density.
4. Mixing: `AMIX=0.2 BMIX=0.0001` (slabs/magnetic add the `_MAG` pair).
5. Smearing: temporarily larger `SIGMA` to converge, then restart tighter from that WAVECAR.
6. `ALGO=All` (damped, robust, slow) — production-acceptable last resort.
7. Magnetic systems: converge nonmagnetic first, restart spin-polarized from its WAVECAR/CHGCAR; or constrain with reasonable MAGMOM and `ICHARG=1`.

### Small metal cluster + adsorbate (e.g. Pt_n + CO) — a recurring `EDDDAV/ZHEGV` / non-hermitian trap

Adsorbate-on-small-metal-cluster models are the most SCF-fragile case here: many near-degenerate d states + a molecular adsorbate level give a tiny, fluctuating HOMO–LUMO gap, so plain `ALGO=Normal` and "just raise NBANDS" often still diverge (this is what kills `Pt4–CO`-type adducts). Recipe, in order:

1. Build the adduct from the *already-relaxed* bare-cluster WAVECAR/CHGCAR (don't start CO+cluster from scratch); add CO at a sensible 1.8–2.0 Å M–C distance.
2. Finite electronic temperature so fractional occupancies can stabilize the gap: `ISMEAR=0, SIGMA=0.05` (metallic cluster) — *not* tetrahedron; for a stubborn case `SIGMA=0.1` to converge, then restart tighter.
3. `ALGO=All` (or `Damped` with `TIME=0.1–0.4`) — for a fluctuating gap this is the *first* robust choice, not the last resort.
4. Generous `NBANDS` (≈ valence electrons/2 + 0.5–1× atom count) **and** `NELM=300`, `NELMDL=-20`.
5. Magnetic clusters: set explicit per-atom `MAGMOM`; if the moment is sloshing, fix it with `ISPIN=2` + `NUPDOWN` (total moment constrained) until SCF settles, then release.
6. Conservative mixing for the slosh: `AMIX=0.1 BMIX=0.0001` (+ `AMIX_MAG=0.4 BMIX_MAG=0.0001`).

If it still won't converge as a single static SCF, the minimal cluster is a poor probe — switch model (a larger or planar cluster, or a single-atom site) rather than forcing a number, and record the abandoned attempt.

### Magnetic oxide surface + metal adsorbate/dopant won't converge (charge sloshing + spin flips)

A metal atom or cluster on a magnetic, partly-reduced oxide (hematite, magnetite, ceria, NiO, reduced WOₓ/TiOₓ) is the other recurring SCF battle — charge sloshes between the metal and the redox-active cation while the local moments flip. Recipe:

1. **`LMAXMIX`** must match the highest occupied l in the mixer: **`LMAXMIX=4` for d-electron oxides (Fe/Ni/Ti/W…), `LMAXMIX=6` for f (Ce, Eu, lanthanides)** — the default 2 alone causes the slosh and wrong charges/moments. (Set it even when +U is off.)
2. **Explicit per-atom `MAGMOM`** with the intended magnetic order (e.g. AFM ± on the cation sublattice, high-spin on the adsorbate); converge it, then check the final moments against the initialization (a collapsed moment = wrong local minimum).
3. **Hard linear mixing** for the slosh: `AMIX=0.2 BMIX=0.0001` **plus** `AMIX_MAG=0.8 BMIX_MAG=0.0001`.
4. Converge the **clean oxide surface first**, then add the metal and restart from that `WAVECAR`/`CHGCAR`; or converge non-magnetic first and restart spin-polarized.
5. `ALGO=Normal` → `All` if it persists; `NELM=300`, `NELMDL=-20`; `ISMEAR=0 SIGMA=0.05`.
6. If a partly-reduced/`+U` system has multiple electronic solutions, track the moment per state and report which solution each energy belongs to (different solutions = different parabolas; don't compare across them).

### Floppy / weakly-bound adsorbate: energy converged but forces won't drop

A physisorbed or weakly-bound adsorbate (a methyl/hydroxyl rotor, a tilting H₂O, a floppy chain) keeps a residual force on its soft rotational/translational modes long after the binding is set, so a plain `EDIFFG` relaxation runs to `NSW` without `reached required accuracy`. Recipe:

1. Confirm the residual is on the adsorbate's **soft modes**, not the binding bond or the slab — read per-atom forces (`parse_vasp.py`). If the binding atom or a slab atom is above `|EDIFFG|`, it's a real non-convergence (fix that), not a soft mode.
2. Lower the electronic floor so forces aren't noise-limited: `EDIFF=1E-6`; switch to `IBRION=1` (RMM-DIIS) near the minimum — better than CG on a flat soft mode.
3. Do **not** read a *still-descending* energy as a plateau — keep relaxing until dE < ~1 meV/step **and** non-monotonic; a slow one-way drift is unfinished.
4. If forces still linger only on the soft mode at a genuinely stationary energy, accept under the **narrow exception in `validation.md`** and **disclose the residual in the deliverable**. Do **not** loosen `EDIFFG` to manufacture `reached required accuracy`, and do not strip the caveat.
5. For an adsorption energy a conclusion hinges on, verify the **binding-coordinate** force is converged (or finite-difference it) rather than trusting the energy plateau.

## Restart rules

- Geometry restarts: `CONTCAR -> POSCAR`, keep WAVECAR if same cell and settings, delete it if ALGO/ENCUT/k-mesh changed.
- A restart with changed physical settings (ENCUT, k, functional, U) starts a NEW calculation for provenance purposes — never splice energies across it.
