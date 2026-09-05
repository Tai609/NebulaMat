# Example: toy vacancy Pt vs Au — full review-response pipeline (integration test)

**What it demonstrates:** the entire `review-response` flow end-to-end on a
deliberately tiny, runs-anywhere fixture — Phase 0 inputs → Phase 1 designed
fingerprint (mode B, experimental manuscript) → Phase 2 triage (one `compute-new`,
one `text-only`, one `needs-human-decision`) → Phase 3 execution → Phase 4
validation against the reviewer's bar → Phase 5 drafted response package.

**Why EMT:** the calculation is a toy (ASE effective-medium theory) so the example
runs in seconds with no DFT engine or cluster. The point is the *workflow shape and
artifacts*, not the science — the response text says so explicitly. The science
content is honest at its level: EMT does reproduce the qualitative Pt > Au vacancy
ordering that the claim needs.

**Expected result:** E_v(Pt) ≈ 1.02 eV > E_v(Au) ≈ 0.81 eV → outcome `addresses`
(supports the manuscript claim). See `expected-output.md`.

**Runtime:** ~5 s, local. `uv run scripts/vacancy.py`.

## Files (the artifacts of one full run)

| File | Phase | What it is |
|---|---|---|
| `inputs/manuscript.md`, `inputs/reviews.md` | 0 | the fake manuscript + reviewer report |
| `method-fingerprint.md` | 1 | designed fingerprint (`origin: designed`) |
| `triage.md` | 2 | per-comment classification + falsifiable satisfaction criteria |
| `scripts/vacancy.py` | 3 | the verified calculation |
| `response-workflow.md` | 3–4 | master state: stages, evidence, result, validation, outcome |
| `response-package.md` | 5 | the drafted letter + SI + changelog (DRAFT for authors) |
| `expected-output.md` | — | verified numbers + pass criteria |

## What to adapt for a real case

- Replace the EMT fingerprint with the field-standard DFT settings (extracted in
  mode A, or designed from convention in mode B); run via `comp-chem-workflow` +
  the engine skill + `hpc-submit`/`rsess` on a cluster.
- Inputs will be PDFs, not markdown — ingestion is left to the agent.
- Keep the two human approval gates (after triage; before the package is final).
