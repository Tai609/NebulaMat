# CP2K Low-Dimensional Electrostatics

> Load this when: setting up molecules in boxes, slabs, 2D/1D periodic systems, charged cells, vacuum convergence, dipole corrections, work functions, planar electrostatic profiles, or SCCS calculations where `&CELL`, `PERIODIC`, and `&POISSON` choices matter.

## Why this matters

Periodic DFT always solves an electrostatics problem. For bulk crystals the natural model is 3D periodic; for molecules, slabs, 2D layers, charged defects, and interfaces, the wrong Poisson/PBC choice can create image interactions, artificial electric fields, wrong work functions, or meaningless charged-cell energies.

## Coordinate and periodicity policy

Keep these sections consistent:

- `&SUBSYS/&CELL PERIODIC ...` controls structural periodicity.
- `&DFT/&POISSON PERIODIC ...` controls the electrostatic boundary condition.
- k-points must only sample periodic directions.
- Vacuum directions should not be relaxed during ordinary structure optimization.

Typical choices:

| Model | Structural periodicity | Electrostatics policy | k-point policy |
|---|---|---|---|
| bulk crystal | `XYZ` | 3D periodic | 3D mesh |
| molecule/cluster in a box | `NONE` | nonperiodic solver such as MT/WAVELET/MULTIPOLE when supported | Gamma only |
| slab / interface with vacuum normal to z | `XY` or fixed 3D cell with physical slab convention | 2D/slab-aware policy or documented 3D-periodic vacuum approximation | in-plane only |
| 2D material | `XY` | 2D/slab-aware policy; converge vacuum | in-plane only |
| 1D wire/polymer | one periodic direction | 1D-aware policy; converge transverse vacuum | along wire only |
| charged periodic model | explicit correction/countercharge/solvation convention | never raw default electrostatics without a correction statement | property-dependent |

Always verify exact solver keywords for the installed CP2K version. POISSON options have version-dependent availability and limitations.

## Molecules and clusters

Template shape:

```text
&SUBSYS
  &CELL
    ABC 20.0 20.0 20.0      # adjust
    PERIODIC NONE
  &END CELL
&END SUBSYS
&DFT
  &POISSON
    PERIODIC NONE
    POISSON_SOLVER MT        # or version-supported nonperiodic solver
  &END POISSON
&END DFT
```

Rules:

- Increase the box until energy, dipole, frontier orbitals, and charge/spin density are stable for the property.
- A molecule in a too-small box can converge numerically while still showing image-interaction artifacts.
- Charged molecules need extra care: cell-size and solver convergence are stronger than for neutral molecules.
- Do not use `ANALYTIC` as the default molecule-in-a-box recommendation. Prefer `MT` or `WAVELET` for ordinary 0D nonperiodic boxes, or `MULTIPOLE` when its charge-fitting approximation is appropriate and validated.

## Slabs and 2D systems

Conservative workflow:

1. Build the slab/layer with enough vacuum.
2. Keep the vacuum direction fixed during relaxation.
3. Use k-points only in the periodic plane.
4. Converge slab thickness, vacuum, and electrostatic solver/dipole policy for the target observable.
5. For work functions or band alignment, generate and inspect a planar-average Hartree/electrostatic potential.

Guardrails:

- Do not let `CELL_OPT` optimize the vacuum direction unless the physical problem is pressure/cell response in that direction.
- Dipole correction is a property-specific choice, not a default relaxation setting.
- For asymmetric slabs, the two vacuum plateaus can differ. Report which side is used.
- If 3D periodic electrostatics plus large vacuum is used as an approximation, state it and converge vacuum thickness.

## Dipole correction and surface potential

CP2K versions expose slab dipole corrections through version-specific keywords around surface dipole correction and dipole direction/position. Use them only after verifying the installed manual.

Operational rules:

- Apply a dipole correction only in the nonperiodic/slab-normal direction.
- Keep the slab centered or define the dipole position deliberately.
- Converge vacuum after enabling a dipole correction; the required vacuum can change.
- Do not mix dipole-corrected and uncorrected slab energies in one adsorption or surface-energy expression unless the thermodynamic cycle explicitly defines that.

## Work function

```text
W = V_vacuum - E_F
```

Required evidence:

- a converged slab calculation;
- `V_HARTREE_CUBE` or an equivalent electrostatic-potential output;
- planar average along the slab normal;
- clear vacuum plateau;
- stated Fermi-level source and smearing status;
- documented dipole/electrostatic boundary condition.

For insulators/semiconductors, also state whether the zero is Fermi level, midgap, VBM/CBM, or a reference electrode convention.

## Charged periodic systems

Do not report raw charged-cell energies without a correction model. Decide up front:

- background charge convention;
- Makov-Payne-like or other finite-size correction when appropriate;
- potential alignment/reference convention;
- implicit-solvent/SCCS or explicit counterion model if relevant;
- supercell-size convergence.

Charged defects, polarons, solvated ions, and charged slabs are scientific models, not just `CHARGE` keywords.

## SCCS and implicit solvent interaction

SCCS introduces a continuum electrostatic boundary/cavity model. When using SCCS:

- load `sccs-solvation.md`;
- keep cell, Poisson, charge, and cavity parameters explicit;
- compare vacuum and solution only through a written thermodynamic cycle;
- do not assume the same vacuum-size convergence behavior as a non-SCCS calculation.

## Validation checklist

- `CELL PERIODIC`, `POISSON PERIODIC`, and k-point directions agree with the model.
- Vacuum thickness is converged for the target property.
- Any dipole correction is documented and used consistently.
- Work-function plots have a genuine vacuum plateau.
- Charged-cell correction/reference convention is written before comparing energies.
- Final figures show the periodic cell and vacuum direction clearly.
