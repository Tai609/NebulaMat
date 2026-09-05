# Running Phonopy: Finite-Displacement Workflow

> Load this when: setting up displacements, force calculations, force constants, or band/DOS/thermal analysis.

## 1. Prerequisite: a tightly relaxed structure

Residual forces become phantom imaginary modes. Relax with forces < 1 meV/Å (`EDIFFG=-1E-3` in VASP) at production ENCUT/k-mesh before any displacement.

## 2. Generate displacements

```bash
phonopy -d --dim 2 2 2      # writes POSCAR-001..NNN + phonopy_disp.yaml
```

Supercell: ≥ ~10 Å in each direction; convergence vs `--dim` is part of the result, not optional. Default displacement amplitude (0.01 Å) is fine for most solids.

## 3. Force calculations

One *static* run per displaced structure, all identical settings. VASP per-displacement INCAR essentials:

```ini
EDIFF   = 1E-8
PREC    = Accurate
ADDGRID = .TRUE.
LREAL   = .FALSE.
NSW     = 0
LWAVE   = .FALSE. ; LCHARG = .FALSE.
ISMEAR/SIGMA/ENCUT/k-mesh: same as the relaxation
```

Submit as a job array (`hpc-submit`); before writing the array script, read the
target `~/.cluster-agents.md`. The displacement-directory → force-file mapping is
provenance — never reorder by hand. A validated MLP backend (via ASE calculators)
can replace DFT here (`mlp` skill).

## 4. Collect forces, build force constants

```bash
phonopy -f disp-*/vasprun.xml      # -> FORCE_SETS
```

## 5. Analysis

`band.conf`:

```text
DIM = 2 2 2
PRIMITIVE_AXES = AUTO
BAND = <high-symmetry path>        # pymatgen HighSymmKpath / seekpath
BAND_POINTS = 101
```

`phonopy -p -s band.conf`. DOS/thermal: `MP = 24 24 24` mesh, `phonopy -t -p mesh.conf` (free energy, entropy, Cv vs T).

**Polar materials**: LO-TO splitting needs a `BORN` file (Born charges + dielectric tensor from a `LEPSILON=.TRUE.` run) and `NAC = .TRUE.` — without it, bands near Γ are wrong.
