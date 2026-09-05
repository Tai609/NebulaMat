# Running VASPKIT

> Load this when: configuring VASPKIT, choosing a task family, running a task interactively, or turning a known menu sequence into a batch command.

VASPKIT is useful for routine VASP input generation and post-processing. Treat it as a reproducible helper: record version, task ID, menu answers, input files, and generated files.

## Environment setup

Minimum checks:

```bash
module avail VASPKIT vaspkit 2>&1 || true
command -v vaspkit
printf '0\n' | vaspkit | sed -n '1,40p'
test -f ~/.vaspkit && sed -n '1,120p' ~/.vaspkit
```

Module names can be case- and version-sensitive, so check the local module tree instead of assuming `module load vaspkit` works. Important `~/.vaspkit` fields vary by release, but usually include the VASP version switch, pseudopotential roots such as `PBE_PATH`, Python path, plotting settings, and the utilities path. The official installation guide describes copying the shipped environment template to `~/.vaspkit` and editing local paths.

Never store licensed pseudopotentials in this repository. Record only path, functional family, and POTCAR `TITEL` lines in run notes.
For new PBE PAW work, follow the VASP skill's local fallback only after checking the
source method, element-specific guidance, semicore physics, validation evidence, and
project convention; suffix variants such as `_pv`, `_sv`, or `_d` are required when
that evidence calls for them.

## Running styles

Interactive first pass:

```bash
cd run-dir
vaspkit
```

Non-interactive repeat of a known task:

```bash
printf '103\n' | vaspkit > vaspkit.103.log 2>&1
```

Scripted repeat:

```bash
uv run __NEBULAMAT_AICC_ROOT__/tools/vaspkit/scripts/run_vaspkit_task.py 103 --cwd run-dir
uv run __NEBULAMAT_AICC_ROOT__/tools/vaspkit/scripts/run_vaspkit_task.py 211 --cwd run-dir --stdin-file band.inputs
```

Only automate after one successful interactive run has identified the exact answer sequence for the installed VASPKIT version.

## Common task families

Task numbers change across releases, so prefer the local `vaspkit` menu and official feature list over memory. The following families are stable concepts:

| Goal | Typical inputs | Output to inspect |
|---|---|---|
| KPOINTS generation | POSCAR | KPOINTS, log with mesh density and symmetry choices |
| POTCAR generation | POSCAR, `~/.vaspkit`, licensed POTCAR tree, explicit element-potential mapping | POTCAR path/order log plus checked `TITEL` order; do not commit POTCAR |
| band path generation | POSCAR/CONTCAR | KPATH.in, KPOINTS, high-symmetry labels |
| DOS/PDOS processing | DOSCAR, vasprun.xml or PROCAR depending task | TDOS/PDOS data, projected orbital files; for 111-115 details load `dos-band.md` |
| band/proband processing | EIGENVAL, PROCAR, KPOINTS, OUTCAR | band data files and labels; for 21/25/projection details load `dos-band.md` |
| work function / electrostatic potential | LOCPOT, OUTCAR, slab geometry | planar/macroscopic average potential, vacuum level |
| charge-density difference | CHGCAR files on identical grids | difference cube/data and integrated checks |
| Bader helper files | CHGCAR, AECCAR0, AECCAR2 | CHGCAR_sum or helper outputs; final Bader still needs `bader` |
| Bader charge coloring | Bader output and final structure | charge-bearing visualization file; fixed color scale across comparisons |
| real-space wavefunction / partial charge | WAVECAR plus band/k-point context from EIGENVAL/PROCAR/DOS | state-resolved volumetric files for VESTA/VMD |
| EOS / elastic post-processing | multiple completed VASP runs | fitted parameters, stress/strain tables |
| MD analysis | XDATCAR/vasprun.xml, OUTCAR, POSCAR/CONTCAR | temperature, MSD/diffusion, VACF, VDOS, RDF, trajectory conversions; for details load `aimd-postprocessing.md` |
| thermochemistry / free-energy corrections | VASP frequency OUTCAR, gas molecule data | ZPE, U/H/G corrections, entropy, gas chemical potential tables |

## Energy references for electronic plots

- DOS/bands for ordinary bulk: Fermi level is acceptable if the material is metallic or the plot is explicitly `E - E_F`.
- Semiconductors/insulators: record whether zero is VBM, CBM, mid-gap, or Fermi level.
- Slabs and work functions: align with vacuum level from LOCPOT; record dipole correction status.
- Cross-system comparisons: do not compare raw eigenvalues from unrelated cells without an alignment reference.

## Batch pattern

Use one directory per VASP run and keep logs beside outputs:

```bash
for d in */; do
  [ -f "$d/OUTCAR" ] || continue
  uv run __NEBULAMAT_AICC_ROOT__/tools/vaspkit/scripts/check_vaspkit.py "$d" --require OUTCAR
  uv run __NEBULAMAT_AICC_ROOT__/tools/vaspkit/scripts/run_vaspkit_task.py 103 --cwd "$d" --log "vaspkit.103.log"
done
```

If one directory fails, stop the batch unless the run plan explicitly allows partial results.

## AIMD post-processing pointer

For VASPKIT MD Kit menu `72` workflows such as MSD/diffusion, VACF, VDOS, RDF/trajectory conversion, frame cuts, and fit-window validation, load `references/aimd-postprocessing.md`. Pair it with the `vasp` skill AIMD reference for the upstream trajectory setup, thermostat choices, and scientific interpretation.

## Thermochemistry pointer

For VASPKIT 403/501/502 workflows, gas chemical potentials, JANAF/NIST linkage, and surface free-energy correction tables, load `references/thermochemistry.md`. Pair it with the `vasp` skill surface-thermodynamics reference for equations and reference-state checks.

## Electronic-analysis pointer

For charge-density difference, planar-average charge rearrangement, work functions, Bader charge coloring, real-space wavefunctions, and partial/orbital charge-density workflows, load `references/electronic-analysis.md`. Read the VASPKIT output as part of a scientific evidence chain, not a standalone figure — interpretation rules are in `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`.

## DOS/band pointer

For VASPKIT 111-115 DOS/PDOS extraction, 21/25 band workflows, projected bands, and 503 d-band-center calculations, load `references/dos-band.md`. Pair it with the `vasp` skill DOS/band reference for calculation setup, and `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md` for alignment and interpretation rules.
