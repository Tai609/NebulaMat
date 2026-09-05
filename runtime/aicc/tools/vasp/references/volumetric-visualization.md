# Volumetric Visualization for VASP Charge Data

> Load this when: rendering `CHGCAR`, `CHGDIFF`, `PARCHG`, `ELFCAR`, spin density, or other CHGCAR-like volumetric files from VASP in a reproducible headless workflow, especially when VESTA is useful interactively but the agent must generate figures from the command line.

This note records a command-line PyVista workflow for VASP volumetric data. It is meant for reproducible figure generation on Linux clusters or workstations where a GUI viewer such as VESTA may not be available. Use VESTA for interactive inspection and final manual tuning when needed; use PyVista when the agent must script the same operation, record exact parameters, and batch-render comparable systems. Common inputs include native VASP `CHGCAR`/`PARCHG`/`ELFCAR` files and VASPKIT-generated CHGCAR-like files.

## Tool choice

| Need | Preferred path | Notes |
|---|---|---|
| quick manual inspection of `CHGCAR`, `CHGDIFF`, `PARCHG`, `ELFCAR` | VESTA | Best interactive viewer; record isovalue, colors, cell choice, and view if the figure is used |
| headless 3D isosurface rendering | `pymatgen` + `pyvista` + VTK | Good for command-line screenshots, fixed camera, fixed isovalue, and batch comparison |
| 2D arbitrary-plane charge slice | `pymatgen` + `scipy.ndimage.map_coordinates` + Matplotlib | Useful for planes defined by chemically important atoms, e.g. metal-C-O |
| atomistic structure rendering only | OVITO or ASE | Load `__NEBULAMAT_AICC_ROOT__/tools/ovito/references/structure-rendering.md`; PyVista is mainly for volumetric fields |
| charge post-processing and planar averages | VASPKIT / VTST scripts | Use structured tools for density subtraction and planar averages, then visualize the resulting file |
| VASPKIT-generated volumetric outputs | `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/electronic-analysis.md`, then PyVista | Generate real-space wavefunction files, spin density, and charge-density differences with VASPKIT; this file covers rendering once the CHGCAR-like file exists |

Recommended isolated Python environment:

```bash
module load uv
uv venv .venv-vis
uv pip install --python .venv-vis/bin/python pymatgen pyvista vtk scipy matplotlib pillow
```

On headless machines, VTK may warn about a missing `DISPLAY` even when off-screen rendering succeeds. Treat that as a warning only if the PNG is written and a nonblank image check passes.

## Data assumptions and sign conventions

For charge-density difference plots, define and report the reference clearly:

```text
Delta rho = rho(combined) - rho(fragment A in combined geometry) - rho(fragment B in combined geometry)
```

Fragment calculations should keep the combined-system cell, retained-atom coordinates, grid, functional, ENCUT, k-mesh, smearing, spin policy, and static-run settings. Do not relax fragments if the plotted quantity is the standard adsorption/interface density rearrangement.

Always state the sign convention in the figure caption. A practical VESTA-like convention is:

```text
yellow = positive Delta rho / accumulation
cyan   = negative Delta rho / depletion
```

Use exactly equal positive and negative isosurface magnitudes unless there is a documented reason not to.

## Reading a CHGCAR-like file

`pymatgen.io.vasp.outputs.Chgcar` can read normal `CHGCAR`-format volumetric files, including many VASPKIT outputs. VASPKIT menu selection and automation belong in `__NEBULAMAT_AICC_ROOT__/tools/vaspkit/references/electronic-analysis.md`; this file starts after the CHGCAR-like output file exists. Common examples are:

- VASPKIT 511 wavefunction real-space files, such as `WFN_REAL_B0005_K0001.vasp`
- VASPKIT 312 spin-density output
- VASPKIT 314 charge-density-difference output, often named like `CHGDIFF.vasp`
- native or derived VASP `CHGCAR`, `PARCHG`, `ELFCAR`, and compatible spin-density files

For final-report figures, VASP volumetric sources (`CHGCAR`, `CHGDIFF`, `PARCHG`,
`ELFCAR`, spin density, wavefunction/WAVECAR-derived grids, and Delta rho / charge
density difference plots) must record this reference in the accepted figure artifact or
report manifest. Charge-density-difference figures should also record
`__NEBULAMAT_AICC_ROOT__/tools/vasp/references/electronic-analysis.md`. The plotting script may use
`pymatgen`, PyVista, Matplotlib, or VESTA-style parameters, but it should consume a
recorded CHGCAR-like source file and sidecar/provenance that names the source files,
source-generation route, sign/grid checks, and rendering parameters. If VASPKIT was
used, include the task ID, menu input, and log; VASPKIT is not required for every
volumetric figure.

Before scripting a full render, verify the file parses as CHGCAR-like data and that the contained structure/grid match the intended calculation.

```python
from pymatgen.io.vasp.outputs import Chgcar
import numpy as np

chg = Chgcar.from_file("CHGDIFF.vasp")
rho = np.asarray(chg.data["total"], dtype=float)
print("formula", chg.structure.composition.reduced_formula)
print("grid", rho.shape)
print("min/max", float(rho.min()), float(rho.max()))
print("percentiles", np.percentile(rho, [1, 5, 95, 99]))
```

Inspect the range before choosing an isovalue. Extreme values can occur close to PAW cores or at grid artifacts; do not set the visible scale blindly from the absolute min/max.

## 3D isosurface rendering with PyVista

Convert the regular VASP grid into a `pyvista.StructuredGrid` in Cartesian coordinates:

```python
import numpy as np
import pyvista as pv
from pymatgen.io.vasp.outputs import Chgcar

chg = Chgcar.from_file("CHGDIFF.vasp")
rho = np.asarray(chg.data["total"], dtype=float)
lattice = chg.structure.lattice.matrix

nx, ny, nz = rho.shape
ii, jj, kk = np.mgrid[0:nx, 0:ny, 0:nz]
frac = np.stack((ii / nx, jj / ny, kk / nz), axis=-1)
cart = frac @ lattice

grid = pv.StructuredGrid(cart[..., 0], cart[..., 1], cart[..., 2])
grid["rho"] = rho.ravel(order="F")

level = 3.0
positive = grid.contour([level], scalars="rho")
negative = grid.contour([-level], scalars="rho")
```

Use orthographic camera projection for slab/interface figures and manuscript-style comparison panels. Perspective views are attractive but make distances and lobe sizes harder to compare.

```python
plotter = pv.Plotter(off_screen=True, window_size=(1600, 1100))
plotter.set_background("white")
plotter.enable_parallel_projection()

plotter.add_mesh(
    positive,
    color="#ffff00",      # VESTA-like yellow, positive accumulation
    opacity=0.82,
    smooth_shading=True,
    ambient=0.55,
    diffuse=0.75,
    specular=0.35,
    specular_power=28.0,
    backface_culling=True,
)
plotter.add_mesh(
    negative,
    color="#00ffff",      # VESTA-like cyan, negative depletion
    opacity=0.82,
    smooth_shading=True,
    ambient=0.55,
    diffuse=0.75,
    specular=0.35,
    specular_power=28.0,
    backface_culling=True,
)

plotter.camera_position = "xz"   # or "xy" / "yz" for non-perspective views
plotter.camera.zoom(1.25)
plotter.show(screenshot="CHGDIFF_density_level3p0_xz.png")
```

Useful appearance knobs:

- increase `opacity` when the isosurface looks washed out
- increase `ambient` to brighten the whole surface under weak lighting
- add moderate `specular` and `specular_power` for a glossy highlight without turning the surface metallic
- keep the background white for SI/manuscript clarity
- use `backface_culling=True` to reduce muddy overlapping surfaces in dense regions
- keep window size fixed across compared systems

For atom colors, use stable element colors rather than PyVista defaults. A simple VESTA/Jmol-like starting point is `Ni` green, `O` red, `C` dark gray, `H` white. Keep atom radii modest so they locate the structure without hiding the charge lobes.

## Choosing the isovalue

The isovalue is a figure parameter and must be reported. Good selection is data- and claim-dependent:

- start from percentiles such as the 95th to 99th percentile of `abs(Delta rho)` or from a chemically conventional value used in related figures
- increase the value when weak haze hides the chemically important lobes
- decrease the value when only tiny core-near artifacts remain
- use the same absolute value for positive and negative surfaces
- use the same value across a comparison series unless there is a stated reason not to

In one Ni-CO `CHGDIFF.vasp` test case, `+/-1.5` produced visible but diffuse lobes, while `+/-3.0` gave clearer surfaces. The exact value is not transferable; the transferable rule is to inspect the distribution and record the chosen threshold.

## 2D slice through three atoms

A 2D slice is often more interpretable than a 3D isosurface for adsorption bonds, especially when the plane passes through the surface atom and adsorbate atoms. Use 1-based atom indices from POSCAR/VASP convention when communicating with users.

For atoms `i`, `j`, and `k`, define a plane through their Cartesian coordinates:

```python
import numpy as np

points = np.array([structure[i - 1].coords, structure[j - 1].coords, structure[k - 1].coords])
origin = points.mean(axis=0)

u = points[1] - points[0]
u = u / np.linalg.norm(u)

v = points[2] - points[0]
v = v - np.dot(v, u) * u
v = v / np.linalg.norm(v)

normal = np.cross(u, v)
normal = normal / np.linalg.norm(normal)
```

Sample the VASP density on the plane with wrapped fractional coordinates. Linear interpolation is usually enough for visualization; cubic interpolation can introduce ringing near sharp core features.

```python
from scipy.ndimage import map_coordinates

x = np.linspace(xmin, xmax, 900)
y = np.linspace(ymin, ymax, 900)
xx, yy = np.meshgrid(x, y)
cart = origin + xx[..., None] * u + yy[..., None] * v
frac = cart @ np.linalg.inv(lattice)

dims = np.array(rho.shape, dtype=float)
coords = [(frac[..., axis] % 1.0) * dims[axis] for axis in range(3)]
slice_values = map_coordinates(rho, coords, order=1, mode="wrap")
```

Plot with a symmetric diverging color scale and label atoms close to the plane:

```python
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

vmax = 8.0
cmap = LinearSegmentedColormap.from_list("vesta_diff", ["#00ffff", "#ffffff", "#ffff00"], N=256)

fig, ax = plt.subplots(figsize=(7.2, 7.2), dpi=250)
im = ax.imshow(
    slice_values,
    origin="lower",
    extent=(x[0], x[-1], y[0], y[-1]),
    cmap=cmap,
    vmin=-vmax,
    vmax=vmax,
    interpolation="bicubic",
    aspect="equal",
)
ax.contour(x, y, slice_values, levels=np.linspace(-vmax, vmax, 21), colors="#303030", linewidths=0.35, alpha=0.42)
fig.colorbar(im, ax=ax, shrink=0.82, pad=0.03)
fig.savefig("CHGDIFF_slice_atoms_21_25_26.png", facecolor="white")
```

When the plane passes through a metal atom, core-near values can dominate the raw range. Automatic percentile scaling can still be too wide. Manually clip the displayed color scale with `vmax` when the scientific target is the bonding region rather than the atom core. Record the displayed `vmax`; color clipping is acceptable for visualization only when it is disclosed.

## Image validation

Every automated render needs a nonblank check before reporting success:

```python
from PIL import Image, ImageStat

image = Image.open("CHGDIFF_density_level3p0_xz.png").convert("RGB")
print(image.size)
print(ImageStat.Stat(image).extrema)
```

A white image with extrema `(255, 255)` for all channels is blank. A nonblank pixel range confirms only that something rendered; still inspect the image for framing, overlap, color choice, and whether the intended atoms/surfaces are visible.

For headless VTK runs, warnings like `bad X server connection. DISPLAY=` may appear. If the screenshot exists and the pixel check is nonblank, record the warning but do not treat it as a failure.

## Reporting checklist

For every volumetric figure, record:

- source file path and how it was produced (`CHGCAR`, `PARCHG`, `ELFCAR`, VASPKIT 511 `WFN_REAL_Bxxxx_Kxxxx.vasp`, VASPKIT 312 spin density, VASPKIT 314 `CHGDIFF.vasp`, etc.)
- density definition and sign convention
- isosurface value or 2D slice color limit
- colors for positive/negative density
- camera/view and whether projection was orthographic
- atom indices used to define any 2D plane
- interpolation method and color clipping for 2D slices
- script path, Python environment, and relevant package versions
- image size and confirmation that the render is nonblank

Do not infer charge transfer magnitude from an isosurface or a clipped 2D colormap. Use these figures to show spatial accumulation/depletion, then pair them with Bader/DDEC, PDOS, work-function shifts, spin density, or COHP depending on the claim.
