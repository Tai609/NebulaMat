# review-response examples

Verified, end-to-end worked cases of the peer-review-response pipeline. Each is a
genuinely run instance (per the repo rule: examples are real, not illustrative
sketches), distilled to its artifacts — not a dump of raw calculation output.

**Privacy:** examples use fabricated manuscripts and reviewer reports only. Never
place a real manuscript, real reviewer text, or real engagement details here.

**Each example contains:** the fake `inputs/` (manuscript + reviews), the artifacts
of each phase (`method-fingerprint.md`, `triage.md`, `response-workflow.md`),
the verified calculation `scripts/`, and an `expected-output.md` (trimmed numbers +
pass criteria, never bulky raw output). A run that validates ends in a drafted
`response-package.md`; a run whose result *contradicts* a manuscript claim halts at
Phase 4 and ends in an `escalation.md` instead (no package is drafted). The
per-example `README.md` states what it demonstrates, the expected result, runtime,
and what to adapt for a real case.

## Cases

| Case | Mode | Demonstrates | Compute |
|---|---|---|---|
| `toy-vacancy-pt-vs-au/` | designed (B) | full Phase 0–5 flow incl. all three triage classes and the `addresses` outcome | ASE-EMT, ~5 s, local |
| `toy-contradicts-au-vs-cu/` | designed (B) | the `contradicts` integrity branch: result undermines the claim → halt at Phase 4, `escalation.md` instead of a package | ASE-EMT, ~5 s, local |
