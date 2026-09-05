---
name: materials-synthesis
description: Convert a reviewed material candidate into a reproducible, safety-gated synthesis and characterization plan for human execution.
---

# Materials synthesis planning

Use this skill only for a coordinator-issued `synthesis:plan:N` task. The output
is a proposed protocol for a qualified human to review. Never represent a
literature analogue as a proven recipe for the new candidate, and never claim
that a protocol was executed.

Write `materials/design/iteration-N/synthesis-plan.md` and a machine-readable
`synthesis-plan.json` containing:

- target batch size, stoichiometry calculation, precursor identity, purity,
  supplier/catalog placeholder, and allowed substitution;
- equipment, vessel, atmosphere, mixing medium, order of addition, temperature,
  pressure, ramp, dwell, cooling, washing, drying, and storage parameters;
- a bounded process window for uncertain parameters, with the source or reason
  for each starting value;
- positive/negative controls, replicates, sampling points, acceptance criteria,
  and characterization needed to test the candidate mechanism;
- PPE, ventilation, incompatibilities, SDS review, gas/pressure/thermal hazards,
  quench or shutdown conditions, and waste routes;
- failure branches for impurity phase, poor yield, morphology drift, target
  property miss, and unsafe/unavailable equipment.

Mark every parameter as `source-backed`, `derived`, or `proposal`. Require a
named human approval before `experiment:record:N` can be claimed. The human
record must preserve deviations, failures, instrument metadata, and raw-data
paths; never overwrite it during interpretation.

