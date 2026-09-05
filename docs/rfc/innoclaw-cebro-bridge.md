# InnoClaw and CEBRO Bridge

Status: integrated adapter, provider, role-branch and desktop workbench slice.

## Boundary

CEBRO remains the only source of claim readiness, branch semantics, evidence
independence and provenance. InnoClaw-style workbench modules provide retrieval,
role prompts, evidence-card formatting, context indexing and report templates.
They may propose or return typed outputs, but they do not mutate a research
graph directly.

## Implemented contract

- `createInnoClawEvidenceCardAdapter` converts one Evidence Card into a CEBRO
  `data` artifact and `literature` evidence node.
- `ResearchRuntime.ingestInnoClawEvidenceCard` is the host-facing Paper Study
  entry point. A provider can return a card without knowing graph internals.
- `createArxivProvider`, `createPubMedProvider` and
  `createSemanticScholarProvider` normalize public provider responses into the
  same card contract. Failed or empty retrieval stays inconclusive.
- Evidence cards default to `independent: false`, because one retrieval batch
  is not independent evidence. CEBRO therefore keeps a claim blocked until
  independent evidence groups satisfy its contract.
- `createInnoClawRoleTeam`, `createRoleBranch` and `mergeRoleBranch` provide explicit researcher,
  skeptic, librarian, reproducer and scribe branches. Merge is recorded as a
  `branch.merged` event; no cross-branch edge is created implicitly.
- `mergeRoleBranchOutputs` clones only reviewed evidence and its artifacts into
  the target branch, retains `mergedFromNodeId`/`mergedFromBranchId`, links the
  promoted evidence to the target claim, then closes the source branch.
- `dispatchRoleAction` moves an approved role action to `running` and sends a
  bounded prompt to an isolated AgentRuntime session. Agent text never mutates
  the graph; typed output must re-enter through an adapter.
- `approveAction` and `executeAction` implement the proposed -> approved ->
  running checkpoint path. External-effect and irreversible actions remain
  proposed until a named human approves them.
- `compileInnoClawReport` renders an InnoClaw-style report from the already
  compiled CEBRO report. It preserves readiness, blockers and diagnostics.
- `buildInnoClawContextArchive` writes a disposable retrieval index with its
  source graph hash. The desktop registers it as a derived artifact; there is
  deliberately no archive-to-evidence conversion.
- ResearchPage exposes provider search, isolated role creation, reviewed merge,
  human approval, action execution, context archive persistence and Markdown
  report export without moving any of those rules into the UI.

## Provider integration

A Paper Study or Deep Research provider should:

1. Search ArXiv, PubMed, Semantic Scholar or another source.
2. Build an `InnoClawEvidenceCard` with URLs/DOIs, excerpts, retrieval status,
   and provider identity.
3. Call `runtime.ingestInnoClawEvidenceCard(researchId, card, options)`.
4. Let CEBRO compile claim readiness. Do not set a claim to `supported` in the
   provider or in an Agent prompt.

The desktop host registers both a metadata resolver for workers that already
have a card and the three public provider adapters. Network access remains the
provider's responsibility and stays outside the generic `AgentRuntime` seam.

## Next slices

- Add report citation formatting while preserving CEBRO readiness fields.
- Add materials adapters for MatterSim, UMA, VASP review and experiment
  observations.
- Prefer the governed `paper-search` MCP when it is enabled; retain the direct
  public providers as a typed fallback and for tests.
