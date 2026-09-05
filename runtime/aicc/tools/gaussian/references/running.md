# Running Gaussian: Routes, Templates, and Level-of-Theory Policy

> Load this when: writing any Gaussian input — header, route section, job-type templates, level-of-theory choice, or multi-step jobs.

Starting points; the reference paper's level of theory always wins for reproductions. `%mem` and `%nprocshared` must fit the actual node — leave OS headroom (e.g. request 16 GB on a 20 GB allocation).

## Header skeleton

```text
%chk=job.chk
%mem=16GB
%nprocshared=8
#p <route>

title line

<charge> <multiplicity>
<coordinates>

```

Gaussian input requires the trailing blank line. Keep paths ASCII and space-free when jobs move between Windows, Linux, and HPC.

## Route minimalism

Do not copy “universal” Gaussian routes. Use only keywords that change the calculation or improve the evidence needed for this job.

Usually unnecessary or risky as boilerplate:

- `sp`: single point is the default when no job-type keyword is present;
- `scf=tight`: already the default in modern Gaussian for many jobs;
- `scf=maxcyc=hundreds`: does not fix the cause of SCF failure;
- `freq=noraman`: not a general-purpose speed trick;
- `root=1`: default for many TD/CIS workflows when the first state is the target;
- explicit `R`/`U` prefixes: let Gaussian choose for ordinary closed/open-shell cases; specify `U` deliberately for broken-symmetry singlets;
- arbitrary `IOp(...)`: IOp is link-specific and can silently affect only part of a multistep job.

Use `nosymm` only when coordinate orientation, external-field direction, fragment alignment, density-difference analysis, or cross-program coordinate matching must be preserved. Do not add it by habit.

## Execution model

Gaussian is usually shared-memory on one node, unless a site-specific Linda setup is explicitly available. Scheduler request should match `%nprocshared`:

Before preparing the scheduler script, route through `__NEBULAMAT_AICC_ROOT__/tools/hpc-submit` and read
the target `~/.cluster-agents.md`. `%mem`, `%nprocshared`, module/load command,
`GAUSS_SCRDIR`, scratch cleanup, and any Linda policy come from that guide.

```bash
export GAUSS_SCRDIR="$SCRATCH/gauss.$SLURM_JOB_ID"; mkdir -p "$GAUSS_SCRDIR"
g16 < job.gjf > job.log
rm -rf "$GAUSS_SCRDIR"
```

Clean scratch after abnormal termination; Gaussian may leave large temporary files.

## Common routes

| Task | Route |
|---|---|
| SP, DFT + dispersion | `#p wB97XD/def2-TZVP` or `#p B3LYP/def2-TZVP empiricaldispersion=GD3BJ` |
| Opt + Freq (workhorse) | `#p B3LYP/6-31G(d) opt freq empiricaldispersion=GD3BJ` |
| Tight opt (floppy molecules, small imag. modes) | `#p ... opt=tight int=ultrafine freq` |
| Solvent (SMD) | append `scrf=(smd,solvent=water)` |
| TS search (with guess structure) | `#p ... opt=(calcfc,ts,noeigen) freq` |
| TS search (poor guess) | `opt=(calcall,ts,noeigen)` — expensive |
| IRC from a TS `.chk` with force constants | `#p ... irc=(rcfc,maxpoints=50) geom=check guess=read` |
| IRC without saved force constants | `#p ... irc=(calcfc,maxpoints=50) geom=check guess=read` |
| Relaxed scan | `#p ... opt=modredundant` + e.g. `B 1 2 S 10 0.1` after the coordinates |
| Single point at higher level on DFT geometry | separate jobs or `method2/basis2//method1/basis1`; quote as `level2//level1` |
| Restart an unchanged optimization | `#p ... opt=restart geom=check guess=read` |
| Restart with changed settings | make a new input from the last geometry or use `geom=check guess=read`; do not use `opt=restart` |

## Level-of-theory guidance

- Geometry + frequencies: B3LYP-D3(BJ) or ωB97X-D with 6-31G(d)/def2-SVP is the common economical tier; def2-TZVP for final energies.
- Anions and diffuse properties need diffuse functions (6-31+G(d), def2-TZVPD).
- Open-shell: unrestricted; check `S**2` and stability.
- Thermochemistry defaults: 298.15 K, 1 atm; add `temperature=`/`pressure=` if the comparison target differs; standard-state corrections (1 atm vs 1 M) are NOT automatic — handle in post-processing.

## Multi-step jobs

Chain with `--Link1--` and `geom=check guess=read` to reuse geometry/orbitals; each step needs its own `%chk` line repeated and counts toward the expected `Normal termination` total.

When using custom IOp/non-built-in functional definitions, split Opt and Freq into separate checked jobs unless you have verified every Link sees the same definition. Do not assume an IOp in a route section applies uniformly to all job steps.
