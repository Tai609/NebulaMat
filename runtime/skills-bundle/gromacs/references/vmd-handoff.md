# GROMACS-to-VMD Handoff and Tcl Analysis

> Load this when: viewing GROMACS structures/trajectories in VMD or writing small Tcl analyses around atom selections and `measure`.

VMD is an inspection, visualization and scripting environment. It does not validate a GROMACS topology or replace recorded GROMACS analysis commands.

## Load structure first

Load the `.gro`/`.pdb`/`.tpr`-readable structure as a molecule, then load `.xtc` or `.trr` data into the same molecule. Do not load the trajectory as an unrelated new molecule.

## Unit trap

GROMACS native lengths are nm; VMD distances are normally angstrom.

```text
0.35 nm in GROMACS = 3.5 Å in VMD
1.0 nm cutoff = 10 Å in VMD selection distance
```

Never paste a GROMACS nm threshold into `within` without converting.

## Selections

Common predicates include `protein`, `water`, `nucleic`, `resname`, `resid`, `name`, `element`, `chain`, `segname`, `within`, and `same residue as`. `within` selects atoms; wrap with `same residue as` when complete water or residue membership is needed.

Example selections:

```tcl
atomselect top "protein"
atomselect top "resname LIG"
atomselect top "same residue as (water and within 3.5 of resname LIG)"
```

## Dynamic selections

Distance-dependent selections must be set to the desired frame and updated on every frame. Without an update, a `within` selection remains the atom set chosen on its original frame. Delete selections created in loops to avoid memory growth.

## Useful `measure` operations

- `measure center` for center of geometry or mass.
- `measure fit` to build a best-fit transform.
- `measure rmsd` for corresponding atom selections; atom count and order must match.
- `measure hbonds 3.5 30 ...` for VMD-style hydrogen-bond detection in angstrom/degrees.
- `measure sasa 1.4 ...` for SASA with a 1.4 Å probe.
- `measure contacts 5.0 ...` for pair contacts.

For trajectory fitting, set every selection to the same frame and update as needed.

## PBC with pbctools

`pbc unwrap` is appropriate for continuity; wrapping and centering are appropriate for viewing. PBC operations require correct box data and molecular connectivity. Prefer `gmx trjconv` for reproducible file-based preprocessing when the result feeds quantitative analysis, and use pbctools for interactive inspection or explicitly scripted workflows.

## Bond display is not topology

Distance-based bond guessing can draw bonds across PBC or between close nonbonded atoms. Bond display edits are not evidence of chemical connectivity. Trust the parameterized topology and inspect guessed bonds critically.

## Rendering and saved coordinates

Representations and coloring change display only. A publication figure should record selected atoms/frames, representation, colors, camera/projection, PBC copies and clipping. Saving coordinates writes the in-memory coordinates, including any fit/move/PBC edits; never overwrite raw structures.
