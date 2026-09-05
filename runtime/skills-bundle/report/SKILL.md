---
name: report
description: "Assemble stage-synthesis or final .docx reports from computed results. Use for interim review packets after a calculation wave, or as the final deliverable of peer-review responses, calculation reports, and reproductions when accepted claims must be handed to humans with figures, captioned relative-energy tables, and structure figures paired with their data. Encodes report maturity gates: stage reports disclose pending follow-up; final reports consume accepted claims by default."
---

# Report Builder

The shipped report skill has two modes. A **stage synthesis** is an interim review
packet after a wave of calculations; it helps the user or scientific critic decide what
to compute next. A **final report** turns accepted claims into a near-ready-to-submit
`.docx` a human can read and edit. Producing a final document is a default deliverable
only after the workflow's open follow-up tasks, waivers, limitations, and report gate
are resolved.

Report work is post-result work. Neither a stage synthesis nor a final-report
`report_gate` is part of the first engine/HPC submission critical path; those tasks
consume parser outputs, accepted/waived claims, figures, or follow-up decisions that do
not exist before calculations run.

It does not run engines, close scientific gaps, or invent content. If the evidence is
validated but not accepted, or a critic has open `needs-follow-up` items, produce a
stage synthesis rather than a final report.

## Where to find what

| Situation | Go to |
|---|---|
| build a stage synthesis or final docx: manifest schema, report skeleton, figure-pairing mechanics | `references/running.md` |
| before drafting final claims: soft-gate whether easy missing analyses are needed (free-energy corrections, DOS/PDOS, charge/work-function, extra structure figures) | `references/validation.md` |
| is the report ready to submit? the human-readability checklist (gates) | `references/validation.md` |
| assemble the docx from a manifest | `scripts/build_report.py` (python-docx; run with `uv run`) |
| a worked manifest to copy | `examples/` |
| model figures: orthographic top+side, atoms colored by charge | `__NEBULAMAT_AICC_ROOT__/tools/ovito/references/structure-rendering.md` |
| the science of what to show and why | `__NEBULAMAT_AICC_ROOT__/knowledge/scientific-visualization.md` |

## Hard guardrails (the human-readability spec — enforced by `validation.md`)

- **Relative energies, never bare total energies.** Humans read adsorption/binding energies, reaction energies, and barriers — not TOTEN. Every reported energy states its reference state. (`build_report.py` flags table cells that look like total energies.)
- **Pair every quantitative claim with a figure.** A Bader charge, a bond length, an oxidation-state claim is shown *on the structure* (atoms colored by charge + colorbar, key atoms optionally labeled), not as a lone table cell. Property-colored structures should be paired with the same-view plain element-colored render in one `(a)`/`(b)` panel.
- **Model figures use relaxed final structures.** For VASP relaxation outputs, render
  `CONTCAR`, not the initial `POSCAR`, unless `POSCAR` is documented as a copy of the
  final `CONTCAR`.
- **Model figures are orthographic top + side — never perspective.** Render with
  `__NEBULAMAT_AICC_ROOT__/tools/ovito` (`--view top`/`--view side`, `--projection ortho`) and assemble one
  left-to-right `(a)`/`(b)` panel: `(a)` top on the left, `(b)` zoomed/cropped side on
  the right, with empty vacuum removed unless vacuum/cell height is the point.
- **Captions are complete:** method (one line confirming the manuscript's settings), units, convergence/provenance — paste-ready.
- **Pre-report soft gate:** before writing the final manifest, check whether the claim should include free-energy corrections, DOS/PDOS, charge/work-function, or another low-cost analysis. Run it when needed or record a visible waiver; do not silently omit it.
- **Stage reports are visibly interim.** They list claim status, critic outcomes, and
  open follow-up proposals. They must not use final-report wording such as "resolved"
  or "conclusive" unless a claim is accepted.
- The agent drafts; humans decide. The docx is a draft for the authors — never finalize tone or send anything.

## Handoff

Consumes either an interim evidence packet or the workflow's accepted package (e.g.
`review-response` final phase) plus figures from `__NEBULAMAT_AICC_ROOT__/tools/ovito`. Emits a stage synthesis
or `report.docx`. Report which sections/tables/figures it contains, the report mode,
and any advisory the builder raised.
