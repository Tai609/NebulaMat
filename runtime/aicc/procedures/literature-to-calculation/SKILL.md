---
name: literature-to-calculation
description: Extract concrete computational tasks from papers, supplementary information, peer-review files, reviewer comments, reports, or manuscript PDFs, and seed .research evidence artifacts such as method-fingerprint, model-observable-decision, and triage-plan before routing to computational chemistry workflow or tool skills. Use when Codex must turn document evidence into DFT, quantum chemistry, MD, MLP, structure-preparation, or analysis work.
---

# Literature To Calculation

Use this before any calculation when the task originates from a document. The goal is a concrete, checkable calculation target and durable evidence, not a paper summary.

For a full manuscript + reviewer-comments campaign, start with `review-response` instead; it owns comment triage and method consistency, and uses this skill's extraction rules per comment or source paper.

## Extract

1. Source: title, document type, DOI/arXiv/report ID if available, and exact page, section, table, or figure.
2. Claim or concern requiring computation, quoted only briefly when needed and otherwise tightly paraphrased.
3. System: composition, structure/phase, surface and termination, defects, adsorbates, charge, spin, temperature, pressure, solvent, electrolyte, or force-field environment.
4. Method: code/version, functional, basis or pseudopotentials, U values, dispersion, force field, k-mesh/cutoff, convergence criteria, sampling, and corrections such as ZPE, thermal, entropy, solvation, pressure, pH, or electrode potential.
5. Required inputs: structures, coordinates, tables, trajectories, prior outputs, model parameters, and whether each is actually provided.
6. Expected outputs: energies, barriers, structures, charges, DOS/bands, phonons, spectra, trajectories, free energies, step diagrams, plots, or comparison tables.
7. Comparison target: the paper's value, a trend, a reviewer threshold, or an experimental observable, with units and sign convention.
8. Missing items that block a true reproduction.

## Reproduction vs. Exploration

State explicitly which one this is.

- **Reproduction** requires the original structures or trajectories plus enough method detail to reproduce the reported observable.
- **Exploration** is legitimate when structures are rebuilt or settings are assumed, but every downstream artifact and report must label the model origin and assumptions.

Missing coordinates or full method settings do not automatically block work; they change the route to designed/reconstructed exploration under `comp-chem-workflow` and `research-orchestrator`.

## Seed `.research` Evidence

When `.research/` exists, or when the task is multi-stage, HPC, resumable, or likely to be handed off, write the extraction into initial artifacts instead of leaving it only in chat. Read `references/research-artifacts.md` for the required artifact contents and registry examples.

Default seed artifacts:

- `source-evidence-map` — where each extracted fact came from, with page/figure/table provenance.
- `method-fingerprint` — verified and assumed computational settings, clearly labeled.
- `model-observable-decision` — the model, observable, success criterion, and why it answers the source claim.
- `triage-plan` — task route, dependencies, cost/risk notes, missing inputs, and reproduction/exploration label.

If `.research/` does not exist yet but the task qualifies for durable state, initialize it through `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/` or hand off to `comp-chem-workflow` to do so before execution planning. `workflow.md` is only a human-readable summary; it does not replace these artifacts.

## Route

- Document-derived single target with execution work -> `comp-chem-workflow`, then the relevant tool skill.
- Structure missing or rebuilt -> `structure-prep`, with structure review before engine handoff.
- Periodic DFT -> `vasp` or another periodic engine skill; molecular QC -> `gaussian`; CP2K systems -> `cp2k`.
- Biomolecular/liquid/membrane MD -> `gromacs`; materials/reactive/MLP MD -> `lammps`; MLP work -> `mlp` or the program-specific MLP tool; phonons -> `phonopy`.
- Post-processing only -> the engine skill that produced the outputs.
- Manuscript + reviewer-comments campaign -> `review-response`.

## Output

Return a compact human summary and, when `.research/` is used, the artifact paths/IDs registered.

```text
Target calculation:
Evidence artifacts: <source-evidence-map, method-fingerprint, model-observable-decision, triage-plan paths or pending>
System:
Method: <verified / assumed labels>
Available inputs:
Missing inputs:
Reproduction or exploration:
Comparison target: <units/sign convention>
Recommended downstream route:
Blocking decisions or approvals:
```
