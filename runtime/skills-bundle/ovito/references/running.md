# Running OVITO

> Load this when: installing/checking OVITO Python, building an OVITO pipeline, rendering images, or analyzing atomistic structures and trajectories.

OVITO has two common operating modes: the desktop GUI for visual setup and the Python API for reproducible analysis. For agent-driven work, prefer scripts that can be rerun.

## Installation checks

Python module:

```bash
python -m pip show ovito
python - <<'PY'
import ovito
print(ovito.version_string)
PY
```

OVITO script interpreter, if installed with the application:

```bash
ovitos -c "import ovito; print(ovito.version_string)"
```

On headless Linux, rendering may need a compatible OpenGL/EGL/OSMesa setup depending on renderer and package. Start with analysis-only scripts before rendering.

## Basic pipeline

```python
from ovito.io import import_file, export_file
from ovito.modifiers import CommonNeighborAnalysisModifier

pipeline = import_file("dump.lammpstrj", multiple_frames=True)
pipeline.modifiers.append(CommonNeighborAnalysisModifier())
data = pipeline.compute(frame=0)
print(data.particles.count)
print(data.attributes)
export_file(pipeline, "selected.xyz", "xyz", columns=["Particle Identifier", "Particle Type", "Position.X", "Position.Y", "Position.Z"])
```

The pipeline is lazy: modifiers are applied when `compute()` or `export_file()` is called.

## Common analysis choices

| Goal | Modifier / pattern | Notes |
|---|---|---|
| classify FCC/BCC/HCP/ICO local structure | Common Neighbor Analysis or Polyhedral Template Matching | PTM is often more robust for thermally distorted crystals |
| coordination number / RDF | Coordination Analysis | choose cutoff/bin width based on chemistry and first-shell distance |
| point defects in crystals | Wigner-Seitz analysis | requires a reference configuration with matching lattice/site identity |
| dislocations | Dislocation Analysis (DXA) | best for crystalline systems with known structure type |
| surfaces / clusters | Construct Surface Mesh | probe radius and smoothing change quantitative areas |
| strain | Atomic Strain | requires reference frame/configuration; sensitive to cutoff |
| selections | Expression Selection, Select Type, Delete Selected | record expression and whether selected particles were deleted or exported |
| trajectory lines | Generate Trajectory Lines | useful for diffusion visualization; not a substitute for MSD analysis |

## Rendering pattern

```bash
# `uv run` resolves the inline ovito dep into an isolated, cached env — no global install.
uv run __NEBULAMAT_AICC_ROOT__/tools/ovito/scripts/ovito_render.py input.dump output.png --frame 0 --width 1600 --height 1200
```

For static structure figures, including CPK-filled views, ball-and-stick views, and ASE preview images, see `structure-rendering.md`.

For final figures:

- fix the frame number, camera/view direction, image size, background, colors, and particle radii
- render once with axes/cell visible for internal QA if the final figure hides them
- store the script and exact input file path

## Batch trajectory analysis

```bash
uv run __NEBULAMAT_AICC_ROOT__/tools/ovito/scripts/ovito_analyze.py dump.lammpstrj summary.json --modifier ptm --frames 0:100:10
```

Use coarse frame sampling first. Full trajectories can be expensive and should be run through scheduler-aware execution for large files.

## Data provenance

Record:

- OVITO version and whether the run used Python module, `ovitos`, or GUI.
- Input path, format, and frame range.
- Particle type to element mapping.
- PBC/cell handling and any unwrap/wrap operation.
- Modifier names and parameters.
- Exported files and whether data are per-frame or aggregated.
