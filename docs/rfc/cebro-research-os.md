# RFC: CEBRO Discipline-Neutral Research OS

Status: v2 kernel, SDK adapter, persistence, and conversation-scoped Deep Research orchestration implemented.

## Decision

NebulaMat gets a discipline-neutral research layer named **CEBRO** (Causal-Evidence Branching Research OS). CEBRO treats research as an immutable, branchable graph rather than a transcript or a fixed agent pipeline.

The layer is intentionally independent of:

- physical experiments and instruments;
- numerical solvers, notebooks and simulations;
- literature providers and citation databases;
- speculative or conceptual reasoning;
- DSH, Tauri, React and any one persistence technology.

These surfaces are adapters. The research kernel only accepts typed actions, evidence, artifacts, claims and graph events.

## Core invariants

1. A claim declares its required evidence, falsifiers, challenge policy and minimum coverage before it can be compiled into a report.
2. Evidence must carry a source reference or artifact reference, a strength and a provenance relation (`supports`, `refutes`, `qualifies` or `inconclusive`).
3. Actions are selected by expected information gain and confidence gain per normalized cost, with explicit risk and reversibility penalties.
4. Research branches cannot share edges implicitly. A merge must be represented by an explicit branch operation.
5. A failed or inconclusive action remains in the graph and is eligible for counterfactual memory; it is never erased by a later successful action.
6. A portable bundle is versioned and hash-checked before import. A host may reject a bundle when its declared adapter requirements are unavailable.
7. `ResearchRuntime` owns orchestration only. Durable persistence remains in the application workspace/provenance layer, and the generic `AgentRuntime` seam is not widened for a domain-specific workflow.
8. A claim cannot silently gain certainty from correlated records. Readiness reports epistemic blockers and independent evidence families.
9. An action that can affect an external system declares an intervention protocol, including preconditions, controls, predictions, falsifiers, safety class and rollback information.
10. Hypothesis confidence is a versioned belief state. Bayesian updates and prediction loss are recorded as graph events, while the framework keeps the update assumptions explicit.

## Architecture

```text
Goal / Claim Contract
        |
Research Graph Kernel (claims, hypotheses, actions, evidence, artifacts)
        |
Counterfactual planner + information-gain scheduler
        |
ResearchActionAdapter (theory | computation | experiment | speculation)
        |
Immutable artifacts, run logs and source references
        |
Claim readiness evaluator -> portable research report
```

## Shared contracts

`packages/shared/src/research.ts` defines:

- `ResearchGraph`, `ResearchBranch`, `ResearchEvent`;
- claim, hypothesis, action, evidence, artifact and counterfactual nodes;
- typed graph edges and branch rules;
- `scoreResearchAction` and `selectNextResearchAction`;
- `evaluateClaimReadiness` and `compileResearchReport`;
- `exportResearchBundle`, `importResearchBundle` and graph validation.

The v2 epistemic contract adds:

- `ResearchEpistemicLevel`, from observation and measurement through derivation, simulation, inference, hypothesis and speculation;
- `ResearchBeliefState` and `updateResearchBelief`, with bounded likelihoods, posterior updates, update counts and optional calibration loss;
- `ResearchPrediction` and `predictionLoss` for prediction-versus-observation scoring;
- `ResearchInterventionProtocol`, which makes controls, falsifiers, safety and rollback explicit before an action is executed;
- `assessEvidenceIndependence`, which groups records by source, model, code and shared assumptions and exposes dependent-record warnings;
- claim contracts with minimum epistemic level and minimum independent-group requirements.

The schema remains backward compatible. `migrateResearchGraph` upgrades validated v1 graphs to v2 by assigning conservative epistemic defaults and an independent-evidence requirement. Portable bundles accept v1 and v2 input, but exports are always emitted as v2.

The graph is content-addressed with the shared stable hashing contract. The event list is append-only at the domain layer; a storage adapter may persist it as JSONL, SQLite, a document store or an object bundle without changing graph semantics.

## Adapter boundary

`packages/sdk/src/researchRuntime.ts` exposes `ResearchActionAdapter`:

```ts
interface ResearchActionAdapter {
  id: string;
  modes: readonly ResearchMode[];
  actionTypes: readonly ResearchActionType[];
  capabilities?: ResearchAdapterCapabilities;
  canHandle?: (context: ResearchActionAdapterContext) => boolean;
  execute(context: ResearchActionAdapterContext): Promise<ResearchActionExecution>;
}
```

`ResearchAdapterCapabilities` declares the adapter version, supported safety classes, replayability modes and whether it can produce external effects. Registration rejects contradictory declarations. Runtime selection matches the research mode, action type, declared safety class and optional `canHandle` predicate; an explicit adapter name never falls back to another adapter.

An adapter returns only a status, summary, evidence nodes and artifact nodes. It does not mutate the graph, choose a claim, or bypass provenance. `ResearchRuntime` validates output IDs, branch ownership, replay references and capability compatibility before recording outputs, links them to the action and tested claims, updates the action status, and can compile a report. Protocol violations become durable failed actions instead of leaving an action in `running`.

When an adapter returns a replay recipe, the runtime stores a content hash over the recipe. This makes the command, environment, input node IDs and replayability class auditable without assuming that every domain is deterministic.

Examples of portable adapters:

- a theory adapter returns derivations, assumptions and symbolic artifacts;
- a computation adapter returns simulation evidence, code and environment records;
- an experiment adapter returns observations, measurements, calibration artifacts and negative controls;
- a speculation adapter returns explicitly non-evidentiary arguments and counterfactuals.

The adapter name is metadata and a portability requirement, not a hard-coded domain registry.

## Agent integration

`ResearchRuntime.askAgent` is an optional bridge to an existing `AgentRuntime`. It supplies a compact graph context and instructs the model to propose falsifiers, evidence requirements and a lowest-cost discriminating action. The model turn is advisory; it cannot directly mark a claim supported or execute an adapter.

## Report contract

`compileResearchReport` returns claim-level readiness rather than unconditional prose. Each claim includes coverage, satisfied requirements, challenge status, independent evidence groups, epistemic blockers and diagnostics. Unresolved hypotheses, calibrated belief states, failed/inconclusive actions, artifact IDs and branch status remain visible.

This means a theory-only study, an experiment, a simulation and a speculative exploration share the same report envelope while retaining different evidence kinds and uncertainty statements.

## Evaluation plan

The framework should be evaluated against a single-agent transcript baseline and a fixed pipeline baseline on matched tasks. Required measures are:

- unsupported-claim rate;
- evidence coverage and provenance completeness;
- falsifier/control discovery rate;
- calibration of claim confidence;
- action cost and rework rate;
- successful reproduction from an exported bundle;
- portability across at least two independent adapters.

The architecture is a research candidate, not a prior-art or novelty claim. A publishable novelty claim requires a targeted prior-art search and these controlled evaluations.

## Desktop product integration

The desktop product exposes CEBRO as a conversation mode instead of a separate graph workspace:

- The composer places a session-scoped Deep Research switch immediately after the approval control. Its state survives pane changes and app restarts, and a draft's state moves to the created runtime session on first send.
- `apps/desktop/src/lib/modelPromptPreparation.ts` is the common model-facing boundary. It keeps the user's visible message unchanged while adding the CEBRO stage contract, specialist lanes, installed-skill routing, local knowledge evidence, and literature retrieval requirements as internal context.
- Literature-bearing turns must invoke at least one governed retrieval capability and cross-check at least two independent providers. Failed or unavailable providers become explicit evidence gaps; they are never represented as completed searches.
- The sidebar no longer exposes a Research Graph module, `/research` redirects to the live conversation, and the old conversation graph bar is not rendered. Knowledge Universe and Graphify remain independent retrieval and source-topology tools.
- `apps/desktop/src/lib/researchWorkspace.ts` and `apps/desktop/src-tauri/src/research_store.rs` remain available as an internal evidence/provenance layer. They hydrate validated graph snapshots from `.openscience/research/<researchId>.json`, serialize writes, enforce workspace boundaries, and append idempotent `cebro.graph` provenance records.

This keeps the primary workflow in the conversation while preserving CEBRO's structured evidence, immutable versions, and host-independent adapter boundary. The graph is an internal research state model, not a required user interface.

## v2 maturity boundary

The desktop storage adapter and conversation orchestration are now complete. Remaining maturity work is intentionally product-neutral: add independent adapters for theory, computation, experiment, and structured argument; exercise import/export across hosts; and measure retrieval coverage, calibration, reproduction, action cost, and portability. The architecture is a research candidate, not a prior-art or novelty claim. A publishable novelty claim still requires a targeted prior-art search and controlled evaluations.
