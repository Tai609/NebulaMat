# CP2K Grids, k-Points, and Performance

> Load this when: choosing or converging `CUTOFF`, `REL_CUTOFF`, `NGRIDS`, k-point meshes, Gamma supercells, MPI/OpenMP layout, memory, or smoke-test cost for CP2K.

This file mirrors the global-policy style of `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/running.md`, but CP2K's controls are not VASP's controls. `CUTOFF` is not `ENCUT`; `REL_CUTOFF` has no simple VASP analogue; and the Gaussian basis must be converged separately from the auxiliary grid.

## Grid policy

Set both values explicitly:

```text
&DFT
  &MGRID
    CUTOFF 400
    REL_CUTOFF 50
    NGRIDS 4
  &END MGRID
&END DFT
```

Starting points:

| Use | CUTOFF / Ry | REL_CUTOFF / Ry | Notes |
|---|---:|---:|---|
| syntax/smoke test | 200-300 | 30-40 | not for production |
| routine GPW organic/soft systems | 400-500 | 50-60 | confirm by energy/forces |
| oxides, hard potentials, stress, phonons | 600-900+ | 60-80+ | property-specific convergence required |
| GAPW/all-electron-like work | method-specific | method-specific | do not reuse GPW defaults |

These are heuristics. The basis/potential family can move the required cutoff substantially.

## Two-step convergence protocol

1. Fix `REL_CUTOFF` high enough, commonly 60-80 Ry for the test.
2. Sweep `CUTOFF` and record total energy, forces or stress if relevant, walltime, and grid distribution.
3. Choose a `CUTOFF` where the target property is stable.
4. Fix that `CUTOFF`, then sweep `REL_CUTOFF`.
5. Re-check the final pair on the actual production structure/class, not only a toy cell.

Do not simply increase `CUTOFF` while leaving `REL_CUTOFF` too low. A low `REL_CUTOFF` can keep important Gaussian-product terms on coarse grids and cause slow or misleading convergence.

Minimal sweep driver:

```bash
for cutoff in 300 400 500 600 700 800; do
  d="cutoff_${cutoff}"
  mkdir -p "$d"
  sed "s/__CUTOFF__/${cutoff}/; s/__REL_CUTOFF__/60/" template.inp > "$d/input.inp"
  (cd "$d" && <CP2K_EXE> -i input.inp -o output.out)
done
grep -H "ENERGY| Total FORCE_EVAL" cutoff_*/output.out > cutoff_energy.txt
```

For force/stress-sensitive properties, parse the relevant output too; total energy alone can look converged while forces or stress remain noisy.

## Grid distribution check

Run with enough print detail to inspect multigrid information. Record:

- `CUTOFF`, `REL_CUTOFF`, `NGRIDS`;
- grid distribution / Gaussian product assignment;
- total energy and target property;
- walltime and rank/thread layout;
- CP2K version and basis/potential library.

If a small `REL_CUTOFF` places many products on very coarse grids, tighten `REL_CUTOFF` before assuming the basis or functional is the problem.

## k-point policy

For ordinary Gamma-only calculations, omit the `&KPOINTS` section. In CP2K, explicitly asking for `SCHEME GAMMA` or `MONKHORST-PACK 1 1 1` can trigger the k-point code path and add overhead.

```text
&DFT
  &KPOINTS
    SCHEME MONKHORST-PACK 4 4 4
    WAVEFUNCTIONS COMPLEX
  &END KPOINTS
&END DFT
```

Rules:

- bulk primitive cells usually need k-point convergence;
- slabs use k-points only in periodic in-plane directions;
- molecules and large disordered/MD supercells are normally Gamma-only;
- metals and small-gap systems need denser sampling and smearing tests;
- nonuniform band paths are not production SCF k-meshes;
- hybrid/HFX, ADMM, RI-HFX, DOS, band, and property support are version-dependent.

## k-point convergence pattern

Use a mesh series consistent with lattice shape and symmetry:

```bash
for k in 2 3 4 5 6; do
  d="k_${k}${k}${k}"
  mkdir -p "$d"
  sed "s/__KPOINTS__/SCHEME MONKHORST-PACK ${k} ${k} ${k}/" template.inp > "$d/input.inp"
  (cd "$d" && <CP2K_EXE> -i input.inp -o output.out)
done
```

For anisotropic cells, use approximately equal reciprocal-space spacing rather than equal integers in all directions. For slab cells, keep the vacuum direction at one point.

## Supercell versus k-points

Gamma supercells and k-point primitive cells can be mathematically related for simple properties, but they are not always equivalent in cost or feature support. Test the target observable:

- total energy per atom/formula unit;
- adsorption/reaction energy;
- band gap/DOS feature;
- force/stress;
- local moment/charge localization.

When a CP2K feature does not support the desired k-point workflow, do not silently drop k-points. Either justify a converged Gamma-supercell alternative or choose a different method/code.

## Executable and layout

| Binary | Typical use |
|---|---|
| `cp2k.sopt` | serial optimized; debugging/tiny jobs |
| `cp2k.ssmp` | OpenMP-only jobs |
| `cp2k.popt` | MPI-only jobs |
| `cp2k.psmp` | MPI + OpenMP; often best for production |

Benchmark representative cases. Use `<CP2K_EXE>` as a placeholder for the site-selected binary. Hybrids, NEB, vibrational analysis, large cube outputs, and large-memory diagonalization can prefer fewer MPI ranks with more OpenMP threads because memory is per rank.

Example launch notes:

```bash
export OMP_NUM_THREADS=4
mpirun -np 16 cp2k.psmp -i input.inp -o output.out
```

Record ranks, threads, binary, BLAS/ScaLAPACK/GPU build if relevant, and node type. Do not copy a fast layout from a small semilocal calculation to HFX/RI-HFX/NEB without retesting.

## Smoke tests

Before a long production run:

1. `<CP2K_EXE> -c input.inp` to catch syntax and missing files.
2. Run 1-3 SCF steps or a tiny `MAX_ITER`/`STEPS` test in a separate folder.
3. Confirm basis/potential files are found, atom counts are right, cell/PBC are intended, and SCF starts.
4. Mark smoke-test energies as unusable.

The smoke test is a parser/environment check, not a convergence result.

## Reporting checklist

For every production number, preserve:

- final `CUTOFF`, `REL_CUTOFF`, `NGRIDS`, grid distribution if printed;
- k-point mesh or explicit Gamma-supercell justification;
- smearing/`ADDED_MOS` if used;
- basis/potential/auxiliary basis files;
- CP2K version, binary, MPI ranks, OpenMP threads, node/GPU details;
- convergence table for properties sensitive to grid, k-points, or cell size.
