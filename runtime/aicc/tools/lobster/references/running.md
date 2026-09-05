# Running LOBSTER: VASP prep, lobsterin, execution

> Load this when: preparing the VASP static that feeds LOBSTER, writing `lobsterin`, matching the basis to the PAW potential, or launching `lobster`.

## Step 1 — VASP static for LOBSTER

LOBSTER reads VASP wavefunctions/structure; VASP is not recompiled. Run a static single-point
at the geometry whose bonding you want (general static mechanics: `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/running.md`),
with these LOBSTER-specific settings:

```ini
NSW    = 0
LWAVE  = .TRUE.
LCHARG = .TRUE.
ISYM   = -1            # LOBSTER does not use VASP symmetry reduction for the projection
LREAL  = .FALSE.
PREC   = Accurate
EDIFF  = 1E-6
# NBANDS = ...          # often larger than the VASP default (see below)
```

Rules:

- PAW potentials only, not ultrasoft.
- Do not use a gamma-only VASP wavefunction for LOBSTER; use a standard build/output.
- Remove a stale `WAVECAR` before the final static if it might come from incompatible settings.
- `LORBIT`/`NEDOS`/`EMIN`/`EMAX` control VASP DOS, not LOBSTER output.
- `NBANDS` must be large enough for projection onto the chosen basis. If LOBSTER warns that
  more bands are needed, rerun VASP with larger `NBANDS` — a common first try is ~1.5× the
  default printed in `OUTCAR`, but use LOBSTER's warning as the real guide.

Preserve `POSCAR`/`CONTCAR`, `POTCAR` metadata, `INCAR`, `KPOINTS`, `WAVECAR`, `CHGCAR`, `OUTCAR`, and the exact `lobsterin`.

## Step 2 — `lobsterin`

Minimal pair-specific template:

```text
COHPstartEnergy -15
COHPendEnergy 10
basisSet pbeVaspFit2015
basisfunctions C 2s 2p
basisfunctions O 2s 2p
basisfunctions Ni 4s 3d
cohpbetween atom 21 and atom 25 orbitalwise
cohpbetween atom 26 and atom 25 orbitalwise
gaussianSmearingWidth 0.2
saveProjectionToFile
```

Distance/type generated template:

```text
COHPstartEnergy -15
COHPendEnergy 10
basisSet pbeVaspFit2015
basisfunctions Pt 6s 5d
basisfunctions N 2s 2p
cohpGenerator from 1.5 to 2.3 type Pt type N orbitalwise
saveProjectionToFile
```

Notes:

- Prefer `basisSet pbeVaspFit2015` for VASP PBE workflows unless a reproduction requires another set.
- **Match `basisfunctions` to the VASP PAW potential.** An `_sv` potential usually needs semicore
  orbitals; a normal potential uses fewer valence orbitals. A mismatch shows up as large charge spilling.
- `COHPstartEnergy`/`COHPendEnergy` set the output window relative to the Fermi convention; `-15` to `10` eV
  is a common start — keep a consistent range across compared systems.
- Add `orbitalwise` when σ/π or s-p/d-p decomposition matters. If the local LOBSTER version wants slightly
  different `cohpbetween` syntax, keep the working syntax in the run notes.
- `saveProjectionToFile` for the first expensive projection; `loadProjectionFromFile` for follow-up runs
  that only change atom pairs — after confirming structure, basis, and wavefunction are unchanged.

## Step 3 — execute

On module clusters, check/load the local module and confirm it runs:

```bash
module avail lobster
module load lobster
lobster --version 2>/dev/null || true
```

Run on a compute node, not the login node. LOBSTER is OpenMP-parallel:

```bash
export OMP_NUM_THREADS=24    # use the threads the scheduler gave you
lobster
```

If the cluster wrapper already sets `OMP_NUM_THREADS`, don't override it blindly. Module name,
path, and thread policy are site facts — see the cluster's `~/.cluster-agents.md`.
