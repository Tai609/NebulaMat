# Molecular Dynamics: Model Design, Sampling, Validation, and Analysis

> Covers: choosing an MD model and ensemble; timestep/constraints, PBC and long-range interactions; equilibration, uncertainty and reproducibility; interpreting RDF, H bonds, RMSD/RMSF, MSD/diffusion, VACF/VDOS, viscosity, dielectric and interface/membrane observables; and enhanced sampling/free-energy workflows.

Tool-agnostic science and practice — what a trajectory means and how to design and validate it. Code operation lives in engine skills (`__NEBULAMAT_AICC_ROOT__/tools/gromacs`, `__NEBULAMAT_AICC_ROOT__/tools/lammps`, `__NEBULAMAT_AICC_ROOT__/tools/vasp/references/aimd.md`, `__NEBULAMAT_AICC_ROOT__/tools/cp2k`). Force-field model construction lives in `__NEBULAMAT_AICC_ROOT__/knowledge/force-fields.md`.

**MD is statistical sampling, not a single structure.** The final frame is not the result. The result is an average, distribution, slope, correlation function, transition statistic or free-energy profile over a justified ensemble, with equilibration removed and uncertainty assessed.

## Start from the observable

State the scientific decision, model resolution, composition/phase/protonation/charge/boundaries/state point, observable timescale/length scale, and what the model cannot represent.

Examples:

- diffusion needs unwrapped long-time displacements and finite-size awareness;
- viscosity/dielectric response needs far longer correlation sampling than RDF;
- a fixed-topology classical model cannot represent changing covalent connectivity;
- a membrane property needs semi-isotropic mechanics and slow lipid equilibration;
- rare transitions usually need enhanced sampling if ordinary MD cannot cross the barrier.

## Conceptual workflow

1. Prepare a chemically sensible start and complete topology/potential.
2. Energy minimize to remove clashes; this is not thermal equilibration.
3. Heat/initialize to target temperature; do not average preparation data as equilibrium.
4. Equilibrate relevant state variables and slow structural metrics.
5. Run production with fixed protocol and output cadence designed for the observable.
6. Validate stationarity and sampling before calculating conclusions.
7. Analyze distributions/uncertainty, not endpoints.
8. Preserve provenance so every number maps to a model, file and trajectory interval.

## Timestep, constraints and stability

The timestep must resolve the fastest retained mode and strongest imposed force. Unconstrained X-H vibrations often limit `dt` to about 1 fs; constraining the intended X-H bonds commonly permits 2 fs; mass repartitioning, virtual sites, coarse-grained models, reactive models and strong fields/pulling require their own validation.

Constraints remove degrees of freedom; restraints add bias; freezing removes motion. They affect temperature, pressure/virial and sampled ensemble differently. A trajectory with constraint warnings is invalid after the first warning.

## Periodic boundaries and finite-size effects

Periodic boundary conditions replace a finite box with an infinite lattice of images. They remove a free surface but introduce self-image coupling and finite-size artifacts. Check solute-image separation, cutoff/cell compatibility, charged-system treatment, slab/interface/droplet separation, transport finite-size effects and whether periodic molecules have exact lattice-matched connectivity.

Wrapped coordinates are suitable for compact visualization; whole/centered/fitted/unwrapped representations are derived for particular analyses. Preserve raw coordinates.

## Ensembles, thermostats and barostats

- **NVE**: fixed N, V and E; useful for drift checks and undriven dynamics.
- **NVT**: fixed N, V and T; useful after density/box is established.
- **NPT**: fixed N, P and T; useful for bulk density and flexible cells.
- Anisotropic/semi-isotropic variants are required when directions have different mechanics, e.g. membranes.

Thermostats/barostats are algorithms, not mere setters. Berendsen weak coupling rapidly approaches targets but suppresses correct fluctuations; retain it only for disclosed historical protocols. Stochastic velocity rescaling, Langevin/Nose-Hoover and production-capable barostats require sensible coupling and validation.

## Equilibration and uncertainty

A run is equilibrated for an observable when its relevant distribution is stationary and no longer remembers preparation on the measured timescale. Temperature may stabilize in ps while lipid mixing, polymer relaxation, ion redistribution or protein domain motion requires orders of magnitude longer.

Use block averaging, autocorrelation-aware error estimates, bootstrap over independent blocks/replicas, or sensitivity to fit/integration windows. The standard error is not the frame-to-frame standard deviation divided by all saved frames. Atomic trajectories are chaotic; reproducibility means statistically compatible observables, not identical frames.

## Structural metrics

RMSD depends on reference, fitted group and measured group. A plateau indicates stationarity in that projection, not complete convergence. RMSF measures fluctuation around an average after overall motion is removed. Contact/distance maps depend on atom/residue definition and threshold. Secondary-structure or torsion assignments reduce continuous geometry; report algorithm/version and selections.

## Hydrogen bonds and local coordination

A hydrogen bond is defined by donor/acceptor identity plus distance and angle criteria. Counts from different criteria are not directly comparable. Analyze specific pairs, occupancy, geometry distributions and lifetime/correlation, not total count only.

RDF describes radial local order. Report pair selections, bin width, equilibration cut, max radius, PBC treatment and integration boundary for coordination. RDF cannot encode angular directionality; use orientational distributions or spatial distribution functions when needed.

## VACF and VDOS

The velocity autocorrelation function and its Fourier transform give a finite-temperature vibrational density of states with anharmonic broadening. **VDOS is not an IR/Raman spectrum**; intensities require dipole/polarizability derivatives or appropriate time-correlation observables. VACF/VDOS needs fine velocity output.

## MSD and diffusion

Fit MSD in the long-time diffusive regime, not the early ballistic or cage plateau:

```text
3D bulk:    D = slope(MSD_xyz) / 6
2D plane:   D = slope(MSD_xy)  / 4
1D channel: D = slope(MSD_axis)/ 2
```

If the slope is in Å²/ps, `D(cm²/s) = slope/dimension_factor * 1e-4`. Use unwrapped coordinates, multiple time origins, fit-window sensitivity and independent blocks/replicas. One temperature does not establish an Arrhenius barrier.

## Transport, dielectric and fluctuation properties

Viscosity from pressure-tensor Green-Kubo integration needs converged tails and long independent sampling. Dielectric constants from total-dipole fluctuations depend strongly on charge model, electrostatics and convergence. Heat capacity, compressibility and thermal expansion require the correct ensemble and coupling algorithm; weak-coupling methods that suppress fluctuations invalidate the estimate.

## Interfaces, droplets and membranes

For planar interfaces, density profiles require framewise centering/alignment. Surface tension comes from pressure-tensor anisotropy and depends on number of interfaces, box dimensions, electrostatic/dispersion treatment and long sampling. Vacuum directions should not be collapsed by ordinary isotropic pressure coupling.

For bilayers: area per lipid uses area divided by the number in one leaflet; semi-isotropic pressure coupling separates in-plane area from normal thickness; order parameters require consistent tail-atom definitions; lateral diffusion uses in-plane unwrapped motion; mixed membranes/protein insertion often require long equilibration.

## Enhanced sampling and free energy

Ordinary MD may not cross barriers. The scientific work is choosing a collective variable that distinguishes states without hiding orthogonal barriers.

- **Umbrella/Blue-moon constrained PMF**: equilibrate windows, measure mean force or biased distributions, ensure overlap and integrate/reweight.
- **Slow growth / steered MD**: drag a CV; run slowly and compare forward/reverse directions. One fast pull is not an equilibrium PMF.
- **Metadynamics**: deposit bias in CV space; state CVs, hill height/width/frequency, bias factor and convergence.
- **Replica/exchange/AWH methods**: require overlap, exchange/mixing diagnostics and convergence across state space.

## Reporting checklist

```text
objective and observable
model resolution and force field/potential provenance
composition, charge, box/PBC and state point
ensemble, thermostat/barostat, constraints/restraints, timestep
heating/equilibration/production schedule and replicas/seeds
raw trajectory and equilibration cut
selection, reference, PBC/fit/unwrap preprocessing
analysis formula, frame stride, bins, fit/integration windows
units, finite-size/correction policy
uncertainty and convergence/sensitivity evidence
software/version and file provenance
known model limitations
```
