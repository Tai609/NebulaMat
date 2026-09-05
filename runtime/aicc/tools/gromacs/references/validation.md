# Validating GROMACS Simulations

> Load this when: deciding whether a GROMACS stage is safe to run, technically complete, equilibrated, or scientifically usable.

Validation ladder:

```text
files consistent -> mdrun completed/resumable -> stage physics passed -> observable scientifically valid
```

A scheduler `COMPLETED`, final `.gro`, or smooth-looking trajectory proves only part of this ladder.

## Static preflight

```bash
python __NEBULAMAT_AICC_ROOT__/tools/gromacs/scripts/check_gromacs_inputs.py \
  --mdp prod.mdp --gro npt.gro --top topol.top \
  --stage production --index index.ndx

gmx grompp -f prod.mdp -c npt.gro -t npt.cpt -r restraint_ref.gro \
  -p topol.top -n index.ndx -o prod.tpr \
  -po prod-mdout.mdp -pp prod-processed.top
```

Release gate:

- required files/includes exist;
- coordinate count equals topology-derived count;
- `[ molecules ]` order/counts match coordinate blocks;
- force field, water, ions, ligand parameters, charges and 1-4 rules are coherent and sourced;
- active restraint macros and reference coordinates are intentional;
- no unexplained `grompp` warning;
- `mdout.mdp` contains intended ensemble, timestep, cutoffs, constraints and output cadence;
- box geometry and periodicity fit the observable.

## Smoke-test gate

Every novel/generated setup gets a short, separately compiled run before expensive execution. It must exercise neighbor-list rebuilds, constraints/SETTLE, coupling, restraints/pull/walls/fields if present, expected output and intended CPU/GPU/domain decomposition. Reject on LINCS/SETTLE warning, NaN, runaway temperature/pressure, extreme box scaling, particle escape or topology/selection error.

## Technical completion parser

```bash
python __NEBULAMAT_AICC_ROOT__/tools/gromacs/scripts/parse_gromacs_log.py md.log --stage auto
```

Exit codes: `0` = technically completed with no detected stability warning; `1` = completed/resumable but needs review; `2` = fatal/incomplete/unstable. The parser reports only log evidence and cannot prove equilibration or sampling.

## Energy minimization gate

Require normal minimizer termination, declared force criterion reached or consciously accepted, finite energy/coordinates, no severe overlap, and sane final chemistry. Stopping because `nsteps` was exhausted is not convergence.

## Temperature equilibration gate

Evidence should include temperature around target after transient, plausible kinetic distribution, stationary potential energy, intended restraint energy behavior, no persistent COM drift or constraint warnings, and sane system-specific metrics such as protein core RMSD, ion coordination, membrane integrity or ligand-pocket contacts.

## Pressure/density equilibration gate

For bulk NPT: density and volume/box dimensions plateau, pressure fluctuates around target without systematic drift, barostat is production-appropriate if used for production, no box collapse/expansion, and solute/solvent contacts remain sane.

For membranes/interfaces/anisotropic cells also validate area per lipid, thickness/order, each box dimension, vacuum gap or interface position, leaflet composition and trapped water.

## Production gate

Before computing observables:

- production started from validated complete state with no new velocities;
- intended production ensemble/restraints/Hamiltonian are documented;
- log has no LINCS/SETTLE/non-finite/fatal error;
- target state variables are stationary over retained interval;
- interval is long enough for slowest target observable;
- raw trajectory passes `gmx check` and matches retained `.tpr`;
- PBC preprocessing is chosen per observable;
- uncertainty or sensitivity analysis is planned.

## Observable-specific bars

| Observable | Minimum scientific validation |
|---|---|
| RMSD/RMSF/PCA | consistent PBC repair and fit/reference selection; equilibration removed |
| hydrogen bonds/contacts | explicit geometry/contact definition; specific pairs and lifetimes, not count only |
| RDF/coordination | adequate box/sampling; bin and integration range recorded |
| diffusion/MSD | unwrapped trajectory; long-time linear regime; dimensionality and finite-size effects |
| viscosity/dielectric/fluctuation properties | correct ensemble/coupling; long correlation convergence; independent blocks |
| membrane area/order/diffusion | centered membrane; single-leaflet count; semi-isotropic protocol; long lateral sampling |
| interface density/surface tension | stable interface position; vacuum/box/dispersion/electrostatic checks |
| protein-ligand pose | protein-referenced fit; contacts/waters/torsions; no ligand self-fit artifact |
| PMF/pulling | equilibrated windows, overlap/convergence and valid CV |

## Reproducibility

Different seeds, GPUs, domain decompositions or compilers will diverge atom-by-atom. Validate distributions and observables, not frame identity. Independent replicas strengthen uncertainty estimates.

## Provenance

Preserve GROMACS version/build and launch command; structures; force-field/water/ion/custom-parameter identity; all `.top/.itp/.mdp/mdout.mdp/processed.top/.tpr/index/restraint/reference` files; logs, `.edr`, raw trajectory, final `.gro`, `.cpt`; build/preflight/parser commands; seeds and continuation history; analysis selections, intervals, units and uncertainty.
