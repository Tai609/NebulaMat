# Running LAMMPS: Input Templates per Force-Field Family

> Load this when: writing a LAMMPS input script — units/atom_style pairing, templates for EAM/ReaxFF/DeePMD/MACE, slab setups.

## units / atom_style / pair_style pairing

| Family | units | atom_style | notes |
|---|---|---|---|
| EAM, Tersoff, SW, metals | `metal` (ps, eV, Å) | `atomic` | timestep in ps: `0.001` = 1 fs |
| ReaxFF | `real` (fs, kcal/mol, Å) | `charge` | needs `fix qeq/reaxff` |
| DeePMD / MACE | `metal` | `atomic` | type order must match model's type_map |
| Classical molecular FF | `real` | `full` | bonds/angles/dihedrals from data file |

## Classical metal (EAM): minimize -> NVT equilibrate -> NPT production

```text
units           metal
atom_style      atomic
boundary        p p p
read_data       data.lmp

pair_style      eam/alloy
pair_coeff      * * Cu01.eam.alloy Cu

minimize        1.0e-8 1.0e-10 5000 50000

velocity        all create 300.0 4928459 dist gaussian mom yes rot yes
timestep        0.001

# --- equilibration (NVT) ---
fix             eq all nvt temp 300.0 300.0 0.1
thermo          100
thermo_style    custom step temp pe ke etotal press vol density
run             50000
unfix           eq

# --- production (NPT) ---
fix             prod all npt temp 300.0 300.0 0.1 iso 1.0 1.0 1.0
dump            d1 all custom 1000 traj.lammpstrj id type x y z vx vy vz
run             500000
```

## ReaxFF

```text
units           real
atom_style      charge
read_data       data.lmp

pair_style      reaxff NULL
pair_coeff      * * ffield.reax.cho C H O      # order = atom types in data file
fix             q all qeq/reaxff 1 0.0 10.0 1e-6 reaxff

timestep        0.25                            # fs; ReaxFF needs <= 0.25-0.5
fix             1 all nvt temp 300.0 300.0 25.0
fix             sp all reaxff/species 10 10 100 species.out   # reaction tracking
```

ffield files are parameterized for specific chemistries — using one outside its fitted element set / conditions is a scientific decision to surface, not a default.

## DeePMD potential

```text
units           metal
atom_style      atomic
read_data       data.lmp
pair_style      deepmd graph.pb
pair_coeff      * *
# atom types in data.lmp MUST be in the model's type_map order
```

For on-the-fly reliability checks: `pair_style deepmd graph0.pb graph1.pb graph2.pb graph3.pb out_file md.out out_freq 100` writes model deviation — see `deepmd` skill for thresholds.

## MACE potential

```text
units           metal
atom_style      atomic
pair_style      mace no_domain_decomposition
pair_coeff      * * model.model-lammps.pt C H O
```

Requires the LAMMPS-MACE build; convert the trained model with `mace_create_lammps_model`.

## Slab / non-periodic directions

`boundary p p f` plus `kspace_modify slab 3.0` if using long-range electrostatics; fix bottom layers with a group + `fix setforce 0 0 0` (and exclude that group from the thermostat's temperature compute).

## Launching

LAMMPS is MPI-parallel; launch with the scheduler's MPI wrapper and keep the log explicit:

```bash
srun lmp -in in.production -log log.lammps    # or mpirun -np $SLURM_NTASKS lmp ...
```

Scheduler templates and queue mechanics live in the `hpc-submit` skill. Before
writing a batch script, read the target `~/.cluster-agents.md`; the binary name,
module, MPI wrapper, GPU policy, and scratch conventions come from that guide.
