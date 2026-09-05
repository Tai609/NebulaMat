# GROMACS Trajectory and Property Analysis

> Load this when: preparing trajectories for analysis or computing structural, dynamical, thermodynamic, interface, membrane, or protein-ligand observables.

Define the observable, equilibration cut, selection, PBC treatment, fitting/reference frame, time origins, fitting window, units and uncertainty before running a command.

## Raw and derived trajectories

Never overwrite production trajectories. Create observable-specific derivatives:

```text
raw trajectory
  -> whole/centered copy for visualization and structural metrics
  -> fitted copy for RMSD/RMSF/PCA
  -> unwrapped copy for diffusion
  -> membrane/interface-centered copy for density profiles
```

No single `trjconv` sequence is correct for every observable.

## PBC preprocessing patterns

```bash
# make molecules whole
gmx trjconv -s prod.tpr -f prod.xtc -o prod_whole.xtc -pbc mol

# center a solute/complex and keep output compact
gmx trjconv -s prod.tpr -f prod_whole.xtc -o prod_center.xtc -center -pbc mol -ur compact

# continuous coordinates for diffusion
gmx trjconv -s prod.tpr -f prod.xtc -o prod_nojump.xtc -pbc nojump

# fit out translation/rotation for structural metrics
gmx trjconv -s reference.tpr -f prod_center.xtc -o prod_fit.xtc -fit rot+trans
```

The fit group and output group are separate choices. For ligand stability, fit the protein/backbone and measure ligand motion without ligand self-fit. For membrane lateral diffusion, do not remove the motion you intend to measure.

## Command map

| Command | Purpose | Critical cautions |
|---|---|---|
| `gmx energy` | energy, T, P, density, box, fluctuations | use production interval; instantaneous pressure is noisy |
| `gmx rms` | RMSD after selected fit | reference, fit group and measured group define the result |
| `gmx rmsf` | atom/residue RMSF, optional B-factor PDB | remove overall motion first |
| `gmx gyrate` | radius of gyration/principal components | use a chemically meaningful group |
| `gmx sasa` | solvent-accessible surface area | record probe radius and surface/output selections |
| `gmx hbond` | current selection-based H-bond count and distributions | record geometry and selections; reference/target must be identical or non-overlapping |
| `gmx hbond-legacy` | legacy lifetime/autocorrelation/map workflows | version-dependent compatibility path |
| `gmx rdf` | radial distribution and coordination | RDF loses angular information |
| `gmx msd` | MSD and diffusion | use unwrapped trajectory and long-time linear regime |
| `gmx density` | 1D mass/number/charge density | center interfaces/membranes first |
| `gmx densmap` | 2D density map | define averaging axis and slab |
| `gmx spatial` | 3D spatial distribution | central molecule must have consistent position/orientation |
| `gmx dssp` | protein secondary structure | modern command; legacy `do_dssp` differs |
| `gmx order` | lipid tail order | index groups must represent intended chain positions |
| `gmx freevolume` | probe-accessible free volume | probe-radius dependent |
| `gmx cluster` | conformational clustering | method/cutoff define the answer |
| `gmx covar` + `gmx anaeig` | covariance/PCA | atom selection and fitting dominate interpretation |
| `gmx xpm2ps` | render XPM matrix/density maps | verify axes and legend |

Use `gmx <command> -h` for the installed version.

## Structural stability

```bash
gmx rms  -s prod.tpr -f prod_fit.xtc -o rmsd.xvg -tu ns
gmx rmsf -s prod.tpr -f prod_fit.xtc -o rmsf_residue.xvg -res -oq bfactor.pdb
gmx gyrate -s prod.tpr -f prod_center.xtc -o gyrate.xvg
```

RMSD is reference-, fit- and selection-dependent. A plateau means the chosen metric is stationary, not that all relevant states were sampled. RMSF requires overall motion removal; flexible termini often dominate plots.

## Hydrogen bonds

Current selection-based command:

```bash
gmx hbond -s prod.tpr -f prod_center.xtc \
  -r '<reference_selection>' -t '<target_selection>' \
  -num hbnum.xvg -dist hbdist.xvg -ang hbang.xvg -o hbond.ndx
```

Historical lifetime/existence-matrix workflows use the compatibility tool when present:

```bash
gmx hbond-legacy -s prod.tpr -f prod_center.xtc -n index.ndx \
  -num hbnum.xvg -dist hbdist.xvg -ang hbang.xvg \
  -ac hbac.xvg -life hblife.xvg -hbn hbond.ndx -hbm hbmap.xpm
```

Compare systems only under the same donor/acceptor definitions and geometry cutoffs. A total count can conceal exchange between specific bonds.

## RDF and coordination

```bash
gmx rdf -s prod.tpr -f prod.xtc -ref 'name OW' -sel 'name OW' -o rdf_ow_ow.xvg -cn cn_ow_ow.xvg
```

Choose integration boundaries at physically justified minima. Directional solvation or binding-site organization needs angular or spatial distribution analysis beyond RDF.

## Diffusion and transport

```bash
gmx msd -s prod.tpr -f prod_nojump.xtc -o msd.xvg -beginfit <ps> -endfit <ps>
```

Fit the long-time diffusive regime. Three-dimensional bulk uses `MSD ≈ 6Dt`; membrane lateral diffusion uses in-plane MSD (`MSD_xy ≈ 4Dt`); one-dimensional channels use `2Dt`. Quote fit-window sensitivity and finite-size limitations.

Viscosity, dielectric constants and fluctuation properties require long trajectories, correct ensemble/coupling and block statistics. Do not report fluctuation properties from Berendsen-coupled production.

## Interfaces, droplets and membranes

For density profiles, center the slab/droplet/bilayer before averaging. For planar surface tension, use pressure-tensor anisotropy and the number of interfaces, and report dispersion/electrostatic finite-size treatment.

Membrane metrics:

- area per lipid = `Lx * Ly / N_leaflet`, not divided by both leaflets;
- thickness/density: center bilayer and compute headgroup/water density along `z`;
- tail order: ordered carbon-position index groups with `gmx order`;
- lateral diffusion: in-plane unwrapped motion and long fit window.

## Protein-ligand analysis

Recommended sequence: make the complex whole, center on protein/complex, fit protein backbone/heavy atoms, compute ligand RMSD without ligand self-fit, analyze contacts/H bonds/salt bridges/waters/torsions, and inspect representative frames. Ligand RMSD alone is not a binding free energy.

## Statistical release gate

Every reported quantity states raw files and matching `.tpr`, equilibration cut, production interval, selections, PBC/centering/fitting/unwrapping, frame stride, formula, fit/integration window, units and block/replica uncertainty.
