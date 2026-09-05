# Review-Response Schemas and Drafting Templates

> Load this when: creating or updating any review-response state file (fingerprint, triage, master workflow) or drafting the response package — these are the schemas and the letter/SI/changelog templates.

> For new multi-stage or handoff-heavy projects, structured state lives in
> `.research/` via `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/`. The Markdown files below are
> human-readable summaries and package templates. (A worked instance of every file
> below: `examples/toy-vacancy-pt-vs-au/`.)

## `method-fingerprint.md`

```markdown
# Method fingerprint

- origin: manuscript    # extracted from a computational manuscript
                        # (or `designed` = authored for an experimental manuscript, user-approved)
- source: section 2.3 + original INCAR files (archive)   # provenance per field

## Experiment correspondence  (designed mode — each choice traces to a fact or is a labeled assumption)
- phase: anatase TiO2, XRD Fig. 2 -> ICSD #9852
- surface: (101) facet, dominant in TEM (Fig. 3); termination = assumption (stoichiometric)
- conditions: pH 7 aqueous -> implicit solvent; T effect neglected (stated limit)
- method precedent: settings adopted from refs 12, 31 (reviewer-cited) via literature-to-calculation

## Settings (the binding contract — every calc uses these comparable knobs)
- code: VASP 6.4.2
- functional: PBE ; dispersion: D3(BJ)
- +U: Fe_d = 5.3   # unknown -> ask, never default
- pseudopotentials: PAW_PBE (Fe_pv, O)   # TITEL lines, not file contents
- ENCUT: 520 eV
- k-policy: KSPACING 0.25 (bulk), Gamma-centered, 1 kpt along slab normal
- convergence: EDIFF 1e-6 eV, EDIFFG -0.02 eV/A
- cell conventions: 4-layer p(2x2) slab, bottom 2 fixed, 15 A vacuum
- corrections: ZPE no, solvation no, dipole yes
- reference states: E(O) = 1/2 E(O2, gas, triplet, 15 A box)

## Unknown / unresolved
- (empty) — anything listed here blocks the comments that depend on it
```

(Why the settings are a binding contract, and why a deviation is surfaced rather than
blocked, is stated once in SKILL.md Phase 1 — this file is just the schema.)

## `triage.md`  (one section per comment)

```markdown
## R1.2 — compute-new   # compute-new | reanalyze | method-challenge | text-only | needs-human-decision
> "The authors should verify the adsorption energy is converged with slab thickness."
- target: E_ads(CO) vs 4/5/6-layer slabs
- satisfaction criterion: dE_ads < 0.05 eV between successive thicknesses   # make it falsifiable
- route: structure-prep -> vasp -> hpc-submit
- method delta: none    # any deviation from the fingerprint, with justification
- reuses: relaxed-bulk (from R1.1)
- cost: ~6 relaxations, medium
- approved: no          # flipped only by the user, at Approval #1
```

## `response-workflow.md`  (human-readable scoreboard)

```markdown
# Response workflow
- manuscript: doi-or-path
- fingerprint: method-fingerprint.md

## Reusable assets   # never recompute what exists on-contract
| asset | where | fingerprint |
| relaxed bulk | runs/bulk/ | designed-v1 |

## R1.2 — status: running — outcome: (pending)
# status: proposed | approved | running | completed | validated | accepted | blocked
# outcome: addresses | contradicts | inconclusive   (the field that drives control flow — contradicts halts to the authors)
# (structured approval lives in `.research/decisions.jsonl`; don't duplicate it here)
- per-comment run state: runs/R1.2/workflow.md
| stage | status | evidence |
| ... | ... | ... |
```

**`contradicts` is a terminal state for automation** — the agent stops and surfaces it
to the authors with the evidence and options; only the user moves it forward. This is a
*decision* routed to humans, not a script blocking the agent.

## Response paragraph template

> **Comment (R1.2):** "<verbatim quote>"
>
> **Response:** We thank the reviewer for this suggestion. We have <what was done: systems, quantity> using the same computational settings as in the original manuscript (<one-line fingerprint: code, functional, cutoff, k-mesh>; full details in SI Section SX). <Result sentence with value ± criterion and units.> <Consequence: "These results confirm…" / "Accordingly, we have revised…" with the manuscript location of the change.>

Conventions:

- One response block per comment, in the reviewers' order; never merge comments silently.
- Every number: units + where it now lives in the manuscript/SI.
- If methods deviated from the manuscript: state the deviation and why, in the response text.
- Pushback, when the calculation shows the concern is unfounded, is factual and respectful: state the result, the criterion it meets, and leave the conclusion to the data. Quote no adjectives.
- Limitations are stated, not hidden: "This estimate neglects <X>; we expect the qualitative conclusion to hold because <evidence>." Only with actual evidence.

## SI addition template

```text
SI Section SX: <title tied to the comment>
Table SX: <quantity> computed at <fingerprint summary>. <Units in header.>
  columns: system | value (unit) | convergence criterion met
Caption ends with: "Settings identical to the main text unless noted."
```

## Revision changelog entry

```text
[R1.2] Main text p.N / SI SX: added slab-thickness convergence test
       (new Table SX); E_ads value in Table 2 unchanged (within 0.03 eV).
```
