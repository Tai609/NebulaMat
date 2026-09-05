# CP2K Basis Sets and Pseudopotentials

> Load this when: choosing or auditing CP2K `BASIS_SET_FILE_NAME`, `POTENTIAL_FILE_NAME`, per-element `&KIND` settings, all-electron/GAPW choices, ADMM/RI auxiliary bases, or basis/pseudopotential provenance.

## Core model

Quickstep normally expands Kohn-Sham orbitals in atom-centered Gaussian basis sets and represents densities/potentials on auxiliary real-space grids. Increasing `CUTOFF`/`REL_CUTOFF` improves the auxiliary grid, not the Gaussian basis-set limit. Basis quality, pseudopotential choice, grid convergence, and SCF settings are all part of the method.

Minimal pattern:

```text
&DFT
  BASIS_SET_FILE_NAME BASIS_MOLOPT
  POTENTIAL_FILE_NAME GTH_POTENTIALS
&END DFT
&SUBSYS
  &KIND O
    BASIS_SET DZVP-MOLOPT-SR-GTH
    POTENTIAL GTH-PBE-q6
  &END KIND
&END SUBSYS
```

## Guardrails

- Never invent basis or potential names. Confirm they exist in the installed CP2K data directory, project-local library, or a documented external source such as Basis Set Exchange.
- `BASIS_SET_FILE_NAME` and `POTENTIAL_FILE_NAME` locate libraries; each `&KIND` selects the actual basis/potential.
- Keep basis/potential families paired. Production GPW calculations should use basis sets and GTH pseudopotentials designed to work together.
- `qN` in a GTH potential name is the explicit valence-electron count. It changes electron count, charge interpretation, DFT+U occupations, spin moments, and comparison compatibility.
- Energies compared in one expression must use the same basis family, potential family, valence partition, auxiliary basis, and grid policy.
- GAPW/all-electron setups are different methods from ordinary GPW/GTH setups.

## Common library files

Typical installed `data/` contents vary by CP2K version and package. Common names include:

| File family | Typical use |
|---|---|
| `BASIS_MOLOPT`, `BASIS_MOLOPT_UCL`, `BASIS_MOLOPT_UZH` | GPW/GTH production or reproduction basis families |
| `GTH_POTENTIALS` | common GTH pseudopotentials, often PBE/BLYP/BP variants |
| `POTENTIAL`, `ALL_POTENTIALS`, `POTENTIAL_UZH`, `NLCC_POTENTIALS`, `HF_POTENTIALS` | version/package-dependent potential collections |
| `BASIS_ADMM`, `BASIS_ADMM_UZH` | ADMM auxiliary bases for hybrid/HFX acceleration |
| `BASIS_RI_*`, `BASIS_CCGRB_UZH` | RI/RI-HFX/MP2/RPA-style auxiliary basis families |
| `EMSL_BASIS_SETS`, `BASIS_ZIJLSTRA`, `pcseg-*` | all-electron, property, or imported basis families; check intended method |

Do not assume a file name exists on a cluster because it appears in a tutorial. If a workflow depends on a nonstandard file, commit or archive the exact file with provenance when licensing permits.

## Basis quality choices

Typical hierarchy:

```text
SZV < DZVP < TZVP / TZV2P < QZVPP
```

Use lower levels for screening and tighter levels for final small energy differences, forces, vibrational modes, stress, response properties, and high-quality electronic analysis.

Common suffixes:

| Pattern | Meaning / use |
|---|---|
| `MOLOPT` | Molecularly optimized basis family; common CP2K starting point. |
| `MOLOPT-SR` | Short-range optimized; often useful in condensed-phase/periodic systems and large cells. |
| `GTH` | Designed for use with GTH pseudopotentials. |
| `qN` | Potential valence count; must match the intended chemistry/electronic treatment. |
| `ae` / all-electron | Not interchangeable with GPW/GTH pseudopotential setups. |
| `UCL`, `UZH` | Protocol/library provenance; do not mix casually with older MOLOPT/GTH data. |

For final production, test basis quality when the target observable is basis-sensitive. A high `CUTOFF` cannot rescue a too-small Gaussian basis for weak interactions, band gaps, charges, NMR, XAS, or vibrational properties.

## Modern protocol choice

For new production GPW work, first check whether the current CP2K manual recommends a modern protocol pair, such as UZH-style basis/potential combinations for the elements and functional. Older MOLOPT/GTH combinations remain useful for reproducing literature and for compatibility with existing data.

Decision pattern:

1. Reproduction: use the source paper's basis/potential, CP2K version, and data files when available.
2. New routine GPW: start from a documented current protocol for the elements/functional.
3. Screening/pre-optimization: cheaper basis is acceptable only if final properties are recomputed consistently.
4. Spectroscopy/response/heavy elements: check whether all-electron/GAPW, NLCC, special property bases, or relativistic treatment is required.

## Multiple basis roles in one KIND

ADMM and RI-style methods need auxiliary basis roles. Example shape:

```text
&KIND C
  BASIS_SET ORB DZVP-MOLOPT-SR-GTH
  BASIS_SET AUX_FIT cFIT3
  POTENTIAL GTH-PBE-q4
&END KIND
```

Rules:

- Every element using ADMM or RI must have a documented auxiliary basis.
- Do not mix ADMM and non-ADMM energies in one reaction expression unless explicitly benchmarking ADMM error.
- Hybrid/HFX calculations should normally be restarted from a converged semilocal `.wfn` using the same structure, basis, charge, spin, and k-policy.
- ADMM auxiliary-basis size controls accuracy and cost; too-small auxiliary bases can shift band gaps, forces, and relative energies.

## GTH potentials and valence partition

GTH pseudopotential names usually encode functional family and valence count:

```text
GTH-PBE-q1     # H: 1 explicit valence electron
GTH-PBE-q4     # C: 4 explicit valence electrons
GTH-PBE-q6     # O: 6 explicit valence electrons
GTH-PBE-q16    # Fe example: semicore/valence partition must be checked
```

Rules:

- Use the potential functional family matching the XC functional when available.
- `qN` changes total electron count; update charge, spin, DFT+U occupations, and charge-analysis interpretation accordingly.
- Do not compare energies from different core sizes/valence partitions unless the expression explicitly benchmarks this choice.
- For transition metals, rare earths, actinides, XAS/NMR, and magnetic response, the core/valence decision is a scientific choice.

## All-electron, GAPW, and NLCC

Use all-electron/GAPW/NLCC only when the scientific question requires it or the source method specifies it.

Typical triggers:

- NMR, XAS, EPR, core-sensitive response, or core-level alignment.
- Heavy elements or semicore states where ordinary GTH partition is questionable.
- Validating pseudopotential effects.

Guardrail: GPW/GTH, GAPW, all-electron, NLCC, and different core sizes are not mutually interchangeable reference states. Do not mix them in adsorption, defect, surface, or reaction energies.

## Heavy elements

For heavy elements, choose core size deliberately. Large-core potentials are cheaper but can miss semicore or relativistic chemistry; small-core/all-electron descriptions are more expensive but may be required for oxidation states, spectroscopy, magnetic response, or bonding near core-like states. If using an imported ECP/basis family, record its original source and whether CP2K support is complete for the target property.

## Reporting checklist

Record:

- CP2K version and data-library source/path.
- All `BASIS_SET_FILE_NAME` and `POTENTIAL_FILE_NAME` entries.
- Every `&KIND` name, `ELEMENT` if the kind name differs from the element, basis role(s), potential, valence count, and auxiliary basis.
- Whether the run is GPW, GAPW, all-electron, NLCC, ADMM, RI-HFX, MP2/RPA-style RI, or hybrid.
- Any basis/grid convergence tests relevant to the reported property.
- Any modified/downloaded data files and their provenance.
