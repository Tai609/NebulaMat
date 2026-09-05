# Example: toy vacancy Au vs Cu — the `contradicts` integrity branch

The counterpart to `../toy-vacancy-pt-vs-au/`. **Same machinery, fingerprint, and
script shape — read that example for all of it.** The only point here is the opposite
Phase-4 outcome: the calculation **undermines** the manuscript claim, so the flow
**halts** and produces an `escalation.md` to the authors instead of a `response-package.md`.
Together the two cover both exits of the validation gate.

**Scenario:** a fake manuscript argues Au, being chemically noble, resists monovacancy
formation more strongly than Cu. The honest calculation shows the reverse —
**E_v(Au) = 0.81 eV < E_v(Cu) = 1.24 eV** — so Au resists it *less*; the manuscript
conflated chemical nobility with thermodynamic defect resistance. The reversal is robust
(EMT ordering Cu > Au matches the experimental ordering Cu ≈ 1.28 > Au ≈ 0.9 eV), so it's
a real contradiction, not a rigged one — the plausible-but-wrong kind peer review catches.

**Run:** `uv run scripts/vacancy.py` (~5 s, local). Expected
numbers in `expected-output.md`.

**What's unique to this run** (everything else mirrors the sibling):

- `response-workflow.md` ends `outcome: contradicts → HALT`.
- `escalation.md` — the surfacing-to-authors memo that **replaces** the response package.
  There is intentionally **no `response-package.md`**: the contract stops the pipeline
  before any response text is drafted (review-response Phase 4 / SKILL.md).
