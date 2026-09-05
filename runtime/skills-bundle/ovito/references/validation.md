# OVITO Validation

> Load this when: deciding whether an OVITO image, animation, or quantitative output is trustworthy enough for reporting.

## Import validation

- Particle count matches the source engine output for the selected frame.
- Cell vectors and periodic boundary flags are correct.
- Species/type mapping is explicit; numeric LAMMPS types are not left ambiguous.
- Units are known: A vs nm, ps vs fs, reduced units, or engine-specific units.
- Trajectory frame count and frame index match the requested time range.

## Modifier validation

| Analysis | Checks |
|---|---|
| CNA/PTM | counts are plausible for known reference structures; thermal disorder and surfaces are expected to create "other" atoms |
| coordination/RDF | cutoff/binning justified by first-shell distances; finite-size and PBC effects considered |
| Wigner-Seitz defects | reference configuration has same topology/site identity; deformation is not so large that sites are mismatched |
| DXA | crystal structure type is correct; surface atoms and grain boundaries are interpreted cautiously |
| surface mesh | probe radius, smoothing, and periodicity documented; area/volume units checked |
| atomic strain | reference frame and cutoff recorded; remove global rotation/translation if needed |

## Rendering validation

- Image is nonblank and not clipped.
- Static report figures use the relaxed final structure. For VASP relaxations, this
  means `CONTCAR`; a `POSCAR` source must be documented as a copy of the final
  `CONTCAR` or as an intentional pre-relaxation/model-review figure.
- Camera direction shows the relevant feature without hiding periodic artifacts.
- Cell axes or scale bar were checked during QA, even if hidden in final figure.
- Colors have a documented mapping to element/type/structure property.
- Figure caption can state source frame, modifiers, and rendering script.
- Report model figures assemble orthographic top and side views into one left-to-right
  `(a)`/`(b)` panel, with top view on the left and side view on the right. The side
  view is zoomed/cropped to the chemically relevant region, with vacuum cropped out,
  unless the full vacuum/cell height is part of the claim.
- Property-colored figures, including Bader-charge maps, include a same-view plain
  element-colored companion panel with matching camera/projection/crop so element
  identity remains clear after recoloring.

## Quantitative output validation

- Exported JSON/table includes frame number and particle count.
- For per-frame metrics, sample at least first, middle, and last frame before full batch.
- Compare one small case with GUI inspection or an independent parser when the number supports a manuscript claim.
- Do not average across unequilibrated frames unless the equilibration cut is documented.
