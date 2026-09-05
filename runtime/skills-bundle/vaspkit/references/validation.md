# VASPKIT Validation

> Load this when: checking whether a VASPKIT task was ready to run or whether generated outputs can be used in a report, figure, or downstream calculation.

## Preflight

Run:

```bash
uv run __NEBULAMAT_AICC_ROOT__/tools/vaspkit/scripts/check_vaspkit.py RUNDIR
```

Minimum pass criteria:

- `vaspkit` executable is found, or the run record states the absolute executable path.
- `~/.vaspkit` exists for tasks that need pseudopotentials, plotting, or utilities.
- Required VASP inputs/outputs for the task family exist and are non-empty.
- Upstream VASP calculation has been validated by `__NEBULAMAT_AICC_ROOT__/tools/vasp/scripts/parse_vasp.py` if the task uses final energies, eigenvalues, charge density, forces, stress, or trajectories.

## Output validation by task

| Task family | Checks |
|---|---|
| KPOINTS | mesh matches dimensionality; slabs have 1 point along vacuum; generated density is not a smoke-test mesh used as production |
| POTCAR | POSCAR species order matches POTCAR order; functional/potential mapping matches run plan; never commit POTCAR |
| band path | labels match lattice symmetry after any cell transformation; number of points is adequate for plot smoothness |
| DOS/PDOS | DOSCAR/vasprun.xml from converged static run; smearing/tetrahedron method appropriate; energy zero, spin convention, and atom/orbital selections documented |
| projected bands | PROCAR/LORBIT settings support requested projection; atom/orbital selections and high-symmetry labels recorded |
| d-band center | source d-PDOS is smooth; selected atoms, spin treatment, integration window, and energy reference are recorded |
| work function | slab is oriented correctly; vacuum plateau exists; dipole correction status recorded |
| charge difference | all CHGCAR files share identical cell, grid, atom ordering convention, and reference states |
| Bader charge coloring | Bader analysis used all-electron reference when discussing charge states; plotted charge definition and color scale are recorded |
| real-space wavefunction / partial charge | band, k-point, spin channel, energy reference, and degeneracy handling are recorded; source WAVECAR comes from a converged run |
| EOS/elastic | input calculations share functional/ENCUT/k-policy; fit residuals and strain range recorded |
| MD analysis | trajectory length, timestep, thermostat/barostat, equilibration cut, frame stride, atom selection, dimensionality, and fit/integration window are recorded; MSD is fitted only in the diffusive regime; VACF/VDOS uses correct timestep |
| thermochemistry | frequency job complete; fixed/free atoms verified; units and standard states recorded; gas pressure correction formula stated |

## Provenance record

For every VASPKIT-derived result, save:

- VASPKIT version and executable path.
- Task ID plus all menu answers.
- Input file list with source calculation directory.
- Generated file names and timestamps.
- Energy zero, units, and alignment method for plots.
- Any manual edits made after VASPKIT output generation.

## Red flags

- Output file exists but has zero size or only headers.
- AIMD MSD is fit through the early ballistic region or through too few hopping events.
- VACF/VDOS frequency axis uses the wrong timestep because `POTIM`, `NBLOCK`, or frame stride was not tracked.
- Band/DOS plot uses a default Fermi-level shift but the manuscript claims band edges versus vacuum.
- Work-function plateau is not flat across a reasonable vacuum region.
- Charge-density difference mixes relaxed and unrelaxed structures without explaining the reference.
- Generated KPOINTS or POTCAR silently overwrote hand-curated input files.
