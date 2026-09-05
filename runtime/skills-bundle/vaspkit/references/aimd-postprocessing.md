# VASPKIT AIMD Post-processing

> Load this when: using VASPKIT to analyze VASP AIMD trajectories, especially MSD/diffusion, VACF, VDOS, RDF-like trajectory summaries, or trajectory conversion. Pair with `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/aimd.md` for the VASP calculation setup and `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-dynamics.md` for the scientific interpretation (diffusion fitting, RDF/VACF/VDOS meaning, sampling discipline).

Task IDs can vary by VASPKIT release. Confirm the local menu before automation and record every menu answer. In VASPKIT Standard Edition 1.4.1, the Molecular-Dynamics Kit is menu `72`: `721` MSD, `722` MSD using FFT, `723` diffusion coefficient and ion mobility from `MSD.dat`, `725` pair correlation from `PCDAT`, `726` RDF between two selected elements, `727` VACF, `728` VDOS from VACF, `736` selected-atom trajectory in POSCAR format, and `737` selected-atom trajectory in PDB format.

## Required upstream files

Minimum inputs depend on the task, but commonly include:

- `XDATCAR` for trajectory positions;
- `OUTCAR` or `vasprun.xml` for timestep, masses, lattice, and velocity-related metadata;
- `POSCAR/CONTCAR` for species order and atom indices;
- the INCAR actually used, especially `POTIM`, `NBLOCK`, `TEBEG/TEEND`, `MDALGO`, and `SMASS`.

Validate the VASP AIMD run first. VASPKIT can parse a broken trajectory, but it cannot make unconverged MD scientifically valid.

## MSD and diffusion coefficient

Use the VASPKIT MSD tasks (`721` or the recommended FFT route `722` in version 1.4.1), then use the diffusion task (`723` in version 1.4.1) for selected atom types or atom indices when appropriate. Typical menu choices ask for:

- selected element or atom list;
- initial frames to skip as equilibration;
- frame stride;
- reference/time-origin handling;
- dimensionality or direction, depending on the release.

Outputs are commonly named like `MSD.dat` and `DIFFUSION_COEFFICIENT.dat`, but check the local log. Inspect the MSD curve manually. Fit only the long-time diffusive region; do not fit the early ballistic region or a section with too few hopping events.

Unit rule for 3D diffusion:

```text
D(cm^2/s) = slope(A^2/ps) / 6 * 1E-4
```

For 2D diffusion use denominator 4, and for 1D use denominator 2. Report dimensionality, selected atoms, skipped frames, fit range, and whether the trajectory was unwrapped or otherwise corrected for periodic crossings.

## VACF and VDOS

The VASPKIT VACF task (`727` in version 1.4.1) commonly produces `VACF.dat`; the VDOS task (`728` in version 1.4.1) Fourier-transforms the VACF and can output frequency axes such as `cm^-1`. Use an AIMD trajectory with adequate time resolution (`NBLOCK=1` is safest). Before trusting the peaks:

- confirm `POTIM` and frame stride give the correct time step;
- discard equilibration frames;
- use the same atom selection when comparing adsorbate, solvent, and surface contributions;
- remember VDOS is not automatically IR/Raman intensity.

VDOS is especially useful for anharmonic broadening, finite-temperature adsorbate modes, liquids, and low-frequency surface/solvent motion. For harmonic frequencies and thermochemistry, use the frequency workflow in `thermochemistry.md`; for AIMD-derived vibrational signatures, keep this trajectory-based workflow separate.

## RDF and trajectory conversion

VASPKIT 1.4.1 provides pair-correlation/RDF tasks (`725` from `PCDAT`, `726` between selected elements) and selected-atom trajectory exports (`736` POSCAR format, `737` PDB format). VMD, OVITO, and similar tools can still be better for interactive RDF and visualization. Whichever tool is used, record:

- atom pair selections;
- frame range and stride;
- bin size and cutoff;
- periodic wrapping/unwrapping treatment;
- coordination-number integration limits if coordination is reported.

For non-orthogonal cells, verify that the chosen RDF tool handles the lattice correctly. If it does not, rebuild or transform the model before AIMD, or use a tool that correctly supports the cell geometry.

## Batch pattern

After one interactive run confirms the local menu sequence, store it in a small stdin file and use the wrapper script:

```bash
uv run __NEBULAMAT_AICC_ROOT__/tools/vaspkit/scripts/run_vaspkit_task.py 722 --cwd run-dir --stdin-file msd.inputs --log vaspkit.722.log
uv run __NEBULAMAT_AICC_ROOT__/tools/vaspkit/scripts/run_vaspkit_task.py 723 --cwd run-dir --stdin-file diffusion.inputs --log vaspkit.723.log
uv run __NEBULAMAT_AICC_ROOT__/tools/vaspkit/scripts/run_vaspkit_task.py 727 --cwd run-dir --stdin-file vacf.inputs --log vaspkit.727.log
uv run __NEBULAMAT_AICC_ROOT__/tools/vaspkit/scripts/run_vaspkit_task.py 728 --cwd run-dir --stdin-file vdos.inputs --log vaspkit.728.log
```

Stop the batch if one trajectory fails validation unless the run plan explicitly allows partial results.

## Provenance checklist

Save with every AIMD post-processing result:

- VASPKIT version and executable path;
- task ID and exact menu answers;
- source trajectory path and upstream VASP run settings;
- selected atoms/elements, frame cut, stride, timestep, and units;
- generated data files and any plotting/smoothing scripts;
- fit window and uncertainty or sensitivity test for diffusion/free-energy slopes.
