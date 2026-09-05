# Running GROMACS: Stage-by-Stage Workflow

> Load this when: compiling and executing EM/equilibration/production stages, continuing a run, rerunning energies, or handing execution to HPC.

## Record the environment

```bash
gmx --version
gmx help grompp
gmx help mdrun
```

Record the exact binary, version, precision, MPI/thread/GPU support, module/container and launch command. The course-era name of a command or option is not evidence it remains supported.

## Compile every stage explicitly

```bash
gmx grompp \
  -f em.mdp \
  -c system.gro \
  -r system.gro \
  -p topol.top \
  -n index.ndx \
  -o em.tpr \
  -po em-mdout.mdp \
  -pp em-processed.top
```

Before running: read every warning; inspect the `grompp` summary, `mdout.mdp`, and processed topology; use `gmx dump -s stage.tpr` or `gmx check` when comparing compiled inputs. `-maxwarn` is an exceptional, documented override, not a routine flag.

## Energy minimization

```bash
gmx mdrun -deffnm em -v
python __NEBULAMAT_AICC_ROOT__/tools/gromacs/scripts/parse_gromacs_log.py em.log --stage em
```

Release gate:

- finite potential and forces;
- minimizer reached the declared force criterion, or an unmet criterion is consciously accepted for a documented reason;
- no atom overlap, topology error, LINCS/SETTLE failure or non-finite coordinate;
- resulting geometry remains the intended chemical model.

## Equilibration

```bash
gmx grompp -f nvt.mdp -c em.gro -r em.gro -p topol.top -n index.ndx \
  -o nvt.tpr -po nvt-mdout.mdp -pp nvt-processed.top
gmx mdrun -deffnm nvt -v

gmx grompp -f npt.mdp -c nvt.gro -r em.gro -t nvt.cpt \
  -p topol.top -n index.ndx -o npt.tpr -po npt-mdout.mdp -pp npt-processed.top
gmx mdrun -deffnm npt -v
```

Stage names are conventions, not proof of the ensemble. Verify the compiled thermostat/barostat, restraints, velocity policy and box coupling. Equilibration is validated by stationarity of relevant variables, not by reaching a planned duration.

## Production

```bash
gmx grompp -f prod.mdp -c npt.gro -t npt.cpt -p topol.top -n index.ndx \
  -o prod.tpr -po prod-mdout.mdp -pp prod-processed.top
gmx mdrun -deffnm prod -v
```

Production requirements:

- `gen-vel = no`; inherit the validated state;
- production thermostat/barostat generates the intended ensemble;
- intended restraints only;
- output intervals resolve target observables;
- raw trajectory, energy, log, final structure and checkpoint are preserved;
- no observable averaged over heating/equilibration unless explicitly studying that non-equilibrium process.

## Smoke test before walltime

For every novel topology, force-field integration, generated system, external field/pull setup or script-produced job: compile a short stage, run long enough to exercise neighbor-list rebuilds, constraints, coupling and output, then inspect forces/temperature/pressure/box and all warnings. A smoke test checks technical stability; it is not reportable data.

## Checkpoint continuation

Normal continuation uses the complete state in `.cpt`:

```bash
gmx mdrun -deffnm prod -cpi prod.cpt
```

For a planned separate segment:

```bash
gmx convert-tpr -s prod.tpr -extend <additional_ps> -o prod2.tpr
gmx mdrun -deffnm prod2 -cpi prod.cpt -noappend
```

Rules:

- prefer checkpoint continuation over restarting from `.gro`, which lacks coupling/random/integrator state;
- do not regenerate velocities;
- changing force field, ensemble, thermostat/barostat family or other Hamiltonian-defining settings starts a new provenance segment;
- do not concatenate trajectories until time continuity, atom order and duplicate boundary frames are checked.

`mdrun -maxh <hours>` requests a controlled stop and checkpoint near the walltime limit. Scheduler state still does not validate the simulation; parse the log and continue from checkpoint.

## Parallel and GPU execution

The execution command comes from `~/.cluster-agents.md` and `hpc-submit`. Examples are illustrative only:

```bash
gmx mdrun -deffnm prod -ntmpi <ranks> -ntomp <threads> -pin on
srun gmx_mpi mdrun -deffnm prod
```

Let GROMACS auto-place work first, then benchmark representative steps. More ranks or GPUs can slow small systems. Manual task mapping is a performance experiment and must be recorded.

## Rerun energies

```bash
gmx mdrun -s rerun.tpr -rerun trajectory.xtc -deffnm rerun
```

Use for recomputing energy terms with a compiled Hamiltonian. Requirements: same atom count/order, appropriate PBC representation and explicit disclosure if the rerun Hamiltonian differs from the production Hamiltonian. Rerun energies are not new dynamics or new sampling.

## Provenance record

For every stage retain input coordinate, reference coordinate, checkpoint, `.mdp`, `mdout.mdp`, `.top`, all `.itp`, processed topology, index file, active macros, `.tpr`, exact command/environment, log, `.edr`, trajectory, final structure, checkpoint, parser output and validation decision.
