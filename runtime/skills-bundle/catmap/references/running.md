# Running CatMAP

> Load this when: installing/checking CatMAP, creating `energies.txt`, writing `.mkm` setup files, running `ReactionModel`, or plotting CatMAP maps.

## Environment

CatMAP is a Python package. Check the active environment before running:

```bash
python -c "import catmap; print(catmap.__file__)"
```

Common dependencies include `numpy`, `mpmath`, `matplotlib`, `scipy`, `ase`, `graphviz`, and `tqdm`. Install commands are environment-specific; do not bake local paths into skill files.

## Standard files

Typical CatMAP project:

```text
energies.txt       species energies/frequencies/site names
CO_oxidation.mkm   mechanism and solver setup
mkm_job.py         Python launcher and analysis
```

Minimal launcher:

```python
from catmap import ReactionModel

model = ReactionModel(setup_file='CO_oxidation.mkm')
model.run()
```

## `energies.txt`

`energies.txt` stores gas molecules, adsorbates, and transition states. Use tab-separated columns following the local CatMAP version's expected parser. Common fields include species name, surface/site name, formation energy/free energy, frequencies, reference, and notes.

Naming conventions:

- gas species use `_g`, e.g. `CO_g`, `O2_g`, `CO2_g`;
- adsorbates include site suffixes, e.g. `CO_s`, `O_s`, `O_t`;
- transition states must match `.mkm` reaction expressions;
- gas `surface_name`/site is usually `None`;
- site names must match `species_definitions`.

Frequency conventions:

- gas nonlinear molecules: `3N-6` frequencies; gas linear molecules: `3N-5`;
- adsorbed species: usually `3N` active adsorbate frequencies if the slab is fixed;
- surface transition states: `3N-1`, excluding the imaginary reaction-coordinate mode.

## `.mkm` setup

Reaction expressions:

```python
rxn_expressions = [
    '*_s + CO_g -> CO_s',
    '2*_s + O2_g <-> O-O_s + *_s -> 2O_s',
    'CO_s + O_s <-> O-CO_s -> CO2_g + 2*_s',
]
```

Use `reactants <-> transition_state -> products` for activated steps. Use `reactants -> products` only for steps intentionally modeled without an explicit TS.

Descriptor examples:

```python
descriptor_names = ['O_s', 'CO_s']
descriptor_ranges = [[-1, 3], [-0.5, 4]]
resolution = 15
```

Thermodynamic maps:

```python
descriptor_names = ['temperature', 'logPressure']
descriptor_ranges = [[400, 1000], [-8, 3]]
resolution = 15
```

Conditions and site definitions:

```python
temperature = 500
species_definitions = {}
species_definitions['CO_g'] = {'pressure': 1.0}
species_definitions['O2_g'] = {'pressure': 1.0/3.0}
species_definitions['CO2_g'] = {'pressure': 0.0}
species_definitions['s'] = {'site_names': ['111'], 'total': 1.0}
```

For multiple site types:

```python
species_definitions['s'] = {'site_names': ['111'], 'total': 1.0}
species_definitions['t'] = {'site_names': ['top'], 'total': 1.0}
```

## Thermochemistry modes

Gas thermochemistry modes:

- `ideal_gas`: ASE `IdealGasThermo`; needs frequencies and molecular geometry metadata.
- `shomate_gas`: Shomate parameters from CatMAP data; useful for common gases when available.
- `fixed_entropy_gas`: ZPE plus fixed entropy dictionary; needs frequencies.
- `frozen_fixed_entropy_gas`: fixed entropy without ZPE; rough.
- `zero_point_gas`: ZPE only; usually insufficient for gas thermochemistry.
- `frozen_gas`: no correction; avoid for realistic gas-pressure kinetics.

Adsorbate modes include harmonic treatment from frequencies, fixed entropy approximations, and frozen approximations. Prefer harmonic adsorbate corrections when frequencies are available; use rough modes only for screening and label them as such.

## Numerical settings

CatMAP solves stiff nonlinear equations. High precision is often needed:

```python
decimal_precision = 100
tolerance = 1e-50
max_rootfinding_iterations = 100
max_bisections = 3
```

Use lower precision only for exploratory runs and document it.

## Analysis and plotting

Add output variables before `model.run()` when needed:

```python
model.output_variables += ['production_rate', 'coverage', 'rate_control']
model.run()
```

Vector map example:

```python
from catmap import analyze

vm = analyze.VectorMap(model)
vm.plot_variable = 'production_rate'
vm.log_scale = True
vm.min = 1e-30
vm.max = 1e3
vm.plot(save='production_rate.pdf')
```

Scaling analysis:

```python
from catmap import analyze
sa = analyze.ScalingAnalysis(model)
sa.plot(save='scaling.pdf')
```

For publication plots, record descriptor labels, units, pressure/temperature conditions, and any clipping thresholds.
