# VASPKIT DOS, Band, PDOS, and d-Band Workflows

> Load this when: extracting DOS/PDOS, integrated DOS, band structures, projected bands, or d-band centers with VASPKIT. Pair this with `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/dos-band.md` for VASP setup and `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md` for scientific interpretation.

Task numbers can shift between VASPKIT releases. Confirm the local menu before automating and record version, task ID, menu answers, input files, and output files.

## DOS task map

| Goal | Common task ID | Main inputs | Typical outputs |
|---|---:|---|---|
| total DOS | 111 | `DOSCAR`, often `vasprun.xml`/`OUTCAR` | `TDOS.dat`, `ITDOS.dat` |
| selected-atom PDOS | 112 | `DOSCAR`, `POSCAR`, atom selection | `PDOS_A*.dat`, `IPDOS_A*.dat` |
| element PDOS | 113 | `DOSCAR`, `POSCAR` | `PDOS_<element>.dat`, `IPDOS_<element>.dat` |
| summed selected atoms | 114 | `DOSCAR`, `POSCAR`, atom range/list | `PDOS_SUM.dat`, `IPDOS_SUM.dat` |
| selected atoms and orbitals | 115 | `DOSCAR`, `POSCAR`, atom/element plus orbital selections | `PDOS_USER.dat` |
| d-band center | 503 | `DOSCAR`, `POSCAR`, `INCAR`/Fermi energy | `D_BAND_CENTER` |

Use task 115 when the chemical question needs orbital orientation, for example adsorbate sigma/pi components or metal `dxy/dxz/dz2` contributions. Use task 114 for a surface layer, active-site ensemble, or adsorbate fragment.

Common non-interactive patterns after confirming the menu locally:

```bash
printf '11\n111\n' | vaspkit > vaspkit.111.log 2>&1
printf '11\n113\n' | vaspkit > vaspkit.113.log 2>&1
printf '11\n114\n1-4 7 8\n' | vaspkit > vaspkit.114.log 2>&1
printf '11\n115\nO\np\nAl\np\n' | vaspkit > vaspkit.115.log 2>&1
```

The selected-atom input format is flexible in common VASPKIT versions, for example `C Fe H 1-4 7 8 24`, but record the exact selector used. If the installed version asks different prompts, prefer an interactive first run.

## Fermi-level shift

VASPKIT can shift DOS output so the Fermi level is zero. Check the local `~/.vaspkit` setting, commonly:

```text
SET_FERMI_ENERGY_ZERO .TRUE.
```

Even when the tool shifts automatically, record the original `E-fermi` from `OUTCAR` and the final plotting convention. For vacuum-aligned slab comparisons, a Fermi shift alone is not enough; use `LOCPOT`/work-function analysis.

## DOS output checks

- `TDOS.dat` is total DOS; `ITDOS.dat` is integrated total DOS.
- `IPDOS_*.dat` integrated PDOS is useful for qualitative consistency, but do not treat it as a rigorous atomic orbital occupation.
- For spin-polarized output, check whether VASPKIT has inverted spin-down values for plotting or kept both spin channels positive.
- PDOS files depend on `LORBIT` and projection conventions. With `LORBIT=11`, orbital components are more detailed than with `LORBIT=10`.
- If total DOS is smooth but PDOS looks odd, verify atom ordering, selected atom IDs, and whether equivalent atoms should be summed.

## Band and projected-band task map

| Goal | Common task family | Main inputs | Notes |
|---|---:|---|---|
| K-path generation | 3 | `POSCAR`/`CONTCAR` | use symmetry-appropriate path; inspect labels |
| semilocal DFT band structure | 21 | `EIGENVAL`, `KPOINTS`, `OUTCAR`, optional `PROCAR` | usually from non-SCF `ICHARG=11` line-mode run |
| 3D band structure | 23 | dense band data | specialized; record surface/plane and interpolation choices |
| hybrid DFT band structure | 25 | hybrid run with zero-weight path points | use the hybrid KPOINTS strategy in the VASP reference |
| projected/fat band | 21 submenus / PROCAR tasks | `PROCAR`, `EIGENVAL`, `KPOINTS` | record atom/orbital projection selections |
| Fermi surface | 26 | dense k-mesh eigenvalues | only meaningful for metals with adequate k sampling |
| band unfolding | 28 | supercell band data plus mapping | use for supercell-to-primitive spectral comparison |

For publication plots, check that the high-symmetry labels match the final cell, especially after converting conventional/primitive cells or making slabs/supercells.

## d-band center with task 503

VASPKIT task 503 can compute d-band centers for all atoms and total d states. It reads `DOSCAR`, Fermi energy, and structure information, then writes `D_BAND_CENTER`. It usually offers a default integration window and asks whether to change it.

Typical pattern:

```bash
printf '503\nn\n' | vaspkit > vaspkit.503.log 2>&1
```

Use `y` and define an explicit energy window when comparing a series that needs identical integration bounds. Keep that window, selected atoms, spin handling, and energy reference fixed across all systems.

Validation:

- Source DOS run used `LORBIT=11` and enough k-points for a smooth d-PDOS.
- Active-site/surface atoms are selected for the descriptor, not arbitrary bulk-like atoms.
- `NBANDS` and the DOS energy range include the unoccupied d states relevant to the chosen window.
- Trends are compared against adsorption energies, barriers, or another chemical observable.

## Adsorbate/surface PDOS extraction pattern

1. Identify atom IDs for the adsorbate, active metal atoms, nearby surface atoms, and a clean-surface reference layer.
2. Use task 112 for individual diagnostic atoms, 114 for fragments/layers, and 115 for orbital-resolved sums.
3. For molecules, map orbital labels to the actual molecule orientation before assigning sigma/pi components.
4. Plot clean surface, adsorbed surface, and isolated adsorbate references with a documented alignment.
5. Keep the same broadening, line style convention, spin convention, and energy window across related plots.

## Red flags

- `ISMEAR=-5` DOS attempted for a Gamma-only or too-small-k-point calculation.
- Using relaxation DOS directly instead of a final static DOS run.
- Increasing `NEDOS` to hide a k-point sampling problem.
- Interpreting PDOS sums as exact electron counts.
- Comparing adsorbate, slab, and adsorbed-system peak positions without energy alignment.
- Reporting d-band center without selected atom set, spin treatment, and integration window.
