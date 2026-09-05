# GROMACS `.mdp` Options: Stage and Physics Map

> Load this when: writing or reviewing a GROMACS `.mdp` file. Values shown as placeholders are decisions sourced from the force field, target ensemble, system geometry and published protocol — not universal defaults.

Use `gmx grompp -po mdout.mdp` to see the complete parameter set actually read. Parameter names are case-insensitive; use one canonical spelling and avoid duplicate keys.

## Stage discipline

Keep separate `.mdp` files for EM, temperature equilibration, pressure equilibration and production. At every transition, record only intended deltas: integrator/ensemble, restraints/macros, velocity generation versus continuation, thermostat/barostat, duration and output cadence.

## Integrator, timestep and duration

| Parameter | Purpose | Caution |
|---|---|---|
| `integrator = steep` | steepest-descent minimization | convergence is by `emtol`, not step count |
| `integrator = cg` / `l-bfgs` | tighter minimization | use after a sensible structure |
| `integrator = md` | leap-frog MD | standard atomistic production route |
| `integrator = sd` | stochastic/Langevin dynamics | thermostat behavior differs |
| `dt` | timestep in ps | 0.002 ps = 2 fs; validate constraints and drift |
| `nsteps` | number of steps | dynamics length = `dt * nsteps` |

Unconstrained atomistic X-H vibrations commonly require about 1 fs; intended X-H constraints commonly permit 2 fs. Hydrogen mass repartitioning, virtual sites, coarse graining, reactive models and strong external forcing require their own validation.

## Energy minimization

```ini
integrator = steep
nsteps     = <max_steps>
emtol      = <max_force_target_kj_mol_nm>
emstep     = <initial_step_nm>
```

Stopping because `nsteps` was exhausted is not convergence. A low potential energy does not compensate for one enormous force.

## Starting and continuing dynamics

| Parameter | New trajectory | Continuation |
|---|---|---|
| `continuation` | usually `no` | `yes` |
| `gen-vel` | `yes` only to initialize velocities | `no` |
| `gen-temp` | initialization temperature | ignored when `gen-vel = no` |
| `gen-seed` | record seed | do not regenerate velocities |

Production should inherit the equilibrated state through a checkpoint or full-precision state.

## Non-bonded settings

```ini
cutoff-scheme = Verlet
coulombtype   = PME
rcoulomb      = <nm>
vdwtype       = Cut-off
rvdw          = <nm>
vdw-modifier  = <force_field_policy>
DispCorr      = <force_field_and_geometry_policy>
```

Historical `cutoff-scheme = group` / charge-group neighbor searching should not be copied from old tutorials. PME is the normal periodic long-range electrostatics route for charged/polar condensed systems. A non-neutral PME system uses a uniform compensating background; that numerical convenience does not decide protonation or counterion chemistry. Homogeneous long-range dispersion corrections require care for slabs, interfaces, membranes and droplets.

## Constraints

```ini
constraints          = h-bonds
constraint-algorithm = LINCS
lincs-order          = <policy>
lincs-iter           = <policy>
```

`h-bonds` constrains bonds involving H. Rigid waters normally use `[ settles ]`. LINCS/SETTLE warnings indicate a physical or numerical stability failure, not merely insufficient output precision.

## Temperature and pressure coupling

```ini
tcoupl  = V-rescale
tc-grps = <physical_groups>
tau-t   = <one_value_per_group_ps>
ref-t   = <one_value_per_group_K>

pcoupl           = C-rescale
pcoupltype       = isotropic
tau-p            = <ps>
ref-p            = <bar_values>
compressibility  = <bar_minus_1_values>
```

- `V-rescale` is suitable for equilibration and production when configured correctly.
- `Nose-Hoover` is a production option with sensible coupling and sampling.
- `Berendsen` is historical/legacy; it suppresses fluctuations and is not a correct NPT production barostat.
- `C-rescale` and `Parrinello-Rahman` are production-capable pressure-coupling choices after density/pressure are prepared.
- `pcoupltype = semiisotropic` is common for membranes; do not pressure-couple a vacuum direction as bulk liquid.

## Periodicity and COM motion

| Parameter | Meaning |
|---|---|
| `pbc = xyz` | 3D periodicity |
| `pbc = xy` | planar periodicity with wall-specific limitations |
| `periodic-molecules = yes` | molecule connectivity crosses PBC, e.g. exact periodic sheet |
| `comm-mode`, `nstcomm`, `comm-grps` | center-of-mass removal policy |

`periodic-molecules` is not a synonym for ordinary PBC.

## Output control

```ini
nstlog              = <steps>
nstenergy           = <steps>
nstxout-compressed  = <steps>
nstxout             = 0
nstvout             = 0
nstfout             = 0
```

`.xtc` is lossy compressed coordinates. `.trr`/`.tng` can preserve full precision and, when requested, velocities/forces. Plan output from the observable backward: a 10-ps coordinate stride cannot resolve a 1-ps hydrogen-bond lifetime.

## Restraints, pulling and fields

```ini
define           = -DPOSRES -DPOSRES_LIGAND
refcoord-scaling = com
```

Position restraints require `grompp -r <reference.gro>`. A restraint is a bias: production observables are unbiased only if the production stage removes the bias or the reported quantity explicitly belongs to the restrained ensemble.

Pull-code and electric-field settings are scientific choices, not just syntax. Report collective variable, reference groups, PBC treatment, pulling direction, rate/spring, field units and nonequilibrium hysteresis.

## Legacy options

Do not mechanically port old course/tutorial inputs into a current installation:

- `cutoff-scheme = group` and charge-group neighbor searching are legacy.
- old `E-x`, `E-y`, `E-z`, `E-xt`, `E-yt`, `E-zt` syntax should be checked against the installed version; current inputs use `electric-field-x/y/z` style fields.
- historical built-in implicit-solvent/GBSA options are removed from current GROMACS; use a supported implementation/code or reproduce the historical software environment explicitly.
- command names and defaults are versioned; confirm with `gmx --version`, `gmx help`, the installed-version manual and `mdout.mdp`.
