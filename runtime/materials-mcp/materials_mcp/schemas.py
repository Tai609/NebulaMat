"""Shared contracts for every materials agent and evaluator.

These dataclasses intentionally use only the standard library so that the
coordinator, benchmark runner, and lightweight agent tools work before the
large materials dependencies finish provisioning.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


# Keep the public contract version stable; the new operational fields are
# backward-compatible optional extensions to the v1 agent envelope.
SCHEMA_VERSION = 1
SOURCE_OBSERVATION_STATUSES = {
    "found",
    "not_found",
    "pending",
    "timeout",
    "rate_limited",
    "unavailable",
    "schema_error",
    "authentication_error",
    "circuit_open",
    "budget_exhausted",
    "invalid_query",
    "dead_letter",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _strings(values: list[str] | None) -> list[str]:
    return [str(value) for value in (values or []) if str(value).strip()]


def _dict(value: dict[str, Any] | None) -> dict[str, Any]:
    return dict(value or {})


@dataclass
class AgentBudget:
    max_tokens: int = 8_000
    timeout_seconds: int = 300
    max_tool_calls: int = 40

    def validate(self) -> None:
        if self.max_tokens <= 0 or self.timeout_seconds <= 0 or self.max_tool_calls <= 0:
            raise ValueError("agent budget values must be positive")


@dataclass
class AgentTaskInput:
    task_id: str
    workflow_id: str
    role: str
    objective: str
    response_language: str = "en"
    input_artifacts: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    acceptance_tests: list[str] = field(default_factory=list)
    constraints: dict[str, Any] = field(default_factory=dict)
    runtime: dict[str, Any] = field(default_factory=dict)
    budget: AgentBudget = field(default_factory=AgentBudget)
    schema_version: int = SCHEMA_VERSION
    created_at: str = field(default_factory=now_iso)

    def validate(self) -> None:
        if not self.task_id or not self.workflow_id or not self.role or not self.objective:
            raise ValueError("task_id, workflow_id, role, and objective are required")
        self.budget.validate()
        if not self.response_language.strip():
            raise ValueError("response_language is required")

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        value = asdict(self)
        value["budget"] = asdict(self.budget)
        return value

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "AgentTaskInput":
        budget = value.get("budget") or {}
        task = cls(
            task_id=str(value.get("task_id", "")),
            workflow_id=str(value.get("workflow_id", "")),
            role=str(value.get("role", "")),
            objective=str(value.get("objective", "")),
            response_language=str(value.get("response_language", "en")),
            input_artifacts=_strings(value.get("input_artifacts")),
            dependencies=_strings(value.get("dependencies")),
            acceptance_tests=_strings(value.get("acceptance_tests")),
            constraints=_dict(value.get("constraints")),
            runtime=_dict(value.get("runtime")),
            budget=AgentBudget(
                max_tokens=int(budget.get("max_tokens", 8_000)),
                timeout_seconds=int(budget.get("timeout_seconds", 300)),
                max_tool_calls=int(budget.get("max_tool_calls", 40)),
            ),
            schema_version=int(value.get("schema_version", SCHEMA_VERSION)),
            created_at=str(value.get("created_at", now_iso())),
        )
        task.validate()
        return task


@dataclass
class AgentTaskOutput:
    task_id: str
    workflow_id: str
    agent: str
    status: str
    response_language: str | None = None
    artifacts: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    uncertainty: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)
    source_observations: list[dict[str, Any]] = field(default_factory=list)
    retryable: bool = False
    learning_proposal: dict[str, Any] | None = None
    schema_version: int = SCHEMA_VERSION
    created_at: str = field(default_factory=now_iso)

    def validate(self) -> None:
        if not self.task_id or not self.workflow_id or not self.agent:
            raise ValueError("task_id, workflow_id, and agent are required")
        if self.status not in {"completed", "failed", "blocked", "review"}:
            raise ValueError("task status must be completed, failed, blocked, or review")
        if self.status == "completed" and not self.artifacts:
            raise ValueError("completed tasks must reference at least one artifact")
        if self.status in {"failed", "blocked"} and not self.blockers:
            raise ValueError("failed or blocked tasks must explain the blocker")
        if self.response_language is not None and not self.response_language.strip():
            raise ValueError("response_language cannot be empty")
        if self.retryable and self.status not in {"failed", "blocked"}:
            raise ValueError("only failed or blocked tasks can be retryable")
        for observation in self.source_observations:
            if not observation.get("provider") or not isinstance(observation.get("query"), dict):
                raise ValueError("source observations require provider and query")
            if observation.get("status") not in SOURCE_OBSERVATION_STATUSES:
                raise ValueError("source observation has an invalid status")

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "AgentTaskOutput":
        output = cls(
            task_id=str(value.get("task_id", "")),
            workflow_id=str(value.get("workflow_id", "")),
            agent=str(value.get("agent", "")),
            status=str(value.get("status", "")),
            response_language=(str(value["response_language"]) if value.get("response_language") else None),
            artifacts=_strings(value.get("artifacts")),
            evidence=_strings(value.get("evidence")),
            findings=[item for item in value.get("findings", []) if isinstance(item, dict)],
            metrics=_dict(value.get("metrics")),
            uncertainty=_strings(value.get("uncertainty")),
            blockers=_strings(value.get("blockers")),
            source_observations=[item for item in value.get("source_observations", []) if isinstance(item, dict)],
            retryable=bool(value.get("retryable", False)),
            learning_proposal=value.get("learning_proposal") if isinstance(value.get("learning_proposal"), dict) else None,
            schema_version=int(value.get("schema_version", SCHEMA_VERSION)),
            created_at=str(value.get("created_at", now_iso())),
        )
        output.validate()
        return output


@dataclass
class ReviewVote:
    workflow_id: str
    task_id: str
    reviewer_id: str
    scope: str
    verdict: str
    findings: list[dict[str, Any]] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    confidence: float = 0.0
    schema_version: int = SCHEMA_VERSION
    created_at: str = field(default_factory=now_iso)

    def validate(self) -> None:
        if not self.workflow_id or not self.task_id or not self.reviewer_id or not self.scope:
            raise ValueError("workflow_id, task_id, reviewer_id, and scope are required")
        if self.verdict not in {"approve", "reject", "abstain"}:
            raise ValueError("review verdict must be approve, reject, or abstain")
        if not 0.0 <= float(self.confidence) <= 1.0:
            raise ValueError("review confidence must be between 0 and 1")
        if self.verdict == "reject" and not self.findings:
            raise ValueError("a rejecting vote must include findings")

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "ReviewVote":
        vote = cls(
            workflow_id=str(value.get("workflow_id", "")),
            task_id=str(value.get("task_id", "")),
            reviewer_id=str(value.get("reviewer_id", "")),
            scope=str(value.get("scope", "")),
            verdict=str(value.get("verdict", "")),
            findings=[item for item in value.get("findings", []) if isinstance(item, dict)],
            evidence=_strings(value.get("evidence")),
            confidence=float(value.get("confidence", 0.0)),
            schema_version=int(value.get("schema_version", SCHEMA_VERSION)),
            created_at=str(value.get("created_at", now_iso())),
        )
        vote.validate()
        return vote


@dataclass
class BenchmarkResult:
    benchmark_id: str
    passed: bool
    checks: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    replayed_workflows: list[str] = field(default_factory=list)
    schema_version: int = SCHEMA_VERSION
    created_at: str = field(default_factory=now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def schema_catalog() -> dict[str, Any]:
    """Return the runtime contract summary exposed to every agent."""
    return {
        "schema_version": SCHEMA_VERSION,
        "AgentTaskInput": {
            "required": ["task_id", "workflow_id", "role", "objective"],
            "fields": ["response_language", "input_artifacts", "dependencies", "acceptance_tests", "constraints", "runtime", "budget", "created_at"],
            "budget": ["max_tokens", "timeout_seconds", "max_tool_calls"],
        },
        "AgentTaskOutput": {
            "required": ["task_id", "workflow_id", "agent", "status"],
            "status": ["completed", "failed", "blocked", "review"],
            "fields": ["response_language", "artifacts", "evidence", "findings", "metrics", "uncertainty", "blockers", "source_observations", "retryable", "learning_proposal", "created_at"],
            "rules": ["completed requires artifacts", "failed or blocked requires blockers"],
        },
        "ReviewVote": {
            "required": ["workflow_id", "task_id", "reviewer_id", "scope", "verdict", "confidence"],
            "verdict": ["approve", "reject", "abstain"],
            "fields": ["findings", "evidence", "created_at"],
            "rules": ["reject requires findings", "confidence is between 0 and 1"],
        },
        "MechanismFailureEvidenceGraph": {
            "node_types": ["material_state", "mechanism", "failure_mode", "observable", "evidence", "design_target"],
            "edge_types": ["supports", "contradicts", "causes", "aggravates", "mitigates", "transforms_to", "observed_as", "applies_to"],
            "computed_fields": ["support_score", "evidence_coverage", "failure_priority", "evidence_confidence", "graph_hash"],
            "rules": ["anchored evidence for strong source levels", "causal edges require evidence ids", "mechanism and failure nodes require falsifiers"],
        },
        "MaterialDesignOperator": {
            "registry_tool": "get_material_design_operators",
            "application_tool": "apply_material_design_operators",
            "candidate_validation_tool": "validate_material_design_candidate",
            "rules": ["registered operators only", "typed parameters", "graph-linked expected effects", "falsifier per effect"],
        },
        "CandidateStructureCompiler": {
            "tool": "compile_material_candidate_structure",
            "statuses": ["pass", "hold", "reject"],
            "prototype_types": ["explicit", "spinel", "brucite"],
            "outputs": ["CIF", "POSCAR", "normalized structure JSON", "surface slabs", "interfaces", "manifest"],
            "rules": [
                "missing atomistic specifications return hold",
                "fractional occupancies require an ordered supercell",
                "minimum periodic distance is checked before pass",
                "interfaces exceeding the declared mismatch limit are rejected",
                "normalized structure JSON carries explicit periodic bonds for rendering",
            ],
        },
        "MatterGenStructureStandardizer": {
            "tool": "standardize_mattergen_structure",
            "runner": "NEBULAMAT_MATTERGEN_RUNNER",
            "outputs": ["standardized bulk", "standardized surface", "POSCAR", "CIF", "manifest", "SHA-256"],
            "rules": [
                "raw MatterGen structure-*.cif files are never screening inputs",
                "bulk atom count must fall inside the declared target window",
                "surface_layers is the exact number of real atomic planes along cross(a,b)",
                "vacuum_angstrom is the total periodic gap, not a per-side amount",
                "surface target is 96 atoms by default with minimum 12 A lateral vectors and c/min(a,b) no greater than 4",
                "slab expansion may change only in-plane replication, not the declared layer count",
                "sorting sites, reducing a formula, changing symmetry notation, or rewriting CIF/POSCAR without controlled expansion is not standardization",
                "MatterSim and UMA require a passing manifest and matching artifact hash",
            ],
        },
        "PreDFTPhysicsScreen": {
            "tool": "pre_dft_physics_screen_candidate",
            "decisions": ["reject", "hold", "promote_to_dft"],
            "evidence_classes": ["experimental_record", "database_record", "computed", "embedded_reference", "scaling_relation", "assumption", "missing"],
            "hard_constraints": ["formula", "charge_neutrality", "site_occupancy", "vacancy_fraction", "minimum_distance", "dopant_fraction", "strain_bound", "lattice_mismatch", "coating_thickness"],
            "proxy_layers": ["ionic_radius", "coordination", "bond_valence", "energy_above_hull", "aqueous_stability", "oer_descriptors", "oer_sabatier_proxy", "her_descriptors", "her_sabatier_proxy", "water_dissociation_barrier"],
            "rules": ["missing evidence is not a negative result", "database facts and extrapolations remain distinct", "HER/OER descriptor intervals do not replace surface DFT, solvent, kinetics, or experiment", "alkaline HER water-dissociation barriers are optional Volmer-step proxies"],
        },
        "MatterSimStabilityScreen": {
            "tool": "run_mattersim_stability_screen",
            "model": "MatterSim-v1.0.0-5M",
            "inputs": ["structure_path", "structure_kind", "relax", "relax_cell"],
            "outputs": ["initial", "final", "relaxation", "geometry_change", "decision", "checkpoint_sha256"],
            "decisions": ["promote_to_next_stage", "hold"],
            "rules": ["v1.0.0-5M checkpoint is explicit and hash-recorded", "relaxation convergence is a geometry/force proxy", "energy per atom is not Materials Project energy above hull", "v1 is primarily bulk-trained and slab/interface results require VASP calibration", "a pass routes bulk candidates to surface construction and UMA"],
        },
        "UMAAdsorptionScreen": {
            "tool": "run_uma_adsorption_energy_screen",
            "standardization_tool": "standardize_uma_adsorption_structure_set",
            "default_model": "uma-s-1p2p1",
            "default_task": "oc25",
            "inputs": ["slab_path", "adsorbate_path", "adsorbed_path"],
            "outputs": ["energies_ev", "adsorption_energy_ev", "input_sha256", "relaxation", "uncertainty"],
            "energy_expression": "E(slab+adsorbate) - E(slab) - E(adsorbate)",
            "rules": ["all three inputs require one current passing standardization manifest and matching hashes", "adsorbed composition and atom count equal slab plus adsorbate", "slab and adsorbed cells match", "slab, isolated adsorbate, and adsorbed slab must all relax and converge before any energy is evaluated", "relax=false is rejected", "the bottom three real slab planes are fixed by default", "non-convergence returns hold without energies_ev or adsorption_energy_ev", "all three energies use one fairchem model and task", "negative values are exothermic under the recorded sign convention", "not_calibrated uncertainty requires same-protocol VASP calibration", "oc25 is the electrocatalysis default", "potential, pH, solvent, coverage, reconstruction, and kinetics are not inferred"],
        },
        "UMASurfaceMolecularDynamics": {
            "tool": "run_uma_surface_md",
            "engine": "ASE",
            "potential": "fairchem UMA",
            "default_task": "oc25",
            "default_supercell": [2, 2, 1],
            "default_ensemble": "nvt",
            "inputs": ["standardized adsorbed surface", "temperature", "timestep", "duration", "seeds", "fixed bottom layers"],
            "outputs": ["md-manifest.json", "trajectory.extxyz", "trajectory-preview.extxyz", "thermo.csv", "final CIF", "representative frame", "closest-contact frame"],
            "rules": ["only adsorption-set adsorbed artifacts with matching hashes are accepted", "the complete adsorbed cell is repeated to preserve coverage", "vacuum direction replication is forbidden", "ordinary three-dimensional NPT is forbidden", "bottom two atomic planes and three random seeds are the defaults", "collision and finite-value guards are recorded", "mechanistic claims require representative-frame DFT calibration"],
        },
        "MaterialsRuntimeStatus": {
            "tool": "get_materials_runtime_status",
            "outputs": ["configured", "discovered", "ready", "missing", "checkpoint_sha256", "active_python"],
            "rules": ["a checkpoint file does not prove that its Python environment is ready", "UMA gated weights remain not_probed until a real model load succeeds", "the machine-specific report is written only when write_status=true"],
        },
        "NoveltyAudit": {
            "role": "materials-novelty-auditor",
            "verdicts": ["no_collision_found", "collision", "insufficient_search"],
            "decisions": ["pass", "pass_with_exclusions", "blocked"],
            "rules": ["frozen candidate and evidence-graph hashes", "exact and near-neighbor queries", "query-to-candidate coverage", "at least two independent sources", "covers every candidate", "search misses do not establish novelty"],
        },
        "MaterialsWorkflow": {
            "status_values": ["active", "degraded", "terminal", "blocked", "failed"],
            "dependency_policies": ["all_success", "allow_partial", "quorum"],
            "source_observation_status": sorted(SOURCE_OBSERVATION_STATUSES),
            "domain_profiles": ["general", "alkaline-electrolysis"],
            "default_route": "standard",
            "routes": {
                "agent": "agent-supplied capability plan with explicit dependencies",
                "fast": "planner-only two-step decision record",
                "standard": "bounded planner/materials discovery, validation, screening, and synthesis",
                "high-risk": "full provider quorum, independent review, DFT/experiment gates",
            },
            "capability_plan": {
                "node_fields": ["task_id", "capability", "depends_on", "parameters", "objective"],
                "dependencies_are_explicit": True,
                "unknown_capabilities_rejected": True,
                "cycles_rejected": True,
                "execution_rule": "only submitted capability nodes are executed; no hidden completion or review tasks are appended",
            },
            "stable_roles": ["planner", "materials", "literature", "compute", "experiment", "reviewer"],
            "response_language": "inferred from the user's goal unless explicitly supplied; every delegated task and user-facing answer must use it",
            "dft_submission_gate": ["dft:prepare", "dft:audit", "dft:human-review", "dft:run"],
            "dft_cost_rate": {"value": 0.1, "unit": "CNY/core-hour"},
            "alkaline_electrolysis_roles": [
                "chemistry-reasoner",
                "electrochemistry-analyst",
                "catalyst-scientist",
                "interface-transport-specialist",
                "degradation-analyst",
                "electrolysis-safety",
                "electrochemistry-experimentalist",
            ],
            "alkaline_electrolysis_gates": [
                "domain:chemistry",
                "domain:electrochemistry",
                "domain:catalyst",
                "domain:interface-transport",
                "domain:degradation",
                "domain:safety",
                "review:electrochemistry",
                "review:safety",
            ],
            "design_mode": "set true to add candidate design, synthesis, and human experiment gates",
            "design_stages": [
                "design:brief",
                "design:candidates:N",
                "design:structure:N",
                "design:novelty:N",
                "design:validate:N",
                "design:physics:N",
                "design:audit:N",
                "synthesis:plan:N",
                "experiment:protocol:N",
                "experiment:safety:N",
                "experiment:record:N",
                "experiment:analyze:<scope>:N",
                "experiment:interpret:N",
            ],
            "design_roles": ["materials-designer", "materials-structure-compiler", "materials-novelty-auditor", "materials-validator", "materials-physics-screener", "materials-reviewer:design"],
            "design_isolation": "Designer freezes operator-derived candidates; Novelty Auditor runs in a separate role and cannot edit or redesign them",
            "human_gate": "experiment:record:N must be completed by human:<id>",
            "next_iteration": "start_material_design_iteration requires a completed interpretation",
            "late_enrichment": "reconcile:providers is background work and versions late source results without blocking the primary report",
            "task_recovery": ["lease", "heartbeat", "bounded_retry", "dead_letter"],
        },
        "ProviderRuntime": {
            "query_modes": ["formula", "elements"],
            "observation_contract": "not_found is an empty result; infrastructure states remain retryable evidence gaps",
            "durability": ["idempotency_key", "sqlite_checkpoint", "lease", "resume"],
            "resilience": ["request_timeout", "provider_budget", "bounded_retry", "circuit_breaker", "bounded_concurrency"],
            "evolution": "allowlisted policy changes require offline evaluation, replay, canary, approval, and rollback",
        },
    }
