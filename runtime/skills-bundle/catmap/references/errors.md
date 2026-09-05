# CatMAP Error Recovery

> Load this when: CatMAP fails to import, parser errors occur, root finding fails, descriptor points have no solution, plots are empty, or outputs are physically suspicious.

## Import / environment

| Symptom | Likely cause | Fix |
|---|---|---|
| `ModuleNotFoundError: catmap` | wrong Python environment | activate/install in the intended environment; record `catmap.__file__` |
| dependency import error | missing scientific Python package | install dependency in environment; avoid editing skill files with local paths |
| Graphviz/plotting failure | missing plotting backend or graphviz binary | save data first; fix plotting environment separately |

## Input parser problems

| Symptom | Likely cause | Fix |
|---|---|---|
| species not found | name mismatch between `energies.txt` and `.mkm` | normalize suffixes and site names |
| gas species treated as surface species | wrong `_g` suffix or site field | use consistent gas naming and `None` site convention |
| transition state missing | TS name in expression absent from table | add TS row with correct energy/frequencies |
| malformed `energies.txt` | spaces instead of tabs, missing columns | follow the parser format for installed CatMAP version |

## Thermochemistry problems

| Symptom | Likely cause | Fix |
|---|---|---|
| missing Shomate parameters | gas not in CatMAP data | switch to `ideal_gas` with frequencies or add documented parameters |
| absurd gas free energies | standard state or units mixed | rewrite formula; compare against JANAF/NIST or VASPKIT values |
| adsorbate entropy too large | low-frequency modes dominate | apply documented low-frequency treatment upstream; do not silently clip in CatMAP |

## Solver problems

| Symptom | Likely cause | Fix |
|---|---|---|
| many descriptor points invalid | bad initial guesses, stiff system, impossible conditions | narrow descriptor range; increase precision; seed from neighboring solved point |
| root finding stalls | coverages span many orders of magnitude | raise `decimal_precision`; tighten/loosen `tolerance` thoughtfully |
| negative coverages | numerical or mechanism issue | inspect site balances and reaction expressions before tuning solver |
| rates explode | descriptor extrapolation or missing reverse barriers | constrain descriptor ranges; check thermodynamic consistency |

## Scientific red flags

- One elementary step violates atom/site balance.
- A volcano top appears at the edge of descriptor range.
- Product pressure is set to zero for a reversible reaction while interpreting equilibrium behavior.
- A single RDS claim is made near a region where multiple rates are comparable.
- Mean-field CatMAP output is interpreted as proof of ordered adsorbate phases or lateral interactions without an interaction model.
