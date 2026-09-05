# Structure Rendering

> Load this when: making static atomistic figures from POSCAR/CONTCAR/CIF/XYZ/trajectory frames, especially CPK-filled views, ball-and-stick views, or quick ASE comparison renders.

This note covers reproducible static structure figures on Linux, including headless runs. Prefer OVITO Python when the figure needs explicit visual style control, bonds, particle type colors, trajectory frames, or a renderer such as Tachyon. ASE's built-in image writer is useful for quick side/top/isometric previews and cross-checking whether the camera/view is sensible.

## Choose the rendering path

| Need | Recommended path | Notes |
|---|---|---|
| quick structure preview | ASE PNG writer | Fast and simple; good for side/top/isometric checks before spending time on styling |
| filled atomic spheres / CPK-like figure | OVITO Python, no bond modifier | Keep type radii at OVITO defaults unless a smaller visual radius is needed |
| ball-and-stick structure figure | OVITO Python + `CreateBondsModifier` | Set pairwise cutoffs, shrink particle type radii, and use particle-colored bonds |
| trajectory frame or animation | OVITO Python | Fix frame, camera, renderer, image size, and modifier parameters |
| ray-traced publication-style image | OVITO Tachyon or ASE -> POV-Ray | OVITO Tachyon is usually easier to automate; ASE -> POV-Ray may need camera and `.ini` cleanup |

Do not commit rendered figures unless they are deliberately small, verified examples. For normal work, record the script, input path, OVITO/ASE versions, view, style parameters, and output path.

## Headless checks

Check the Python packages and OVITO version:

```bash
python - <<'PY'
import ovito
import ase
print("ovito", ovito.version_string)
print("ase", ase.__version__)
PY
```

For headless rendering, a GUI display is not required when OVITO's Tachyon renderer works:

```python
from ovito.vis import TachyonRenderer, Viewport
```

If importing OVITO in a conda environment emits a PyPI/Qt warning but headless rendering succeeds, record the warning in local notes. If rendering later fails with Qt/OpenGL errors, reinstall OVITO using the package source recommended by the official OVITO installation page.

## OVITO CPK-filled view

Use this for a compact, filled-sphere structure figure. It is often the first useful OVITO render for a slab or cluster.

```python
import warnings
warnings.filterwarnings("ignore", message=".*OVITO.*PyPI")

from ovito.io import import_file
from ovito.vis import TachyonRenderer, Viewport

pipeline = import_file("CONTCAR")
pipeline.add_to_scene()

viewport = Viewport(type=Viewport.Type.Front)
viewport.zoom_all()
viewport.render_image(
    filename="structure_cpk_front.png",
    size=(1200, 850),
    renderer=TachyonRenderer(),
)
```

Use `Viewport.Type.Top`, `Viewport.Type.Front`, and `Viewport.Type.Perspective` for quick alternatives. For final figures, save exactly which view was used.

## OVITO ball-and-stick view

Ball-and-stick figures require bonds. For chemical systems, prefer pairwise cutoffs over one global cutoff; a single global cutoff can create unphysical bonds in multi-element slabs or clusters.

```python
import warnings
warnings.filterwarnings("ignore", message=".*OVITO.*PyPI")

from ovito.io import import_file
from ovito.modifiers import CreateBondsModifier
from ovito.vis import TachyonRenderer, Viewport

pipeline = import_file("CONTCAR")

# OVITO uses per-particle-type radii when they exist. Mutate the type radii
# directly; changing particles.vis.radius alone may not affect the render.
ptype_prop = pipeline.source.data.particles_.particle_types_
for particle_type in ptype_prop.types:
    mutable_type = ptype_prop.make_mutable(particle_type)
    if mutable_type.name == "O":
        mutable_type.radius = 0.22
    elif mutable_type.name in {"Ti", "Pt"}:
        mutable_type.radius = 0.32 if mutable_type.name == "Ti" else 0.36

bonds = CreateBondsModifier(mode=CreateBondsModifier.Mode.Pairwise)
bonds.set_pairwise_cutoff("Ti", "O", 2.25)
bonds.set_pairwise_cutoff("Pt", "O", 2.45)

# OVITO can color a bond by its endpoint particles. Leave this enabled for
# two-color bonds instead of forcing all bonds to one color.
bonds.vis.width = 0.14
bonds.vis.use_particle_colors = True
bonds.vis.coloring_mode = bonds.vis.ColoringMode.ByParticle

pipeline.modifiers.append(bonds)
data = pipeline.compute()
print("atoms", data.particles.count)
print("bonds", data.particles.bonds.count if data.particles.bonds else 0)

pipeline.add_to_scene()
viewport = Viewport(type=Viewport.Type.Front)
viewport.zoom_all()
viewport.render_image(
    filename="structure_ballstick_front.png",
    size=(1200, 850),
    renderer=TachyonRenderer(),
)
```

Tune radii and bond widths together:

- if bonds disappear behind atoms, shrink the per-type radii first
- if atoms look too small, increase type radii and reduce bond width slightly
- if the figure is too dense, remove same-metal or long metal-metal cutoffs unless those bonds are chemically meaningful
- if colored bonds become single-color, check that `use_particle_colors=True` and `coloring_mode=ColoringMode.ByParticle`
- if two species render in near-identical default colors (common for a supported metal vs. the substrate cation — e.g. both grey), override the per-type color so the active species stands out

Always report the pairwise cutoffs used to create bonds. They are figure parameters, not proof of bonding.

## Model figures for a report: orthographic top + side, atoms colored by a property

The default for a model figure handed to humans (see `__NEBULAMAT_AICC_ROOT__/tools/report` and `__NEBULAMAT_AICC_ROOT__/knowledge/scientific-visualization.md`): use the **relaxed final structure** and render an **orthographic top + side pair**, never perspective. For VASP relaxation products, render from `CONTCAR` rather than the input `POSCAR`. Use `POSCAR` only when it is explicitly a copy of the final `CONTCAR`, or when a non-VASP workflow has an equivalent final structure file with recorded provenance. The `scripts/ovito_render.py` helper takes the view and projection directly:

```bash
# orthographic top and side views of the same relaxed model
uv run scripts/ovito_render.py CONTCAR fig_top.png  --view top
uv run scripts/ovito_render.py CONTCAR fig_side.png --view side
```

`--view top|bottom|front|back|left|right|side` are all orthographic standard cameras (`side` = front, so a slab's layers stack vertically); `--view iso` is an orthographic isometric; `--projection perspective` (or `--view perspective`) is the only way to get a perspective camera, and is opt-in.

For report figures, assemble the top and side renders into a single left-to-right
two-panel image with panel labels, not two separate figures:

```text
left: (a) orthographic top view    right: (b) zoomed orthographic side view
```

The side view should usually be zoomed or cropped to the slab, adsorbate, and active
site; crop out empty vacuum for ordinary model figures. Empty vacuum often dominates a
side view while adding no information. Keep the full vacuum/cell height only when the
figure is about vacuum spacing, dipole correction, work-function plateaus, or
periodic-boundary geometry. Record any crop/zoom operation with the figure provenance,
and do not crop away periodic images or artifacts that are relevant to the claim.

**Show a per-atom quantity on the structure** (the recurring "show Bader charge on the atoms" request) by coloring atoms by a particle property and adding a colorbar:

```bash
# charges.xyz = extended XYZ whose header carries a per-atom column named Charge
uv run scripts/ovito_render.py charges.xyz fig_side.png --view side --color-by Charge --ball-stick
# label the decisive atoms (element + value) directly on the image:
uv run scripts/ovito_render.py charges.xyz fig_side.png --view side --color-by Charge \
    --ball-stick --label-elems Fe,O --color-range -1.5 1.5
```

The property must already be in the file (an extra named column in an extended XYZ, or a dump field). Attach Bader charges by writing them as that column (e.g. with ASE/pymatgen after parsing `ACF.dat`).

**Charge maps default to a diverging red-white-blue scale** in `ovito_render.py` (red = positive, white = 0, blue = negative) with a symmetric range about 0, so the *sign* is read directly — far clearer than a sequential map (viridis) for signed charge. The script also draws the **value next to the decisive atoms** via `--label-elems` (a `PythonViewportOverlay` projecting each atom to the image and drawing `"El +q"`), so the reader sees which sphere is which element and its charge — color+colorbar carries the gradient, the per-atom label carries the key value. Always state the colorbar property and range in the caption; a charge color map is not proof of charge transfer (`__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md`).

**Present a charge map as a pair: the red-white-blue charge map AND a same-view plain element-colored render beside it.** Once atoms are recolored by charge their element identity is hidden, so pass `--paired-plain` to also emit a companion render of the *same* view, projection, ball-stick setting, and `--label-elems` labels but with normal element colors and no colorbar (the companion path is the output with `_plain` before the extension, e.g. `q_side.png` -> `q_side_plain.png`). Place the two side by side in the figure with panel labels so the reader can map each charge color back to the actual atom. Prefer `(a)` plain element colors and `(b)` charge/property colors unless a project-specific caption makes the reverse order unambiguous:

```bash
uv run scripts/ovito_render.py charges.xyz q_side.png --view side --color-by Charge \
    --ball-stick --label-elems Fe,O --paired-plain   # also writes q_side_plain.png
```

Report-ready charge panel:

```text
(a) same-view plain element-colored render    (b) Bader-charge-colored render
```

The caption should state the property, colorbar range, units/sign convention, and which
atoms are labeled. The plain panel and the charge panel must use the same camera,
projection, ball-stick setting, crop/zoom, and atom labels.

## ASE quick side/top/isometric preview

ASE's PNG writer is a good lightweight check before final OVITO styling. For VASP
relaxation outputs, preview `CONTCAR`; use `POSCAR` only for input/model-review
previews or when it is a documented copy of `CONTCAR`.

```python
from ase.io import read, write

atoms = read("CONTCAR")

write(
    "structure_side.png",
    atoms,
    rotation="90x,0y,0z",
    show_unit_cell=2,
    radii=0.55,
    scale=80,
)

write(
    "structure_top.png",
    atoms,
    rotation="0x,0y,0z",
    show_unit_cell=2,
    radii=0.55,
    scale=80,
)

write(
    "structure_iso.png",
    atoms,
    rotation="60x,0y,35z",
    show_unit_cell=2,
    radii=0.55,
    scale=80,
)
```

ASE previews are especially useful for slab orientation. If the ASE side view and OVITO front view disagree about what is visible, inspect the cell axes and chosen viewport before using either figure.

## Image sanity checks

Programmatic image existence is not enough; a render can complete and still be visually blank or misframed. At minimum, check file size and color range:

```python
from PIL import Image, ImageStat

image = Image.open("structure_ballstick_front.png").convert("RGB")
print(image.size, ImageStat.Stat(image).extrema)
```

An extrema range of `(255, 255)` for all RGB channels usually means a blank white image. A nonblank range does not guarantee a good figure; still inspect the image before reporting or committing it as an example.

## ASE -> POV-Ray caveats

ASE can write POV-Ray scenes, but the path is less robust than OVITO Tachyon in automated headless use. Known issues to check:

- the generated `.ini` may contain floating-point `Width=` or `Height=` values; POV-Ray expects integers
- the generated camera may need an explicit viewing angle
- rendering can finish successfully while the object is outside the camera frame

Use ASE -> POV-Ray only when the wrapper script verifies the final PNG is nonblank and visually framed. For routine structure figures, prefer OVITO Tachyon or ASE's direct PNG writer.
