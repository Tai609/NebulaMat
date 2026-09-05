# Evidence Packets

> Load this when: assembling the input list for a critic task, deciding whether a
> report can consume a claim, or passing evidence between subagents.

## Definition

An evidence packet is the minimal set of artifacts needed to decide one scientific
question. It prevents handoff from depending on chat memory.

Represent it in a task as:

```yaml
evidence_packet:
  - artifact_id: method-fingerprint
    min_status: accepted
    why: fixes method assumptions
  - artifact_id: parser-result
    min_status: validated
    why: carries the computed observable and convergence evidence
```

The same artifacts should also appear in `inputs` when the task directly consumes them.

## Contents

Include only evidence needed for the decision:

- source or method artifact;
- model/observable decision;
- surface-literature review when slab, facet, termination, coverage, or adsorption
  precedent matters;
- structure validation artifact when structures matter;
- structure-audit report when generated slabs, adsorbates, clusters, defects, or
  periodic images are part of the model;
- parser or analysis artifact with units;
- figure artifact if visual interpretation is part of the claim;
- prior critic report when the task is a re-review;
- registered subagent findings from `work/agents/` when they affect the decision;
- open `follow-up-proposal` artifacts when the packet is part of a later review cycle.

## Status Rules

- `validated` parser or structure artifacts can enter critic review.
- `accepted` claim artifacts are required for formal report conclusions.
- `rejected` and `superseded` artifacts must not be used unless the task is explicitly
  explaining why they were rejected or superseded.
- Stage synthesis packets may include validated-but-not-yet-accepted evidence only when
  every item is labeled with its current status and open follow-up proposals are listed.
  They are assembled after a calculation wave, not before the first engine/HPC
  submission.

## Provenance Rules

Every packet item should be traceable to:

- an artifact ID;
- a project-root path;
- producing task or `external`;
- status;
- source files, job IDs, parser commands, or decision IDs;
- units for numeric evidence.

Do not duplicate large data in the packet. Register the artifact and reference it.
