# OVITO Error Recovery

> Load this when: OVITO import, modifier execution, export, or rendering fails or produces suspicious output.

| Symptom | Likely cause | Fix |
|---|---|---|
| `ModuleNotFoundError: ovito` | OVITO Python module not installed in this interpreter | install in the active environment or run with `ovitos` |
| Import fails or reads zero particles | wrong format guessed, compressed file unsupported, malformed dump columns | specify format if needed; inspect header; convert with engine tools |
| LAMMPS dump types show as numbers only | no element/type mapping in source file | create a mapping in the script and record it |
| Cell looks wrong or atoms appear outside box | unwrap/wrap convention or missing image flags | apply wrap/unwrap modifiers deliberately; verify PBC flags |
| CNA/PTM classifies too many atoms as other | high temperature, surface atoms, wrong structure choice, cutoff issue | quench/snapshot appropriately, compare PTM vs CNA, inspect a known bulk frame |
| Coordination numbers too high/low | cutoff includes wrong shell or misses neighbors | use RDF first to choose cutoff |
| Wigner-Seitz defect count explodes | reference and deformed structures are not aligned or not topologically comparable | align/reference correctly; use only for compatible crystalline systems |
| Rendering fails on headless node | OpenGL/display backend issue | use `ovitos`/module on a node with rendering support, try offscreen renderer, or render locally from exported scene/data |
| Rendered image is blank | camera not aimed, pipeline not added to scene, frame empty | call `pipeline.add_to_scene()`, `viewport.zoom_all()`, and verify particle count |
| Colors do not match GUI | script lacks explicit color/type settings | set colors in script or export a GUI state as a script/template |

## Recovery rules

- Keep failing scripts and stderr in the run directory.
- For visual bugs, render a low-resolution QA image with the cell visible before adjusting aesthetics.
- For analysis bugs, reduce to one small frame and print particle count, cell, attributes, and modifier parameters.
