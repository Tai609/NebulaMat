---
name: review-response
description: Orchestrate semi-automatic computational responses to peer review. Use when a manuscript and reviewer comments are provided and the agent must identify which comments require computation, plan and run calculations consistent with the manuscript's methods, validate whether each result actually addresses the concern, and draft response-letter and SI material.
---

# Peer-Review Response Orchestrator

This is the flagship workflow of the collection: manuscript + reviews in, a validated computational response package out, with human approval at every scientific decision point. It coordinates the other skills; it does not run engines itself.

```text
manuscript + SI + reviews (+ original calculation archive)
  -> Phase 1  method fingerprint of the manuscript
  -> Phase 2  comment triage and computation plan      [APPROVAL #1]
  -> Phase 3  execute the plan (shared models; each comment's bar tracked by ID)
  -> Phase 4  validation against each reviewer's bar
  -> Phase 5  response package: letter + SI material   [APPROVAL #2]
```

Schemas and drafting templates: `references/response-templates.md`. Structured project state uses `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/` (`.research/` task DAG, artifacts, decisions, events). Two full worked runs (fake manuscripts, all phases, run in seconds): `examples/toy-vacancy-pt-vs-au/` ends in a drafted package (`addresses`); `examples/toy-contradicts-au-vs-cu/` exercises the integrity halt (`contradicts`).

## Phase 0 — Inputs

- Manuscript and SI (source or PDF), the reviewer reports, and — ask for it explicitly — the **original calculation archive** (inputs, outputs, structures). Many comments are answerable by re-analysis of existing data at zero compute cost; without the archive every such comment becomes a new calculation.
- Constraints from the authors: deadline, compute budget, and anything already decided in the rebuttal strategy.

### Document ingestion (PDFs are the norm)

- Extract text (pdftotext-style) and **keyword-search the manuscript+SI for a computational methods section** (`DFT|VASP|functional|basis|cutoff|k-point`) *before* classifying mode A vs B — a computational paper has one (extract from it; always beats a designed fingerprint), a purely experimental paper does not (design one).
- Long review files: locate computation-related comments by per-page keyword scan (`DFT|simulat|theor|calculat`), then read only the relevant page windows. Record the page number with each comment quote.

The collection ships no extractor — use the system tool (poppler `pdftotext`; any text extractor works, the handoff contract below is what matters):

```bash
pdftotext -layout manuscript.pdf - | grep -niE 'DFT|VASP|functional|basis|cutoff|k-point'   # methods-section probe (mode A vs B)
# per-page comment scan that keeps page numbers (read only the pages that hit):
pages=$(pdfinfo reviews.pdf | awk '/^Pages:/{print $2}')
for p in $(seq 1 "$pages"); do
  pdftotext -layout -f "$p" -l "$p" reviews.pdf - | grep -qiE 'DFT|simulat|theor|calculat' && echo "page $p: computational hit"
done
```

**Ingestion handoff contract.** However the PDFs/scans/emails are read (left to the agent — the input can be messy), the ingestion step must produce a stable object the rest of the pipeline consumes, so later phases don't depend on raw-document quirks:

- **comments**: a list of `{ id, reviewer, page, verbatim quote }` — atomic, stably ID'd (`R2.3`), quoted exactly.
- **computational-methods flag**: whether the manuscript/SI has a computational methods section — present → extract (mode A), absent (purely experimental paper) → design (mode B) — plus where it was found.
- **archive present?**: whether the original calculation archive was supplied (decides reanalyze-vs-recompute).

Everything downstream (`triage.md`, the fingerprint, `.research/` artifacts, the package) keys off this object, not the PDFs. Register it as an `ingestion-object` artifact when `.research/` is in use.

## Phase 1 — Method baseline

Three modes, depending on what the manuscript contains and what survives:

**A. Computational manuscript → extract the fingerprint.** Pull the manuscript's own setup into `method-fingerprint.md`: code + version, functional, dispersion, U values, pseudopotentials/basis, cutoffs, k-policy, convergence criteria, cell/slab conventions, corrections (ZPE, solvation, dipole), reference states. Prefer reading the original input files over the methods section — papers under-specify; inputs don't. Mark anything unverifiable as `unknown` and ask.

**A′. Computational manuscript, fingerprint unavailable → reconstruct, don't invent.** A common real case: the paper *is* computational but the methods/results are stripped, the calculation archive is lost, or the SI is paywalled. This fits neither A (nothing to extract) nor B (it is not an experimental paper). Use **B's machinery seeded by whatever method references survive** — recover every knob you can from surviving text/citations/figures, fill the rest from field convention and experiment correspondence, and tag the file `origin: reconstructed`. Every value carries its provenance: `[survives]` (recoverable from intact text/refs), `[exp-anchor]` (fixed by surviving experimental data), `[designed]` (community-default choice), `[DECIDE]` (a genuine scientific fork needing user sign-off at Approval #1). Do not reconstruct removed results from outside sources when a clean-room reproduction is the point.

Missing original inputs, slab files, or complete method settings is therefore not a
stop condition. It is a provenance change: the response can run a new designed or
reconstructed calculation package, provided the plan states that it is not a literal
reproduction, records the model/method assumptions, and gets the required approval
before expensive execution.

After triage, the default calculation DAG should move directly to structure
availability: inspect whether reusable starting structures or archived inputs exist in
the current project root/current working directory or user-explicit input paths; if
they do not, build documented candidate models. Do not scan `$HOME`, `/home`, `/opt`,
`/`, shared software trees, or unrelated archives looking for hidden structures. Do
not create standalone smoke/preflight-only or caveated-summary tasks as routine
workflow milestones. Those technical checks belong inside engine setup, and report
summaries belong after validated claims.

**B. Purely experimental manuscript → design the fingerprint.** When the manuscript has no calculations and reviewers ask for simulations, there is nothing to extract — the method must be *authored*, and that is a scientific choice the user approves (folded into Approval #1):

- The anchor shifts from "the manuscript's prior settings" to **experiment–model correspondence**. Build the model system from the manuscript's own characterization — the XRD-matched phase (resolved to a database entry: ICSD/COD/Materials Project), measured composition, morphology/facets if known, and the conditions the claim concerns (T, solvent, pH, coverage). Record which experimental fact each modeling choice traces to; choices with no experimental anchor are assumptions and are listed as such.
- Choose the method from field convention for this materials class and property: run `literature-to-calculation` on two or three closely related papers — including anything the reviewer cites — and adopt the de facto standard settings rather than inventing a bespoke protocol.
- Prefer the **smallest credible calculation** that tests the claim. A reviewer asking experimentalists for supporting simulations wants a decisive minimal model, not a computational paper embedded in the rebuttal; state explicitly what the minimal model can and cannot conclude.

Either way, the resulting `method-fingerprint.md` (tagged `origin: manuscript` or `origin: designed`) **is a binding contract**: every response calculation uses the same *comparable* knobs (functional, dispersion, U, cutoff, convergence, reference states), so all new numbers are internally comparable — and, in mode A, comparable with the manuscript's. ("Same knobs", not byte-identical inputs — a molecule and a slab differ in cell/k-points.) A preflight that finds a deviation **surfaces it** (warn and disclose), it does not silently block; the agent decides whether the deviation is justified and discloses it in the response text. The one intended exception is a comment that explicitly challenges the method — then the comparison *is* the calculation. Register the fingerprint as a `method-fingerprint` artifact when `.research/` is in use.

## Phase 2 — Triage

Read and weigh **all comments together first**, then form **one coherent plan** — like a human reviewer-responder reasoning across the whole report — rather than solving one comment at a time. The plan still contains many calculations, but shared models and references are reused across comments and the dependencies and ordering between them are made explicit.

Split the reviews into atomic comments with stable IDs (`R1.1`, `R2.3`, …). Classify each:

| Class | Meaning | Route |
|---|---|---|
| `compute-new` | needs new calculations | plan below |
| `reanalyze` | answerable from the archive, no new runs | engine skill's parser / analysis sections |
| `method-challenge` | reviewer questions the method itself | benchmark: manuscript method vs. demanded method on a representative subset |
| `text-only` | no computation involved | hand to authors, out of scope here |
| `needs-human-decision` | infeasible, ambiguous, out of scope, or strategically loaded | present options + cost, do not plan unilaterally |

For every computable comment record: the concern (quoted verbatim), the target quantity, the **satisfaction criterion** (what result would actually address the concern — make it falsifiable), planned route (skills/engines), method deltas from the fingerprint (normally none), cost estimate, and dependencies on other comments. When the target is a valence/charge or bonding state, choose the *discriminating observable* here using `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md` (+ `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md`) — charge partitioning alone is often a weak discriminator, so rest the criterion on ≥2 observables including an experiment-anchored one (e.g. an adsorbate stretch frequency). In `.research/`, encode these as task YAML plus `model-observable-decision` and `triage-plan` artifacts; `knowledge_required` records the science references consulted.

Vague asks are common on experimental manuscripts ("DFT calculations would strengthen the proposed mechanism"). Triage must translate them into a falsifiable target ("does the computed barrier for pathway A lie below pathway B on the characterized facet?") before planning anything. "No feasible simulation can resolve this question" is a legitimate triage outcome — file it as `needs-human-decision` with the reasoning, since arguing scope may serve the authors better than a weak calculation.

**Approval breakpoint #1**: present the full triage table and plan. Nothing runs before the user approves it (possibly partially — track per-comment approval). This gate is what makes the workflow *semi*-automatic. Record the approval in `.research/decisions.jsonl` when structured state is in use. (In **autonomous mode** — AGENTS.md "Operation mode" — record the plan as a documented decision and proceed without pausing.)

## Phase 3 — Execution

- One `comp-chem-workflow` stage chain per approved comment, tracked in `.research/tasks/*.yaml` plus a small `response-workflow.md` summary keyed by comment ID.
- **Share artifacts across comments**: the same relaxed slab, gas references, or converged bulk often serves several comments — register them in `.research/artifacts.jsonl`, plan reuse at triage time, never recompute what exists and matches the fingerprint.
- Inherited breakpoints still apply (expensive submissions, overwrites). Engine-level failures are handled inside the engine skills; only scientific surprises escalate here.
- Expensive HPC execution is single-owner. Multiple agents may critique the plan; only the approved execution owner submits and monitors jobs. In `.research/`, execution tasks that declare `requires_claim: true` must be claimed with `claim_task.py` before submission and reconciled with `reconcile_leases.py` before any recovery or rerun.
- The first HPC submission is gated by the approved plan/model choice, structure gate
  when structures are in scope, engine preflight, execution approval, and the execution
  lease. Do not put `scientific-critic`, `result_gate`, `report_gate`, final report
  readiness, or a stage-synthesis packet before this first submission; they require
  parser/analysis evidence from completed calculations.

## Phase 4 — Validate against the reviewer's bar

Technical convergence (the validation ladder in `comp-chem-workflow`) is necessary but not the point. For each comment, classify the *scientific* outcome:

- **addresses** — valid result, satisfies the criterion from Phase 2.
- **contradicts** — the result undermines a manuscript claim. **Stop. Surface to the authors immediately**, before drafting any response text, with the evidence and the options (revise claim, extend calculations, re-examine setup). Never bury, soften, or spin a contradicting result; this is the integrity-critical branch of the whole workflow. Worked example: `examples/toy-contradicts-au-vs-cu/` (halts here, emits `escalation.md`, no package). (In **autonomous mode** the stop-and-wait becomes record-and-continue: emit `escalation.md` **and** carry the contradiction with full prominence into the final deliverable as a flagged finding — still never spun.)
- **inconclusive** — propose either a follow-up calculation (with cost) or an honest limitation statement for the response.

When `.research/` is in use, write each outcome as a `scientific-claim` artifact with
status `accepted`, `rejected`, or `draft` as appropriate. A `contradicts` claim is not a
hidden failure; it is a prominent artifact that routes to human decision.

## Phase 4.5 — Iterate follow-up calculations

Do not proceed from the first validated calculation wave directly to the final response
package. Assemble evidence packets and run the relevant scientific-critic/subagent
passes against the reviewer's bar. If a critic returns `needs-follow-up` or
`inconclusive`, create new `.research/tasks/*.yaml` nodes for the missing calculations,
post-processing, or validation, then route them back through `comp-chem-workflow`.

Use `__NEBULAMAT_AICC_ROOT__/tools/report` only for a **stage synthesis** while follow-up items remain open:
summarize current evidence, critic outcomes, and the next calculations. The final
response package starts only when every reviewer-facing claim is `addresses`,
`contradicts` with author decision, explicitly `inconclusive`/limited, or waived by a
recorded human decision.

Stage synthesis is optional interim reporting after a calculation wave. It is useful
when the user or critic needs to decide whether to run more calculations, but it is not
a pre-submit deliverable and should not be listed as a dependency of the first
engine/HPC task.

## Phase 5 — Response package

Per comment, draft (templates in references):

0. **Pre-report soft gate**: run `__NEBULAMAT_AICC_ROOT__/tools/report/references/validation.md` before drafting final claims. Check whether high-temperature/gas-reservoir free-energy corrections, DOS/PDOS, charge/work-function, or other low-cost post-processing evidence is needed. If needed, run it (VASPKIT 501/502 for VASP thermochemistry where applicable) or record a visible waiver/limitation.
1. **Response paragraph**: quote the comment, state what was computed and with which methods (one line confirming consistency with the manuscript's settings), the result with units and provenance, and the resulting manuscript change.
2. **SI additions**: tables/figures with full captions (method, units, convergence) ready to paste. Report **relative energies** (adsorption/binding/reaction energies, barriers) with their reference state — never bare total energies. Render model-structure figures with `__NEBULAMAT_AICC_ROOT__/tools/ovito` as an **orthographic top + zoomed side `(a)`/`(b)` panel** (`__NEBULAMAT_AICC_ROOT__/tools/ovito/references/structure-rendering.md`) — ASE `plot_atoms` is a preview, not a final figure — and show charge/valence/bond claims *on the structure* (atoms colored by the quantity + colorbar paired with a same-view plain element-colored panel), not as lone numbers; figure choice and the quality floor are in `__NEBULAMAT_AICC_ROOT__/knowledge/scientific-visualization.md`.
3. **Revision changelog entry**: where the manuscript changed and why.

**Assemble the deliverable.** The response package is compiled into a **near-submission `.docx` by default** (not on request) via `__NEBULAMAT_AICC_ROOT__/tools/report` — `build_report.py` from a manifest of the response paragraphs, relative-energy tables, and assembled `(a)`/`(b)` structure panels. Run `__NEBULAMAT_AICC_ROOT__/tools/report`'s readiness checklist (`__NEBULAMAT_AICC_ROOT__/tools/report/references/validation.md`) before the gate: pre-report soft gate decisions recorded, no bare total energies, every quantitative claim paired with a figure, model figures orthographic and panelized. In `.research/`, the report task consumes accepted `scientific-claim`, `figure`, and `report-manifest` artifacts.

**Approval breakpoint #2**: the drafted `.docx` is a *draft for the authors*. The agent never finalizes tone, never commits the rebuttal strategy, and never sends anything anywhere. Record the draft-package decision in `.research/decisions.jsonl` when structured state is in use. (In **autonomous mode**, emit the drafted package/`.docx` and finish — it is still a draft; nothing is sent.)

## Integrity guardrails (in addition to AGENTS.md)

- Contradicting results get the same prominence as supporting ones — in the package and in every summary along the way.
- A simulation of an idealized model "confirms" nothing about an experiment by itself. For designed-fingerprint work, the response text must state the experiment–model correspondence (phase, termination, conditions) and its limits — what the model does and does not represent.
- No sentence in the response letter may claim more than a validated calculation in the package backs; exploratory or assumption-laden results are labeled as such *in the response text*, not just internally.
- Reviewer satisfaction is not the success criterion; scientific correctness is. If the honest answer is "the reviewer is right and the manuscript must change", that is the deliverable.
