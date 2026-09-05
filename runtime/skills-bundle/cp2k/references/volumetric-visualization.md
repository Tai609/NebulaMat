# CP2K Volumetric Visualization and Cube Workflows

> Load this when: rendering CP2K electron-density, spin-density, MO, ELF, electrostatic-potential, charge-density-difference, or Molden/Multiwfn outputs in a reproducible workflow.

This mirrors the VASP volumetric-rendering reference but uses CP2K-native outputs: `.cube`, `.molden`, `.pdos`, `.bs`, `.restart`, and `.wfn` provenance. Use GUI tools for exploration, but preserve enough settings to regenerate the same figure without manual clicks.

## Tool choice

| Need | Preferred path | Notes |
|---|---|---|
| quick cube inspection | VESTA or VMD | Good for checking sign, cell, periodic images, and isovalue before scripting |
| reproducible 3D isosurfaces | ASE cube reader + PyVista | Good for headless screenshots and batch figures |
| 2D slices through atoms/interfaces | ASE/pymatgen + scipy interpolation + Matplotlib | Use for bond planes, interface planes, and slab-normal slices |
| orbital/population/bonding analysis from Molden | Multiwfn | CP2K Molden may need `[Cell]` and pseudopotential-valence metadata |
| density arithmetic / planar averages | cubecruncher, Multiwfn, or a recorded Python script | Use identical grids and cells for all cube operands |
| trajectories and NEB images | VMD or OVITO | VMD is strong for CP2K XYZ/DCD/PDB-style outputs and movies |

## Generating CP2K fields

Check the installed CP2K manual for exact print-section paths. Common patterns are:

```text
&DFT
  &PRINT
    &E_DENSITY_CUBE
      STRIDE 1 1 1
    &END E_DENSITY_CUBE
    &V_HARTREE_CUBE
      STRIDE 1 1 1
    &END V_HARTREE_CUBE
    &MO_CUBES
      NHOMO 2
      NLUMO 2
      WRITE_CUBE T
    &END MO_CUBES
    &ELF_CUBE
      STRIDE 1 1 1
    &END ELF_CUBE
  &END PRINT
&END DFT
```

Guardrails:

- Cube print sections can produce large files. Use `STRIDE` or selected MO windows for exploration; rerun full-resolution only when the figure needs it.
- Orbitals have arbitrary phase. Do not compare the sign/color of an MO lobe across separate runs unless phase was aligned deliberately.
- For spin density, state the sign convention, usually `rho_alpha - rho_beta`.
- For electrostatic potential/work-function analysis, use the same cell, slab orientation, Poisson treatment, and dipole-correction status as the static run.

## Charge-density difference

Use the standard definition:

```text
Delta rho = rho(combined) - rho(fragment A in combined geometry) - rho(fragment B in combined geometry)
```

All component calculations must share the combined system's cell, grid, functional, basis/potential family, k-policy, smearing, charge/spin policy, and frozen geometry. Do not relax fragments for a standard adsorption/interface density rearrangement plot.

For a slab/adsorbate case, use the same slab cell for:

1. adsorbed slab;
2. clean slab with adsorbate atoms removed;
3. adsorbate in the adsorbed geometry with slab atoms removed.

State the isosurface convention in the caption, e.g. `positive = accumulation`, `negative = depletion`. Use equal positive and negative magnitudes unless a specific asymmetry is documented.

## Reading a cube file

Recommended isolated environment:

```bash
module load uv
uv venv .venv-vis
uv pip install --python .venv-vis/bin/python ase pyvista vtk scipy matplotlib pillow numpy
```

Basic parser check:

```python
from ase.io.cube import read_cube_data
import numpy as np

rho, atoms = read_cube_data("density.cube")
print("formula", atoms.get_chemical_formula())
print("cell", atoms.cell.array)
print("grid", rho.shape)
print("min/max", float(np.nanmin(rho)), float(np.nanmax(rho)))
print("percentiles", np.percentile(rho, [1, 5, 50, 95, 99]))
```

Inspect the range before choosing an isovalue. Density values near nuclei or pseudopotential cores can dominate the absolute min/max and hide the chemically relevant region.

## 3D isosurface rendering with PyVista

Convert the cube grid to Cartesian coordinates. For orthorhombic and many slab cells this is straightforward; for skewed cells, keep the full lattice transformation.

```python
import numpy as np
import pyvista as pv
from ase.io.cube import read_cube_data

rho, atoms = read_cube_data("chgdiff.cube")
lattice = atoms.cell.array
nx, ny, nz = rho.shape

ii, jj, kk = np.mgrid[0:nx, 0:ny, 0:nz]
frac = np.stack((ii / nx, jj / ny, kk / nz), axis=-1)
cart = frac @ lattice

grid = pv.StructuredGrid(cart[..., 0], cart[..., 1], cart[..., 2])
grid["rho"] = rho.ravel(order="F")

level = 0.003  # adjust and record
positive = grid.contour([level], scalars="rho")
negative = grid.contour([-level], scalars="rho")

plotter = pv.Plotter(off_screen=True, window_size=(1600, 1100))
plotter.set_background("white")
plotter.enable_parallel_projection()
plotter.add_mesh(positive, opacity=0.80, smooth_shading=True)
plotter.add_mesh(negative, opacity=0.80, smooth_shading=True)
plotter.camera_position = "xz"
plotter.camera.zoom(1.25)
plotter.show(screenshot="chgdiff_level_0p003_xz.png")
```

The actual colors can be set by the plotting script or journal convention. The reproducibility requirement is the fixed file, isovalue, camera, projection, opacity, and script version.

## 2D slices

For a plane through three atoms, define the plane from Cartesian coordinates, sample the cube by periodic fractional coordinates, and use a symmetric color scale for signed fields.

```python
import numpy as np
from scipy.ndimage import map_coordinates

indices = [21, 25, 26]  # 1-based atom indices to report
points = atoms.get_positions()[np.array(indices) - 1]
origin = points.mean(axis=0)

u = points[1] - points[0]
u = u / np.linalg.norm(u)
v = points[2] - points[0]
v = v - np.dot(v, u) * u
v = v / np.linalg.norm(v)

x = np.linspace(-4.0, 4.0, 900)
y = np.linspace(-4.0, 4.0, 900)
xx, yy = np.meshgrid(x, y)
cart = origin + xx[..., None] * u + yy[..., None] * v
frac = cart @ np.linalg.inv(lattice)
dims = np.array(rho.shape, dtype=float)
coords = [(frac[..., axis] % 1.0) * dims[axis] for axis in range(3)]
slice_values = map_coordinates(rho, coords, order=1, mode="wrap")
```

Use color clipping deliberately: it is acceptable for visualization, but the displayed limit must be reported.

## Molden/Multiwfn workflow

CP2K `MO_MOLDEN` files are convenient for Gamma-only molecular-orbital and bonding analysis, but post-processors may need additional metadata:

- add `[Cell]` for periodic systems when the tool expects lattice vectors;
- ensure atom labels and pseudopotential valence counts are understood;
- keep raw `.molden` and edited analysis `.molden` files separate;
- record every Multiwfn menu path or batch input used to generate PDOS, ELF, LOL, AIM, IRI, Mayer, or orbital-composition outputs.

Do not treat CP2K `.wfn` restart files as quantum-chemistry `.wfn` analysis files; they are CP2K restart artifacts.

## Image validation

Every automated render needs a nonblank check:

```python
from PIL import Image, ImageStat
image = Image.open("chgdiff_level_0p003_xz.png").convert("RGB")
print(image.size)
print(ImageStat.Stat(image).extrema)
```

A white image with all-channel extrema at `(255, 255)` is blank. A nonblank result still needs human inspection for framing, atom visibility, sign convention, and whether the visible feature supports the claim.

## Reporting checklist

Record:

- source calculation folder, CP2K version, input, output, restart, and cube/Molden file paths;
- exact CP2K print section used to generate the field;
- field definition and units as reported by CP2K/output documentation;
- difference-density formula and fragment folders if applicable;
- isosurface level or 2D slice color limit;
- sign/color convention;
- camera/view/projection and image size;
- script path and Python/package versions;
- whether the image passed a nonblank check.

Figures show spatial distribution. They do not by themselves prove integer charge transfer, oxidation state, bond strength, or reaction mechanism. Pair them with charges, PDOS/bands, work-function shifts, local moments, COHP/ICOHP, or energy trends depending on the claim.
