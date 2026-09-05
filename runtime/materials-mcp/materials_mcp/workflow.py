"""Durable materials workflow and bounded agent self-evolution.

The language model chooses how to solve a stage, but this module owns stage
transitions, evidence requirements, and the append-only learning records. A
proposed lesson never changes an agent automatically; it must be promoted by a
reviewer or an explicitly named human approver.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
import threading
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .design_operators import validate_design_candidate
from .dft_submission import validate_cost_estimate, validate_model_audit
from .evidence_graph import EvidenceGraphError, compile_evidence_graph
from .capabilities import CapabilityError, capability_plan_tasks, plan_risk
from .schemas import AgentTaskInput, AgentTaskOutput, ReviewVote


WORKFLOW_SCHEMA_VERSION = 3
DOMAIN_PROFILES = ("general", "alkaline-electrolysis")
WORKFLOW_STAGES = (
    "planned",
    "discovering",
    "validating",
    "screening",
    "awaiting_review",
    "dft_preparing",
    "dft_running",
    "dft_postprocessing",
    "dft_review",
    "completed",
    "blocked",
    "failed",
)

TRANSITIONS: dict[str, tuple[str, ...]] = {
    "planned": ("discovering", "blocked", "failed"),
    "discovering": ("validating", "blocked", "failed"),
    "validating": ("screening", "blocked", "failed"),
    "screening": ("awaiting_review", "blocked", "failed"),
    "awaiting_review": ("dft_preparing", "completed", "blocked", "failed"),
    "dft_preparing": ("dft_running", "blocked", "failed"),
    "dft_running": ("dft_postprocessing", "blocked", "failed"),
    "dft_postprocessing": ("dft_review", "blocked", "failed"),
    "dft_review": ("completed", "dft_preparing", "blocked", "failed"),
    "completed": (),
    "blocked": (),
    "failed": (),
}

STAGE_OWNER = {
    "planned": "materials-supervisor",
    "discovering": "materials-discovery",
    "validating": "materials-validator",
    "screening": "materials-screener",
    "awaiting_review": "materials-reviewer",
    "dft_preparing": "materials-dft",
    "dft_running": "materials-dft",
    "dft_postprocessing": "materials-dft",
    "dft_review": "materials-reviewer",
    "completed": "materials-reviewer",
}

TRANSITION_ACTOR = {
    ("planned", "discovering"): "materials-supervisor",
    ("discovering", "validating"): "materials-discovery",
    ("validating", "screening"): "materials-validator",
    ("screening", "awaiting_review"): "materials-screener",
    ("awaiting_review", "dft_preparing"): "materials-reviewer",
    ("awaiting_review", "completed"): "materials-reviewer",
    ("dft_preparing", "dft_running"): "materials-dft",
    ("dft_running", "dft_postprocessing"): "materials-dft",
    ("dft_postprocessing", "dft_review"): "materials-dft",
    ("dft_review", "completed"): "materials-reviewer",
    ("dft_review", "dft_preparing"): "materials-reviewer",
}


class WorkflowError(ValueError):
    """Raised when a workflow transition or learning operation is invalid."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _as_list(values: Iterable[str] | None) -> list[str]:
    return [str(value) for value in (values or []) if str(value).strip()]


def _safe_id(value: str) -> str:
    if not value or "/" in value or "\\" in value or ".." in value:
        raise WorkflowError("invalid workflow id")
    return value


def infer_response_language(goal: str, explicit: str | None = None) -> str:
    requested = str(explicit or "").strip()
    if requested:
        return requested
    if re.search(r"[\u3040-\u30ff]", goal):
        return "ja"
    if re.search(r"[\uac00-\ud7af]", goal):
        return "ko"
    if re.search(r"[\u4e00-\u9fff]", goal):
        return "zh-Hans"
    if re.search(r"[\u0400-\u04ff]", goal):
        return "ru"
    if re.search(r"[\u0600-\u06ff]", goal):
        return "ar"
    if re.search(r"[\u0370-\u03ff]", goal):
        return "el"
    lowered = f" {goal.lower()} "
    latin_markers = {
        "es": (" el ", " la ", " de ", " para ", " que ", " calcular "),
        "fr": (" le ", " la ", " des ", " pour ", " que ", " calculer "),
        "de": (" der ", " die ", " das ", " für ", " und ", " berechnen "),
        "pt": (" os ", " as ", " para ", " que ", " calcular "),
        "it": (" il ", " la ", " per ", " che ", " calcolare "),
    }
    scores = {language: sum(lowered.count(marker) for marker in markers) for language, markers in latin_markers.items()}
    language, score = max(scores.items(), key=lambda item: item[1], default=("en", 0))
    if score:
        return language
    return "en"


@dataclass
class WorkflowRecord:
    workflow_id: str
    goal: str
    constraints: dict[str, Any] = field(default_factory=dict)
    stage: str = "planned"
    status: str = "active"
    schema_version: int = WORKFLOW_SCHEMA_VERSION
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    artifacts: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    history: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class WorkflowCoordinator:
    """File-backed coordinator scoped to the active workspace."""

    _lock = threading.RLock()

    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace.resolve()
        self.root = self.workspace / ".openscience"
        self.store = self.root / "material-workflows"
        self.database = self.root / "materials-workflows.sqlite3"
        self.root.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS workflow_snapshots (
                    workflow_id TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL,
                    data_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workflow_events (
                    event_id TEXT PRIMARY KEY,
                    workflow_id TEXT NOT NULL,
                    event_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS workflow_events_workflow
                    ON workflow_events(workflow_id, created_at);
                """
            )

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.database, timeout=10.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _path(self, workflow_id: str) -> Path:
        return self.store / f"{_safe_id(workflow_id)}.json"

    def _write(self, record: WorkflowRecord, expected_revision: int | None = None) -> None:
        data = record.to_dict()
        if expected_revision is not None:
            data["_revision"] = expected_revision
        self._persist_snapshot(data)
        self._write_json_mirror(data)

    def _write_json_mirror(self, data: dict[str, Any]) -> None:
        self.store.mkdir(parents=True, exist_ok=True)
        target = self._path(str(data["workflow_id"]))
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(data, indent=2, ensure_ascii=True), encoding="utf-8")
        temporary.replace(target)

    def _persist_snapshot(self, data: dict[str, Any]) -> None:
        workflow_id = _safe_id(str(data.get("workflow_id", "")))
        expected_revision = data.get("_revision")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT revision FROM workflow_snapshots WHERE workflow_id = ?", (workflow_id,)
            ).fetchone()
            current_revision = int(row["revision"]) if row else 0
            if expected_revision is not None and int(expected_revision) != current_revision:
                raise WorkflowError(
                    f"workflow revision conflict: expected {expected_revision}, current {current_revision}"
                )
            next_revision = current_revision + 1
            data["_revision"] = next_revision
            connection.execute(
                """
                INSERT INTO workflow_snapshots(workflow_id, revision, data_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(workflow_id) DO UPDATE SET
                    revision = excluded.revision,
                    data_json = excluded.data_json,
                    updated_at = excluded.updated_at
                """,
                (workflow_id, next_revision, json.dumps(data, ensure_ascii=True), _now()),
            )

    def _append_event(self, event: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        event_id = str(event.get("event_id") or "")
        if not event_id:
            raise WorkflowError("workflow event requires event_id")
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO workflow_events(event_id, workflow_id, event_json, created_at) VALUES (?, ?, ?, ?)",
                (event_id, str(event.get("workflow_id") or ""), json.dumps(event, ensure_ascii=True, sort_keys=True), str(event.get("at") or _now())),
            )
        path = self.root / "material-workflow-events.jsonl"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=True, sort_keys=True) + "\n")

    def create(self, goal: str, constraints: dict[str, Any] | None = None) -> dict[str, Any]:
        if not goal or not goal.strip():
            raise WorkflowError("workflow goal is required")
        workflow_id = f"mw_{uuid.uuid4().hex[:16]}"
        record = WorkflowRecord(workflow_id=workflow_id, goal=goal.strip(), constraints=dict(constraints or {}))
        record.history.append({"event": "created", "stage": record.stage, "actor": "materials-supervisor", "at": record.created_at})
        with self._lock:
            self._write(record)
            self._append_event({
                "event_id": f"mwe_{uuid.uuid4().hex[:16]}",
                "event": "created",
                "workflow_id": workflow_id,
                "stage": record.stage,
                "actor": "materials-supervisor",
                "at": record.created_at,
            })
        return record.to_dict()

    def get(self, workflow_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT revision, data_json FROM workflow_snapshots WHERE workflow_id = ?",
                (_safe_id(workflow_id),),
            ).fetchone()
        if row is not None:
            try:
                data = json.loads(str(row["data_json"]))
                data["_revision"] = int(row["revision"])
                return data
            except json.JSONDecodeError as exc:
                raise WorkflowError(f"workflow record is invalid: {workflow_id}") from exc
        path = self._path(workflow_id)
        if not path.is_file():
            raise WorkflowError(f"workflow not found: {workflow_id}")
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise WorkflowError(f"workflow record is invalid: {workflow_id}") from exc

    def advance(
        self,
        workflow_id: str,
        actor: str,
        to_stage: str,
        artifacts: Iterable[str] | None = None,
        evidence: Iterable[str] | None = None,
        outcome: str | None = None,
        note: str = "",
    ) -> dict[str, Any]:
        if to_stage not in WORKFLOW_STAGES:
            raise WorkflowError(f"unknown workflow stage: {to_stage}")
        if not actor or not actor.strip():
            raise WorkflowError("workflow actor is required")
        with self._lock:
            data = self.get(workflow_id)
            current = str(data.get("stage"))
            if to_stage not in TRANSITIONS.get(current, ()):
                raise WorkflowError(f"invalid transition {current} -> {to_stage}")
            expected = STAGE_OWNER.get(to_stage)
            allowed = (
                {expected, "materials-supervisor"}
                if to_stage in {"blocked", "failed"}
                else {TRANSITION_ACTOR.get((current, to_stage), expected)}
            )
            if actor not in allowed:
                raise WorkflowError(f"actor {actor} cannot enter {to_stage}; expected {sorted(allowed)}")
            next_artifacts = _as_list(artifacts)
            next_evidence = _as_list(evidence)
            if to_stage in {"awaiting_review", "dft_preparing", "dft_running", "dft_postprocessing", "dft_review", "completed"} and not next_artifacts:
                raise WorkflowError(f"{to_stage} requires at least one artifact")
            at = _now()
            history_item = {
                "event": "transition",
                "from_stage": current,
                "to_stage": to_stage,
                "actor": actor,
                "outcome": outcome or ("success" if to_stage not in {"blocked", "failed"} else to_stage),
                "note": note.strip(),
                "artifacts": next_artifacts,
                "evidence": next_evidence,
                "at": at,
            }
            record = WorkflowRecord(
                workflow_id=str(data["workflow_id"]),
                goal=str(data["goal"]),
                constraints=dict(data.get("constraints") or {}),
                stage=to_stage,
                status="terminal" if to_stage in {"completed", "blocked", "failed"} else "active",
                schema_version=int(data.get("schema_version", WORKFLOW_SCHEMA_VERSION)),
                created_at=str(data.get("created_at", at)),
                updated_at=at,
                artifacts=list(data.get("artifacts") or []) + next_artifacts,
                evidence=list(data.get("evidence") or []) + next_evidence,
                history=list(data.get("history") or []) + [history_item],
            )
            self._write(record, int(data.get("_revision")) if data.get("_revision") is not None else None)
            self._append_event({
                "event_id": f"mwe_{uuid.uuid4().hex[:16]}",
                "workflow_id": workflow_id,
                **history_item,
            })
            return record.to_dict()


TASK_TERMINAL = {"completed", "review", "failed", "blocked", "skipped", "dead_letter"}
TASK_SUCCESS = {"completed", "review", "skipped"}
VASPKIT_TASK_FAMILIES = {
    "kpoints",
    "band_path",
    "dos_band",
    "electronic_analysis",
    "thermochemistry",
    "aimd",
    "mechanical",
}
HER_OBJECTIVE_RE = re.compile(
    r"(?:\bher\b|hydrogen evolution|delta\s*g[_\s-]*h|析氢|氢吸附自由能)",
    re.IGNORECASE,
)


class MaterialsDAGCoordinator(WorkflowCoordinator):
    """A durable task DAG coordinator layered on the v1 stage state machine."""

    def _write_data(self, data: dict[str, Any]) -> None:
        self._persist_snapshot(data)
        self._write_json_mirror(data)

    def _artifact_path(self, value: str) -> Path:
        candidate = Path(value)
        resolved = (
            (self.workspace / candidate).resolve()
            if not candidate.is_absolute()
            else candidate.resolve()
        )
        if resolved == self.workspace or self.workspace not in resolved.parents:
            raise WorkflowError("artifact path must stay inside the active workspace")
        return resolved

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _read_json_artifact(self, value: str) -> tuple[Path, dict[str, Any]]:
        path = self._artifact_path(value)
        if not path.is_file() or path.suffix.lower() != ".json":
            raise WorkflowError(f"required JSON artifact is missing: {value}")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise WorkflowError(f"JSON artifact is unreadable: {value}") from exc
        if not isinstance(payload, dict):
            raise WorkflowError(f"JSON artifact must contain an object: {value}")
        return path, payload

    def _design_snapshot(self, data: dict[str, Any], iteration: int) -> dict[str, Any] | None:
        snapshots = data.get("design_snapshots") or {}
        value = snapshots.get(str(iteration)) if isinstance(snapshots, dict) else None
        return dict(value) if isinstance(value, dict) else None

    def _snapshot_hashes_intact(self, snapshot: dict[str, Any]) -> bool:
        try:
            candidate_path = self._artifact_path(str(snapshot["candidate_artifact"]))
            graph_path = self._artifact_path(str(snapshot["evidence_graph_artifact"]))
            return (
                candidate_path.is_file()
                and graph_path.is_file()
                and self._sha256_file(candidate_path) == snapshot["candidate_sha256"]
                and self._sha256_file(graph_path) == snapshot["evidence_graph_sha256"]
            )
        except (KeyError, OSError, WorkflowError):
            return False

    @staticmethod
    def _latest_novelty_audit(data: dict[str, Any], iteration: int) -> dict[str, Any] | None:
        audits = [
            row
            for row in data.get("novelty_audits", [])
            if isinstance(row, dict) and int(row.get("iteration", 0)) == iteration
        ]
        return dict(audits[-1]) if audits else None

    def _gate_ready(self, data: dict[str, Any], task: dict[str, Any]) -> bool:
        gate = task.get("gate")
        if not isinstance(gate, dict):
            return True
        if gate.get("kind") != "novelty_audit":
            return False
        iteration = int(gate.get("iteration", 0))
        snapshot = self._design_snapshot(data, iteration)
        audit = self._latest_novelty_audit(data, iteration)
        if not snapshot or not audit or audit.get("decision") not in {"pass", "pass_with_exclusions"}:
            return False
        novelty_intact = (
            self._snapshot_hashes_intact(snapshot)
            and snapshot.get("candidate_sha256") == audit.get("candidate_sha256")
            and snapshot.get("evidence_graph_sha256") == audit.get("evidence_graph_sha256")
            and snapshot.get("graph_hash") == audit.get("graph_hash")
        )
        if not novelty_intact:
            return False
        task_id = str(task.get("task_id") or "")
        if not any(task_id.startswith(prefix) for prefix in ("design:audit:", "dft:", "synthesis:", "experiment:")):
            return True
        physics = (data.get("physics_screens") or {}).get(str(iteration))
        if not isinstance(physics, dict):
            return False
        try:
            physics_path = self._artifact_path(str(physics["artifact"]))
            return (
                physics_path.is_file()
                and self._sha256_file(physics_path) == physics["artifact_sha256"]
                and physics.get("candidate_sha256") == snapshot.get("candidate_sha256")
                and physics.get("evidence_graph_hash") == snapshot.get("graph_hash")
            )
        except (KeyError, OSError, WorkflowError):
            return False

    def _find_artifact(self, artifacts: Iterable[str], expected: str) -> str:
        expected_path = self._artifact_path(expected)
        for artifact in artifacts:
            try:
                if self._artifact_path(str(artifact)) == expected_path:
                    return str(artifact)
            except WorkflowError:
                continue
        raise WorkflowError(f"task output must include {expected}")

    def _find_artifact_by_name(self, artifacts: Iterable[str], filename: str) -> str:
        for artifact in reversed(_as_list(artifacts)):
            try:
                path = self._artifact_path(str(artifact))
            except WorkflowError:
                continue
            if path.name.lower() == filename.lower():
                return str(artifact)
        raise WorkflowError(f"task output must include {filename}")

    def _dft_engine(self, artifacts: Iterable[str]) -> str:
        spec_artifact = self._find_artifact_by_name(artifacts, "DFTRunSpec.json")
        _, spec = self._read_json_artifact(spec_artifact)
        engine = str(spec.get("code") or spec.get("engine") or "").strip().lower()
        if not engine:
            raise WorkflowError("DFTRunSpec.json must identify code or engine")
        return engine

    def _validate_dft_cost_audit(self, artifacts: Iterable[str], data: dict[str, Any]) -> dict[str, Any]:
        audit_artifact = self._find_artifact_by_name(artifacts, "dft-cost-estimate.json")
        spec_artifact = self._find_artifact_by_name(artifacts, "DFTRunSpec.json")
        spec_path, _ = self._read_json_artifact(spec_artifact)
        audit_path, audit = self._read_json_artifact(audit_artifact)
        errors = validate_cost_estimate(audit, spec_path)
        if errors:
            raise WorkflowError("invalid DFT cost audit: " + "; ".join(errors))
        for item in audit.get("model_artifacts", []):
            if not isinstance(item, dict):
                raise WorkflowError("DFT cost audit contains an invalid model artifact")
            model_path = str(item.get("path") or "")
            path = self._artifact_path(model_path)
            if not path.is_file() or self._sha256_file(path) != item.get("sha256"):
                raise WorkflowError(f"DFT cost audit model hash does not match {model_path}")
        data.setdefault("dft_cost_audits", []).append({
            "artifact": audit_artifact,
            "sha256": self._sha256_file(audit_path),
            "spec": spec_artifact,
            "at": _now(),
        })
        return audit

    def _validate_dft_model_audit(self, artifacts: Iterable[str]) -> dict[str, Any]:
        audit_artifact = self._find_artifact_by_name(artifacts, "dft-model-audit.json")
        spec_artifact = self._find_artifact_by_name(artifacts, "DFTRunSpec.json")
        spec_path, _ = self._read_json_artifact(spec_artifact)
        _, audit = self._read_json_artifact(audit_artifact)
        errors = validate_model_audit(audit, spec_path)
        if errors:
            raise WorkflowError("invalid DFT model audit: " + "; ".join(errors))
        if audit.get("status") == "blocked":
            raise WorkflowError("blocked DFT model audit cannot release human review")
        return audit

    def _require_dft_approval(self, data: dict[str, Any], artifacts: Iterable[str]) -> None:
        approval = data.get("dft_approval")
        if not isinstance(approval, dict) or approval.get("decision") != "approved":
            raise WorkflowError("DFT submission requires explicit human approval")
        current = _as_list(artifacts)
        for field, filename in (("spec_artifact", "DFTRunSpec.json"), ("model_audit_artifact", "dft-model-audit.json"), ("cost_audit_artifact", "dft-cost-estimate.json")):
            expected = str(approval.get(field) or "")
            if not expected or expected not in current:
                raise WorkflowError(f"human approval is missing current {filename}")
            path = self._artifact_path(expected)
            if self._sha256_file(path) != approval.get(field.replace("_artifact", "_sha256")):
                raise WorkflowError("human approval hash does not match current DFT artifacts")

    def record_dft_human_review(
        self,
        workflow_id: str,
        task_id: str,
        actor: str,
        decision: str,
        note: str = "",
        requested_changes: list[str] | None = None,
    ) -> dict[str, Any]:
        if not actor.startswith("human:"):
            raise WorkflowError("DFT model approval must be recorded by human:<id>")
        if decision not in {"approved", "changes_requested", "rejected"}:
            raise WorkflowError("DFT human decision must be approved, changes_requested, or rejected")
        with self._lock:
            data, by_id = self._load_tasks(workflow_id)
            task = by_id.get(_safe_id(task_id))
            if task is None or task.get("role") != "human" or task.get("status") != "running" or task.get("claimed_by") != actor:
                raise WorkflowError("DFT human-review task must be claimed by the named human")
            suffix = task_id[len("dft:human-review"):]
            prepare_id = "dft:prepare" + suffix
            audit_id = "dft:audit" + suffix
            prepare = by_id.get(prepare_id) or {}
            audit_task = by_id.get(audit_id) or {}
            prepare_artifacts = _as_list((prepare.get("output") or {}).get("artifacts"))
            audit_artifacts = _as_list((audit_task.get("output") or {}).get("artifacts"))
            all_artifacts = [*prepare_artifacts, *audit_artifacts]
            spec_artifact = self._find_artifact_by_name(all_artifacts, "DFTRunSpec.json")
            model_artifact = self._find_artifact_by_name(all_artifacts, "dft-model-audit.json")
            cost_artifact = self._find_artifact_by_name(all_artifacts, "dft-cost-estimate.json")
            self._validate_dft_model_audit(all_artifacts)
            self._validate_dft_cost_audit(all_artifacts, data)
            paths = {name: self._artifact_path(value) for name, value in (("spec", spec_artifact), ("model", model_artifact), ("cost", cost_artifact))}
            review = {
                "review_id": f"dft-human-{uuid.uuid4().hex[:12]}",
                "task_id": task_id,
                "actor": actor,
                "decision": decision,
                "note": note.strip(),
                "requested_changes": _as_list(requested_changes),
                "spec_artifact": spec_artifact,
                "spec_sha256": self._sha256_file(paths["spec"]),
                "model_audit_artifact": model_artifact,
                "model_audit_sha256": self._sha256_file(paths["model"]),
                "cost_audit_artifact": cost_artifact,
                "cost_audit_sha256": self._sha256_file(paths["cost"]),
                "at": _now(),
            }
            data.setdefault("dft_human_reviews", []).append(review)
            data["dft_approval"] = review if decision == "approved" else {"decision": decision, "review_id": review["review_id"], "actor": actor, "at": review["at"]}
            if decision == "changes_requested":
                # A revision must create new artifacts and a new approval hash;
                # no old preparation, audit, or approval may release a job.
                for reset_id in (prepare_id, audit_id, task_id):
                    reset = by_id.get(reset_id)
                    if reset:
                        reset.update({"status": "pending", "claimed_by": None, "lease_until": None, "heartbeat_at": None, "output": None, "output_hash": None, "updated_at": _now()})
                data["dft_approval"] = None
                data["status"] = "active"
            elif decision == "rejected":
                task["status"] = "blocked"
                task["claimed_by"] = None
                data["status"] = "blocked"
            else:
                task["status"] = "completed"
                task["output"] = {"decision": decision, "review_id": review["review_id"], "artifacts": [spec_artifact, model_artifact, cost_artifact], "response_language": data.get("response_language", "en")}
                task["output_hash"] = hashlib.sha256(json.dumps(task["output"], sort_keys=True).encode()).hexdigest()
                task["claimed_by"] = None
            task["lease_until"] = None
            task["heartbeat_at"] = _now()
            task["updated_at"] = _now()
            data["updated_at"] = _now()
            self._write_data(data)
            self._append_event({"event_id": f"mwe_{uuid.uuid4().hex[:16]}", "event": "dft_human_review", "workflow_id": workflow_id, **review})
            return review

    def _require_file_artifact(self, artifacts: Iterable[str], value: str, label: str) -> str:
        required_path = self._artifact_path(value)
        if not required_path.is_file():
            raise WorkflowError(f"{label} is missing from the workspace: {value}")
        for artifact in _as_list(artifacts):
            try:
                if self._artifact_path(artifact) == required_path:
                    return artifact
            except WorkflowError:
                continue
        raise WorkflowError(f"{label} must be attached as a task artifact: {value}")

    def _validate_vaspkit_plan(
        self,
        artifacts: Iterable[str],
        *,
        final: bool,
        objective: str = "",
        output_artifacts: Iterable[str] | None = None,
    ) -> dict[str, Any]:
        artifacts = _as_list(artifacts)
        output_artifacts = _as_list(output_artifacts) if output_artifacts is not None else artifacts
        plan_artifact = self._find_artifact_by_name(artifacts, "vaspkit-plan.json")
        _, plan = self._read_json_artifact(plan_artifact)
        if plan.get("schema_version") != 1 or plan.get("engine") != "vasp" or plan.get("tool") != "vaspkit":
            raise WorkflowError("vaspkit-plan.json must use schema 1 and bind VASP to VASPKIT")
        if plan.get("execution_target") != "remote-compute":
            raise WorkflowError("VASPKIT must use the remote-compute execution boundary")
        if not str(plan.get("reason") or "").strip():
            raise WorkflowError("vaspkit-plan.json must record a scientific reason")
        tasks = plan.get("task_families")
        if not isinstance(tasks, list):
            raise WorkflowError("vaspkit-plan.json task_families must be a list")
        plan_objective = str(plan.get("objective") or "").strip()
        if not plan_objective:
            raise WorkflowError("vaspkit-plan.json must preserve the VASP objective")
        her_required = bool(HER_OBJECTIVE_RE.search(f"{objective}\n{plan_objective}"))
        status = plan.get("status")
        allowed = {"completed", "not_applicable"} if final else {"planned", "completed", "not_applicable"}
        if status not in allowed:
            raise WorkflowError(f"VASPKIT plan status {status!r} cannot complete this DFT stage")
        if status == "not_applicable":
            if her_required:
                raise WorkflowError("HER VASP workflows require a thermochemistry task family")
            if tasks:
                raise WorkflowError("a not_applicable VASPKIT plan cannot contain task families")
            return {"artifact": plan_artifact, "status": status, "task_count": 0}
        if not tasks:
            raise WorkflowError(f"VASPKIT plan status {status!r} requires task families")
        families = set()
        for index, task in enumerate(tasks):
            if not isinstance(task, dict):
                raise WorkflowError(f"VASPKIT task_families[{index}] must be an object")
            family = task.get("family")
            if family not in VASPKIT_TASK_FAMILIES:
                raise WorkflowError(f"VASPKIT task_families[{index}].family is unsupported")
            if task.get("status") not in {"planned", "completed", "not_applicable"}:
                raise WorkflowError(f"VASPKIT task_families[{index}].status is invalid")
            families.add(family)
        if her_required and "thermochemistry" not in families:
            raise WorkflowError("HER VASP workflows require a thermochemistry task family")
        if not final and status == "planned":
            return {"artifact": plan_artifact, "status": status, "task_count": len(tasks)}

        completed_tasks = []
        for index, task in enumerate(tasks):
            task_status = task.get("status")
            if task_status not in {"completed", "not_applicable"}:
                raise WorkflowError(f"VASPKIT task_families[{index}] is unresolved")
            if task_status == "not_applicable":
                if not str(task.get("reason") or "").strip():
                    raise WorkflowError(f"VASPKIT task_families[{index}] needs a not_applicable reason")
                continue
            completed_tasks.append(task)
            for field in ("input_files", "commands_or_menu_answers", "generated_outputs"):
                if not isinstance(task.get(field), list) or not task[field]:
                    raise WorkflowError(f"VASPKIT task_families[{index}].{field} is required")
            if not str(task.get("log_file") or "").strip():
                raise WorkflowError(f"VASPKIT task_families[{index}].log_file is required")
            for input_file in task["input_files"]:
                self._require_file_artifact(artifacts, str(input_file), f"VASPKIT task_families[{index}] input")
            self._require_file_artifact(
                output_artifacts,
                str(task["log_file"]),
                f"VASPKIT task_families[{index}] log",
            )
            for generated_output in task["generated_outputs"]:
                self._require_file_artifact(
                    output_artifacts,
                    str(generated_output),
                    f"VASPKIT task_families[{index}] generated output",
                )
        if completed_tasks:
            preflight = plan.get("preflight")
            if not isinstance(preflight, dict) or preflight.get("status") != "passed" or not str(preflight.get("artifact") or "").strip():
                raise WorkflowError("completed VASPKIT tasks require a passed preflight artifact")
            self._require_file_artifact(
                output_artifacts,
                str(preflight["artifact"]),
                "VASPKIT preflight",
            )
            if not str(plan.get("vaspkit_version") or "").strip() or not str(plan.get("executable") or "").strip():
                raise WorkflowError("completed VASPKIT tasks require version and executable provenance")
            reference_sensitive = {"thermochemistry", "dos_band", "electronic_analysis"}
            if any(task.get("family") in reference_sensitive for task in completed_tasks):
                if not str(plan.get("energy_reference") or "").strip() or not plan.get("units"):
                    raise WorkflowError("completed VASPKIT thermochemistry/electronic analysis requires energy reference and units")
        return {"artifact": plan_artifact, "status": status, "task_count": len(tasks)}

    def _validate_design_brief(self, artifacts: Iterable[str]) -> dict[str, Any]:
        graph_artifact = self._find_artifact(
            artifacts, "materials/design/mechanism-failure-graph.json"
        )
        _, graph = self._read_json_artifact(graph_artifact)
        try:
            compiled = compile_evidence_graph(graph)
        except EvidenceGraphError as exc:
            raise WorkflowError(f"mechanism/failure evidence graph is invalid: {exc}") from exc
        if graph.get("graph_hash") and graph["graph_hash"] != compiled["graph_hash"]:
            raise WorkflowError("mechanism/failure evidence graph hash is stale")
        return {
            "evidence_graph_artifact": graph_artifact,
            "evidence_graph_sha256": self._sha256_file(self._artifact_path(graph_artifact)),
            "graph_hash": compiled["graph_hash"],
        }

    def _validate_physics_screen(self, data: dict[str, Any], iteration: int, artifacts: Iterable[str]) -> dict[str, Any]:
        expected = f"materials/design/iteration-{iteration}/pre-dft-physics-screen.json"
        artifact = self._find_artifact(artifacts, expected)
        _, payload = self._read_json_artifact(artifact)
        snapshot = self._design_snapshot(data, iteration)
        if not snapshot:
            raise WorkflowError("candidate snapshot is missing for the physics screen")
        if int(payload.get("iteration", 0)) != iteration:
            raise WorkflowError("physics screen iteration does not match its task")
        if payload.get("candidate_sha256") != snapshot.get("candidate_sha256"):
            raise WorkflowError("physics screen is not bound to the frozen candidate hash")
        if payload.get("evidence_graph_hash") != snapshot.get("graph_hash"):
            raise WorkflowError("physics screen is not bound to the frozen evidence graph hash")
        screens = payload.get("screens")
        if not isinstance(screens, list):
            raise WorkflowError("physics screen artifact must contain screens")
        expected_ids = set(snapshot.get("candidate_ids", []))
        seen_ids: set[str] = set()
        for screen in screens:
            if not isinstance(screen, dict):
                raise WorkflowError("every physics screen must be an object")
            candidate_id = str(screen.get("candidate_id") or "")
            if candidate_id not in expected_ids or candidate_id in seen_ids:
                raise WorkflowError(f"unexpected or duplicate physics screen candidate: {candidate_id}")
            if screen.get("decision") not in {"reject", "hold", "promote_to_dft"}:
                raise WorkflowError("physics screen decision must be reject, hold, or promote_to_dft")
            if not isinstance(screen.get("findings"), list) or not isinstance(screen.get("uncertainty"), dict):
                raise WorkflowError("physics screen must preserve findings and uncertainty")
            seen_ids.add(candidate_id)
        if seen_ids != expected_ids:
            raise WorkflowError("physics screen must cover every frozen candidate")
        return {
            "artifact": artifact,
            "artifact_sha256": self._sha256_file(self._artifact_path(artifact)),
            "candidate_sha256": payload["candidate_sha256"],
            "evidence_graph_hash": payload["evidence_graph_hash"],
            "candidate_ids": sorted(seen_ids),
            "decisions": {str(screen["candidate_id"]): screen["decision"] for screen in screens},
        }

    def _freeze_design_snapshot(
        self,
        data: dict[str, Any],
        iteration: int,
        artifacts: Iterable[str],
    ) -> dict[str, Any]:
        expected = f"materials/design/iteration-{iteration}/candidates.json"
        candidate_artifact = self._find_artifact(artifacts, expected)
        candidate_path, payload = self._read_json_artifact(candidate_artifact)
        if int(payload.get("iteration", 0)) != iteration:
            raise WorkflowError("candidate artifact iteration does not match its task")
        graph_artifact = str(payload.get("evidence_graph_path") or "")
        if not graph_artifact:
            raise WorkflowError("candidate artifact requires evidence_graph_path")
        graph_path, graph = self._read_json_artifact(graph_artifact)
        try:
            compiled_graph = compile_evidence_graph(graph)
        except EvidenceGraphError as exc:
            raise WorkflowError(f"candidate evidence graph is invalid: {exc}") from exc
        if graph.get("graph_hash") and graph["graph_hash"] != compiled_graph["graph_hash"]:
            raise WorkflowError("candidate evidence graph hash is stale")
        design_brief = data.get("design_brief")
        if not isinstance(design_brief, dict):
            raise WorkflowError("the frozen design brief is missing")
        if (
            self._artifact_path(str(design_brief.get("evidence_graph_artifact") or "")) != graph_path
            or design_brief.get("evidence_graph_sha256") != self._sha256_file(graph_path)
            or design_brief.get("graph_hash") != compiled_graph["graph_hash"]
        ):
            raise WorkflowError("candidate artifact must reference the unchanged design-brief evidence graph")
        candidates = payload.get("candidates")
        if not isinstance(candidates, list) or len(candidates) < 3:
            raise WorkflowError("candidate artifact must contain at least three candidates")
        reports = [validate_design_candidate(candidate, compiled_graph) for candidate in candidates]
        invalid = [report for report in reports if not report.get("valid")]
        if invalid:
            messages = [
                finding.get("message", "invalid candidate")
                for report in invalid
                for finding in report.get("findings", [])
                if finding.get("level") == "error"
            ]
            raise WorkflowError(f"candidate operator validation failed: {'; '.join(messages[:8])}")
        candidate_ids = [str(report["candidate_id"]) for report in reports]
        if len(set(candidate_ids)) != len(candidate_ids):
            raise WorkflowError("candidate ids must be unique")
        snapshot = {
            "iteration": iteration,
            "candidate_artifact": candidate_path.relative_to(self.workspace).as_posix(),
            "candidate_sha256": self._sha256_file(candidate_path),
            "candidate_ids": candidate_ids,
            "evidence_graph_artifact": graph_path.relative_to(self.workspace).as_posix(),
            "evidence_graph_sha256": self._sha256_file(graph_path),
            "graph_hash": compiled_graph["graph_hash"],
            "operator_reports": reports,
            "frozen_at": _now(),
        }
        snapshots = dict(data.get("design_snapshots") or {})
        snapshots[str(iteration)] = snapshot
        data["design_snapshots"] = snapshots
        return snapshot

    def record_novelty_audit(
        self,
        workflow_id: str,
        iteration: int,
        auditor: str,
        search_scope: dict[str, Any],
        candidate_results: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if auditor != "materials-novelty-auditor":
            raise WorkflowError("novelty audit requires the isolated materials-novelty-auditor")
        iteration = int(iteration)
        if iteration <= 0:
            raise WorkflowError("iteration must be positive")
        with self._lock:
            data, by_id = self._load_tasks(workflow_id)
            task_id = f"design:novelty:{iteration}"
            task = by_id.get(task_id) or {}
            if task.get("role") != auditor or task.get("status") != "running" or task.get("claimed_by") != auditor:
                raise WorkflowError("novelty task must be claimed by materials-novelty-auditor")
            snapshot = self._design_snapshot(data, iteration)
            if not snapshot:
                raise WorkflowError("candidate snapshot is missing")
            candidate_path = self._artifact_path(str(snapshot["candidate_artifact"]))
            current_hash = self._sha256_file(candidate_path) if candidate_path.is_file() else ""
            if current_hash != snapshot["candidate_sha256"]:
                raise WorkflowError("candidate artifact changed after Designer completion")
            graph_path = self._artifact_path(str(snapshot["evidence_graph_artifact"]))
            graph_file_hash = self._sha256_file(graph_path) if graph_path.is_file() else ""
            if graph_file_hash != snapshot["evidence_graph_sha256"]:
                raise WorkflowError("evidence graph changed after Designer completion")

            queries = search_scope.get("queries") if isinstance(search_scope, dict) else None
            if not isinstance(queries, list) or not queries:
                raise WorkflowError("novelty search_scope.queries must be non-empty")
            query_types: set[str] = set()
            providers: set[str] = set()
            candidate_query_types: dict[str, set[str]] = {
                candidate_id: set() for candidate_id in snapshot["candidate_ids"]
            }
            normalized_queries: list[dict[str, Any]] = []
            for query in queries:
                if not isinstance(query, dict):
                    raise WorkflowError("every novelty query must be an object")
                query_type = str(query.get("query_type") or "")
                provider = str(query.get("provider") or "").strip()
                status = str(query.get("status") or "")
                text = str(query.get("query") or "").strip()
                executed_at = str(query.get("executed_at") or "").strip()
                result_count = query.get("result_count")
                candidate_ids = query.get("candidate_ids")
                if query_type not in {"exact", "near_neighbor"}:
                    raise WorkflowError("novelty query_type must be exact or near_neighbor")
                if not provider or not text or not executed_at:
                    raise WorkflowError("novelty queries require provider, query, and executed_at")
                if status not in {"completed", "not_found"}:
                    raise WorkflowError("failed novelty queries cannot support a novelty decision")
                if isinstance(result_count, bool) or not isinstance(result_count, int) or result_count < 0:
                    raise WorkflowError("novelty query result_count must be a non-negative integer")
                if (
                    not isinstance(candidate_ids, list)
                    or not candidate_ids
                    or any(candidate_id not in candidate_query_types for candidate_id in candidate_ids)
                ):
                    raise WorkflowError("novelty queries require valid candidate_ids")
                query_types.add(query_type)
                providers.add(provider)
                for candidate_id in candidate_ids:
                    candidate_query_types[candidate_id].add(query_type)
                normalized_queries.append({
                    "query_type": query_type,
                    "provider": provider,
                    "query": text,
                    "executed_at": executed_at,
                    "status": status,
                    "result_count": result_count,
                    "candidate_ids": sorted(set(candidate_ids)),
                })
            if query_types != {"exact", "near_neighbor"}:
                raise WorkflowError("novelty audit requires exact and near-neighbor queries")
            if len(providers) < 2:
                raise WorkflowError("novelty audit requires at least two independent sources")
            uncovered = sorted(
                candidate_id
                for candidate_id, covered_types in candidate_query_types.items()
                if covered_types != {"exact", "near_neighbor"}
            )
            if uncovered:
                raise WorkflowError(
                    f"novelty queries do not cover every candidate with both query types: {', '.join(uncovered)}"
                )

            if not isinstance(candidate_results, list):
                raise WorkflowError("candidate_results must be a list")
            normalized_results: list[dict[str, Any]] = []
            seen: set[str] = set()
            blocked = False
            excluded = False
            survivors: list[str] = []
            for result in candidate_results:
                if not isinstance(result, dict):
                    raise WorkflowError("every novelty candidate result must be an object")
                candidate_id = str(result.get("candidate_id") or "")
                if candidate_id not in snapshot["candidate_ids"] or candidate_id in seen:
                    raise WorkflowError(f"unexpected or duplicate novelty candidate: {candidate_id}")
                seen.add(candidate_id)
                verdict = str(result.get("verdict") or "")
                if verdict not in {"no_collision_found", "collision", "insufficient_search"}:
                    raise WorkflowError("invalid novelty verdict")
                exact_matches = result.get("exact_matches") or []
                near_neighbors = result.get("near_neighbors") or []
                if not isinstance(exact_matches, list) or not isinstance(near_neighbors, list):
                    raise WorkflowError("novelty matches must be lists")
                if any(
                    not isinstance(match, dict) or not str(match.get("reference") or "").strip()
                    for match in exact_matches + near_neighbors
                ):
                    raise WorkflowError("novelty matches require source references")
                is_excluded = bool(result.get("excluded", False))
                if verdict == "collision" and not exact_matches:
                    raise WorkflowError("a collision verdict requires exact_matches")
                if verdict == "no_collision_found" and exact_matches:
                    raise WorkflowError("no_collision_found cannot include exact_matches")
                if verdict == "collision" and not is_excluded:
                    blocked = True
                if verdict == "insufficient_search":
                    blocked = True
                if is_excluded:
                    excluded = True
                elif verdict == "no_collision_found":
                    survivors.append(candidate_id)
                statement = str(result.get("bounded_statement") or "").strip()
                if not statement:
                    raise WorkflowError("every novelty result requires a bounded_statement")
                if verdict == "no_collision_found":
                    statement = "No collision was found in the recorded search scope; this result does not establish novelty."
                elif verdict == "insufficient_search":
                    statement = "The recorded search scope is insufficient for a bounded collision assessment."
                normalized_results.append({
                    "candidate_id": candidate_id,
                    "verdict": verdict,
                    "excluded": is_excluded,
                    "exact_matches": exact_matches,
                    "near_neighbors": near_neighbors,
                    "bounded_statement": statement,
                })
            if seen != set(snapshot["candidate_ids"]):
                raise WorkflowError("novelty audit must cover every frozen candidate")
            if not survivors:
                blocked = True
            decision = "blocked" if blocked else "pass_with_exclusions" if excluded else "pass"
            prior = [
                row for row in data.get("novelty_audits", [])
                if isinstance(row, dict) and int(row.get("iteration", 0)) == iteration
            ]
            revision = len(prior) + 1
            artifact = f"materials/design/iteration-{iteration}/novelty-audit-r{revision}.json"
            record = {
                "schema_version": 1,
                "audit_id": f"mna_{uuid.uuid4().hex[:16]}",
                "workflow_id": workflow_id,
                "iteration": iteration,
                "revision": revision,
                "auditor": auditor,
                "candidate_artifact": snapshot["candidate_artifact"],
                "candidate_sha256": snapshot["candidate_sha256"],
                "evidence_graph_artifact": snapshot["evidence_graph_artifact"],
                "evidence_graph_sha256": snapshot["evidence_graph_sha256"],
                "graph_hash": snapshot["graph_hash"],
                "search_scope": {"queries": normalized_queries, "providers": sorted(providers)},
                "candidate_results": normalized_results,
                "surviving_candidate_ids": survivors,
                "decision": decision,
                "artifact": artifact,
                "created_at": _now(),
            }
            output_path = self._artifact_path(artifact)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = output_path.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(record, indent=2, ensure_ascii=True), encoding="utf-8")
            temporary.replace(output_path)
            audits = [row for row in data.get("novelty_audits", []) if isinstance(row, dict)]
            audits.append(record)
            data["novelty_audits"] = audits
            data["updated_at"] = _now()
            self._write_data(data)
            self._append_event({
                "event_id": f"mwe_{uuid.uuid4().hex[:16]}",
                "event": "novelty_audit_recorded",
                "workflow_id": workflow_id,
                "task_id": task_id,
                "audit_id": record["audit_id"],
                "candidate_sha256": record["candidate_sha256"],
                "decision": decision,
                "at": _now(),
            })
            return record

    @staticmethod
    def _task(
        task_id: str,
        role: str,
        objective: str,
        dependencies: Iterable[str] = (),
        acceptance_tests: Iterable[str] = (),
        continue_on_failure: bool = False,
        min_successful_dependencies: int | None = None,
        max_attempts: int = 3,
        lease_seconds: int = 300,
        background: bool = False,
        gate: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "task_id": task_id,
            "role": role,
            "objective": objective,
            "dependencies": _as_list(dependencies),
            "acceptance_tests": _as_list(acceptance_tests),
            "continue_on_failure": continue_on_failure,
            "dependency_policy": "quorum" if min_successful_dependencies is not None else ("allow_partial" if continue_on_failure else "all_success"),
            "min_successful_dependencies": min_successful_dependencies,
            "max_attempts": max(1, int(max_attempts)),
            "lease_seconds": max(5, int(lease_seconds)),
            "lease_until": None,
            "heartbeat_at": None,
            "dead_letter": None,
            "background": bool(background),
            "gate": dict(gate) if gate else None,
            "status": "pending",
            "attempt": 0,
            "input": None,
            "output": None,
            "claimed_by": None,
            "created_at": _now(),
            "updated_at": _now(),
        }

    def _design_iteration_tasks(
        self,
        iteration: int,
        dependency: str,
        include_dft: bool,
        domain_profile: str = "general",
    ) -> tuple[list[dict[str, Any]], str]:
        suffix = str(iteration)
        tasks: list[dict[str, Any]] = []
        candidate_dependency = dependency
        if iteration == 1:
            tasks.append(self._task(
                "design:brief",
                "materials-designer",
                "Turn reviewed benchmark materials into an advantage-gap-mechanism design brief without copying a known composition.",
                [dependency],
                ["advantages_and_failures_cited", "computable_mechanism_failure_graph", "hypotheses_separated_from_evidence", "design_constraints_frozen"],
            ))
            candidate_dependency = "design:brief"

        candidates = f"design:candidates:{suffix}"
        structure = f"design:structure:{suffix}"
        novelty = f"design:novelty:{suffix}"
        validation = f"design:validate:{suffix}"
        physics = f"design:physics:{suffix}"
        audit = f"design:audit:{suffix}"
        iteration_gate = {"kind": "novelty_audit", "iteration": iteration}
        tasks.extend([
            self._task(
                candidates,
                "materials-designer",
                "Propose at least three distinct, falsifiable design candidates and explain how each preserves benchmark advantages while addressing a documented failure mode.",
                [candidate_dependency],
                ["three_or_more_candidates", "registered_operators_only", "operator_lineage_computable", "mechanism_risk_and_falsifier_per_candidate", "no_superiority_claim_without_measurement"],
            ),
            self._task(
                structure,
                "materials-structure-compiler",
                "Compile each frozen candidate from an explicit atomistic specification into validated bulk CIF/POSCAR, normalized render JSON, and requested surface/interface structures; return hold when coordinates are underspecified.",
                [candidates],
                ["all_candidates_compiled_or_held", "cif_and_poscar_hashes_recorded", "periodic_minimum_distance_checked", "explicit_bond_graph_recorded", "surface_and_interface_constraints_checked"],
            ),
            self._task(
                novelty,
                "materials-novelty-auditor",
                "Independently audit the frozen candidate snapshot against exact and near-neighbour literature and crystal-database records without editing or redesigning it.",
                [candidates],
                ["candidate_hash_verified", "exact_and_near_neighbor_queries", "two_or_more_sources", "collisions_and_exclusions_recorded", "bounded_novelty_statement"],
            ),
            self._task(
                validation,
                "materials-validator",
                "Run deterministic formula, charge, structure, unit, and constraint checks on novelty-surviving candidates before ranking them.",
                [candidates, novelty, structure],
                ["all_designed_candidates_checked", "invalid_candidates_preserved_with_reasons", "uncertainty_explicit"],
                gate=iteration_gate,
            ),
            self._task(
                physics,
                "materials-physics-screener",
                "Run deterministic pre-DFT hard-constraint, local-chemistry, thermodynamic, aqueous-stability, and OER descriptor screening without treating missing data as a negative result.",
                [validation, novelty, structure],
                ["hard_constraints_checked", "evidence_classes_recorded", "missing_data_explicit", "reject_hold_or_promote_to_dft_decision"],
                gate=iteration_gate,
            ),
            self._task(
                audit,
                "materials-reviewer:design",
                "Independently audit the mechanism graph, operator lineage, deterministic validation, pre-DFT physics screen, synthesizability risks, and falsification tests while preserving the separate novelty verdict.",
                [validation, physics, novelty],
                ["independent_design_audit", "pre_dft_decision_checked", "novelty_verdict_not_overridden", "unsupported_claims_flagged", "one_candidate_or_stop_decision"],
                gate=iteration_gate,
            ),
        ])

        synthesis_dependency = audit
        if include_dft:
            prepare = f"dft:prepare:{suffix}"
            dft_audit = f"dft:audit:{suffix}"
            human_review = f"dft:human-review:{suffix}"
            run = f"dft:run:{suffix}"
            parse = f"dft:parse:{suffix}"
            postprocess = f"dft:postprocess:{suffix}"
            dft_review = f"dft:review:{suffix}"
            tasks.extend([
                self._task(prepare, "materials-dft", "Freeze a versioned DFTRunSpec and pass the selected AICC engine preflight for the reviewed designed candidate; VASP also requires a versioned VASPKIT plan.", [audit], ["design_review_passed", "spec_valid", "aicc_preflight_passed", "preflight_waiver_resolved", "vaspkit_plan_recorded_for_vasp"], gate=iteration_gate),
                self._task(dft_audit, "materials-validator", "Independently audit the frozen designed-candidate model, parameters, resource assumptions, elapsed-time estimate, and cost at 0.1 CNY per core-hour.", [prepare], ["model_scope_audited", "time_cost_estimated", "lower_cost_alternative", "cost_rate_fixed"], gate=iteration_gate),
                self._task(human_review, "human", "Review the exact designed-candidate model, parameters, AI audit, time estimate, and cost; approve, request changes, or reject before submission.", [dft_audit], ["human_identity", "model_and_parameters_reviewed", "cost_reviewed", "decision_recorded"], gate=iteration_gate),
                self._task(run, "materials-dft", "Submit and monitor the designed-candidate DFT job only after hash-bound human approval.", [human_review], ["remote_run_recorded", "human_approval_hash_bound"], gate=iteration_gate),
                self._task(parse, "materials-dft", "Parse all designed-candidate DFT outputs through the selected AICC engine adapter and preserve the four-rung validation evidence.", [run], ["outputs_fetched", "aicc_validation_json", "technical_rungs_recorded"], gate=iteration_gate),
                self._task(postprocess, "materials-dft", "Resolve engine-specific post-processing; for VASP, execute every applicable VASPKIT task or record a scientifically justified not_applicable decision.", [parse], ["engine_postprocessing_resolved", "vaspkit_outputs_recorded_or_not_applicable"], gate=iteration_gate),
                self._task(dft_review, "materials-reviewer:dft", "Independently decide the designed-candidate DFT result's scientific validity before it can influence synthesis.", [postprocess], ["scientific_validity_decided", "dft_claims_bounded"], gate=iteration_gate),
            ])
            synthesis_dependency = dft_review

        synthesis = f"synthesis:plan:{suffix}"
        protocol = f"experiment:protocol:{suffix}"
        safety = f"experiment:safety:{suffix}"
        experiment = f"experiment:record:{suffix}"
        interpretation = f"experiment:interpret:{suffix}"
        tasks.append(self._task(
            synthesis,
            "materials-synthesis",
            "Write a reproducible, safety-reviewed synthesis and characterization plan with controls, process windows, and failure branches.",
            [synthesis_dependency],
            ["precursors_and_amounts", "equipment_atmosphere_temperature_and_time", "safety_and_waste_review", "controls_and_characterization", "failure_branches"],
            gate=iteration_gate,
        ))
        experiment_dependency = synthesis
        if domain_profile == "alkaline-electrolysis":
            tasks.extend([
                self._task(
                    protocol,
                    "electrochemistry-experimentalist",
                    "Freeze a reproducible alkaline-electrolysis test protocol with controls, raw-data contract, and falsification criteria.",
                    [synthesis],
                    ["electrode_and_loading_defined", "reference_and_ir_method_defined", "replicates_and_controls", "gas_quantification", "raw_data_contract", "stop_rules"],
                    gate=iteration_gate,
                ),
                self._task(
                    safety,
                    "electrolysis-safety",
                    "Independently review the frozen experimental protocol and block unresolved chemical, gas, pressure, thermal, or shutdown hazards.",
                    [protocol],
                    ["hazards_and_controls", "gas_separation_limits", "shutdown_and_emergency_controls", "human_review_required"],
                    gate=iteration_gate,
                ),
            ])
            experiment_dependency = safety
        tasks.append(self._task(
            experiment,
            "human",
            "Record the human-run synthesis and experiment, deviations, raw measurements, instrument metadata, and observations without AI reinterpretation.",
            [experiment_dependency],
            ["human_authored_record", "raw_data_or_source_paths", "deviations_and_failures_preserved"],
            gate=iteration_gate,
        ))
        interpretation_dependencies = [experiment]
        if domain_profile == "alkaline-electrolysis":
            analyses = [
                (f"experiment:analyze:electrochemistry:{suffix}", "electrochemistry-analyst", "Analyze electrochemical and full-cell measurements under the frozen protocol.", ["condition_normalized_metrics", "uncertainty_and_replicates", "efficiency_and_gas_balance"]),
                (f"experiment:analyze:catalyst:{suffix}", "catalyst-scientist", "Compare pre/post-test catalyst identity and active-state evidence with the proposed mechanism.", ["active_state_evidence", "mechanism_alternatives", "post_test_changes"]),
                (f"experiment:analyze:transport:{suffix}", "interface-transport-specialist", "Separate kinetic, ohmic, bubble, and transport contributions in the measured cell response.", ["loss_breakdown", "cell_conditions_preserved", "crossover_and_transport_findings"]),
                (f"experiment:analyze:degradation:{suffix}", "degradation-analyst", "Assess reversible conditioning, irreversible loss, and supported degradation mechanisms.", ["drift_quantified", "reversible_vs_irreversible", "lifetime_boundary"]),
            ]
            for task_id, role, objective, acceptance in analyses:
                tasks.append(self._task(task_id, role, objective, [experiment], acceptance, gate=iteration_gate))
            interpretation_dependencies = [task_id for task_id, _, _, _ in analyses]
        tasks.append(self._task(
            interpretation,
            "materials-designer",
            "Integrate the independent analyses against the candidate mechanism and falsifiers, then recommend stop, scale, or another design iteration.",
            interpretation_dependencies,
            ["prediction_vs_measurement", "specialist_conflicts_preserved", "failed_hypotheses_retained", "next_iteration_decision", "learning_is_evidence_bounded"],
            gate=iteration_gate,
        ))
        return tasks, interpretation

    def _default_tasks(
        self,
        include_dft: bool,
        design_mode: bool,
        domain_profile: str = "general",
    ) -> list[dict[str, Any]]:
        tasks = [
            self._task("plan", "materials-supervisor", "Freeze the research question, constraints, providers, and acceptance tests."),
            self._task("discover:materials_project", "materials-discovery", "Query Materials Project when MP_API_KEY is available.", ["plan"], ["provider_error_is_preserved"], True),
            self._task("discover:oqmd", "materials-discovery", "Query OQMD for normalized candidate records.", ["plan"], ["provider_error_is_preserved"], True),
            self._task("discover:aflow", "materials-discovery", "Query AFLOW for exact-formula candidate records.", ["plan"], ["provider_error_is_preserved"], True),
            self._task("discover:nomad", "materials-discovery", "Query NOMAD for public candidate records.", ["plan"], ["provider_error_is_preserved"], True),
            self._task("normalize", "materials-discovery", "Merge provider records without formula-only deduplication.", ["discover:materials_project", "discover:oqmd", "discover:aflow", "discover:nomad"], ["schema_valid", "provenance_present"], True, min_successful_dependencies=2),
            self._task(
                "reconcile:providers",
                "materials-discovery",
                "Merge late provider results into a new immutable candidate artifact without rewriting the quorum snapshot.",
                ["discover:materials_project", "discover:oqmd", "discover:aflow", "discover:nomad", "normalize"],
                ["late_results_versioned", "source_status_preserved", "prior_artifact_immutable"],
                True,
                background=True,
            ),
            self._task("validate", "materials-validator", "Run deterministic formula, structure, unit, and DFT-input checks.", ["normalize"], ["all_records_checked", "findings_preserved"]),
        ]
        screen_dependencies = ["validate"]
        if domain_profile == "alkaline-electrolysis":
            domain_tasks = [
                self._task("domain:chemistry", "chemistry-reasoner", "Audit alkaline speciation, stoichiometry, thermodynamic boundaries, kinetic hypotheses, and competing chemical pathways.", ["validate"], ["speciation_and_conditions", "stoichiometry_and_charge", "thermodynamic_boundary", "kinetic_hypotheses_labeled", "competing_pathways"]),
                self._task("domain:electrochemistry", "electrochemistry-analyst", "Normalize and audit alkaline HER/OER and electrolyzer performance evidence.", ["validate"], ["conditions_normalized", "reference_and_ir_checked", "half_cell_vs_full_cell_separated", "efficiency_evidence"]),
                self._task("domain:catalyst", "catalyst-scientist", "Audit catalyst identity, active-state evidence, mechanism alternatives, loading, and benchmark comparability.", ["validate"], ["active_state_boundary", "mechanism_evidence", "loading_and_support_recorded", "falsifiers_defined"]),
                self._task("domain:interface-transport", "interface-transport-specialist", "Audit electrolyte, diaphragm, wetting, bubbles, transport, conductivity, and gas crossover.", ["validate"], ["electrolyte_and_cell_conditions", "loss_contributions", "separator_and_crossover", "boundary_conditions"]),
                self._task("domain:degradation", "degradation-analyst", "Audit degradation evidence, stress-test relevance, reversible conditioning, and lifetime boundaries.", ["validate"], ["stress_conditions", "drift_and_failure_modes", "reversible_vs_irreversible", "no_unsupported_lifetime_extrapolation"]),
                self._task("domain:safety", "electrolysis-safety", "Apply the alkaline-electrolyzer chemical, gas, pressure, thermal, and shutdown safety gate.", ["validate"], ["hazards_and_controls", "gas_separation", "pressure_and_thermal_limits", "shutdown_and_human_review"]),
            ]
            tasks.extend(domain_tasks)
            screen_dependencies.extend(task["task_id"] for task in domain_tasks)
        screen_acceptance = ["missing_data_explicit", "exclusions_explained"]
        if domain_profile == "alkaline-electrolysis":
            screen_acceptance.extend(["all_domain_artifacts_consumed", "specialist_conflicts_preserved"])
        tasks.append(self._task("screen", "materials-screener", "Integrate validation and domain assessments through explicit hard filters and soft ranking criteria.", screen_dependencies, screen_acceptance))
        reviewer_tasks = [
            self._task("review:chemistry", "materials-reviewer:chemistry", "Independently audit chemistry and structure evidence.", ["screen"], ["formula_and_structure_evidence"]),
            self._task("review:data", "materials-reviewer:data", "Independently audit units, providers, and provenance.", ["screen"], ["source_and_unit_evidence"]),
            self._task("review:dft", "materials-reviewer:dft", "Independently audit DFT readiness and convergence claims.", ["screen"], ["no_exit_code_only_claims"]),
        ]
        if domain_profile == "alkaline-electrolysis":
            reviewer_tasks.extend([
                self._task("review:electrochemistry", "materials-reviewer:electrochemistry", "Independently audit the electrochemical, catalyst, transport, and degradation evidence chain.", ["screen"], ["condition_matched_claims", "cell_vs_material_boundary", "durability_boundary"]),
                self._task("review:safety", "materials-reviewer:safety", "Independently audit blocking alkaline-electrolyzer safety findings and required human controls.", ["screen"], ["blocking_hazards_resolved", "human_safety_gate_preserved"]),
            ])
        tasks.extend(reviewer_tasks)
        tasks.append(self._task("review:judge", "materials-reviewer:judge", "Resolve independent votes and select approve, reject, or more evidence.", [task["task_id"] for task in reviewer_tasks], ["quorum_reached", "decision_recorded"]))
        if design_mode:
            design_tasks, tail = self._design_iteration_tasks(1, "review:judge", include_dft, domain_profile)
            tasks.extend(design_tasks)
            tasks.append(self._task("complete", "materials-reviewer:judge", "Audit the experiment interpretation and freeze the iteration report.", [tail], ["final_review_artifact", "claims_match_measured_evidence"]))
        elif include_dft:
            tasks.extend([
                self._task("dft:prepare", "materials-dft", "Freeze a versioned DFTRunSpec and input bundle, then pass the selected AICC engine preflight; VASP also requires a versioned VASPKIT plan.", ["review:judge"], ["review_approved", "spec_valid", "aicc_preflight_passed", "preflight_waiver_resolved", "vaspkit_plan_recorded_for_vasp"]),
                self._task("dft:audit", "materials-validator", "Run an independent AI model-scope, resource, time, and cost audit for the frozen DFT inputs; do not submit a job.", ["dft:prepare"], ["model_scope_audited", "time_cost_estimated", "lower_cost_alternative", "cost_rate_fixed"]),
                self._task("dft:human-review", "human", "Review the frozen DFT model, parameters, AI validation, estimated time, and CNY cost; approve, request changes, or reject before any remote submission.", ["dft:audit"], ["human_identity", "model_and_parameters_reviewed", "cost_reviewed", "decision_recorded"]),
                self._task("dft:run", "materials-dft", "Submit and monitor the remote DFT job only after the current human review approves the exact input hashes.", ["dft:human-review"], ["remote_run_recorded", "human_approval_hash_bound"]),
                self._task("dft:parse", "materials-dft", "Parse all outputs through the selected AICC engine adapter and preserve the four-rung validation evidence.", ["dft:run"], ["outputs_fetched", "aicc_validation_json", "technical_rungs_recorded"]),
                self._task("dft:postprocess", "materials-dft", "Resolve engine-specific post-processing; for VASP, execute every applicable VASPKIT task or record a scientifically justified not_applicable decision.", ["dft:parse"], ["engine_postprocessing_resolved", "vaspkit_outputs_recorded_or_not_applicable"]),
                self._task("complete", "materials-reviewer:judge", "Decide scientific validity from the parsed DFT and post-processing evidence and freeze the final report.", ["dft:postprocess"], ["scientific_validity_decided", "final_review_artifact"]),
            ])
        else:
            tasks.append(self._task("complete", "materials-reviewer:judge", "Freeze the final screening report after the review vote.", ["review:judge"], ["final_review_artifact"]))
        return tasks

    def _fast_tasks(self) -> list[dict[str, Any]]:
        """Keep an explicitly fast workflow auditable without spawning a DAG."""
        return [
            self._task("plan", "planner", "State the question, constraints, and one bounded next action."),
            self._task("complete", "planner", "Record the direct answer or compact decision with assumptions.", ["plan"], ["decision_recorded"]),
        ]

    def _standard_tasks(self, domain_profile: str = "general") -> list[dict[str, Any]]:
        """A bounded materials path for ordinary discovery and screening.

        Provider fan-out and independent quorum review are reserved for the
        high-risk route. The materials role can still choose MatterGen,
        MatterSim, UMA, or a named provider inside the bounded tasks.
        """
        tasks = [
            self._task("plan", "planner", "Freeze the research question, constraints, and acceptance tests."),
            self._task("discover", "materials", "Use only the requested literature/data providers and preserve source status.", ["plan"], ["source_status_preserved"]),
            self._task("validate", "materials", "Run deterministic composition, structure, unit, and protocol checks.", ["discover"], ["inputs_checked"]),
        ]
        screen_dependencies = ["validate"]
        if domain_profile != "general":
            tasks.append(
                self._task(
                    "domain:context",
                    "materials",
                    f"Apply the requested {domain_profile} context only where it changes the screening decision.",
                    ["validate"],
                    ["domain_assumptions_labeled"],
                )
            )
            screen_dependencies.append("domain:context")
        tasks.extend([
            self._task("screen", "materials", "Rank candidates with explicit hard filters, uncertainty, and next-stage decisions.", screen_dependencies, ["ranking_explained", "uncertainty_reported"]),
            self._task("complete", "planner", "Freeze one compact screening report and list only the next required action.", ["screen"], ["final_report"]),
        ])
        return tasks

    def create_discovery_dag(
        self,
        goal: str,
        chemical_system: str,
        reaction: str,
        constraints: dict[str, Any] | None = None,
        existing_cluster_expansion: str | None = None,
        include_reactor: bool = False,
        include_spatial: bool = False,
        shortlisted_candidate_count: int = 0,
        spatial_candidate_limit: int = 8,
        providers: list[str] | None = None,
        response_language: str | None = None,
    ) -> dict[str, Any]:
        """Create the explicit, staged electrocatalysis discovery workflow.

        This is a template over the capability-plan contract. Optional stages
        are omitted from execution and recorded with a reason, so a missing
        cluster expansion or an unjustified spatial model cannot silently turn
        into a new calculation.
        """
        system = str(chemical_system or "").strip()
        reaction_name = str(reaction or "").strip()
        if not system:
            raise WorkflowError("chemical_system is required")
        if not reaction_name:
            raise WorkflowError("reaction is required")
        try:
            candidate_limit = int(spatial_candidate_limit)
            candidate_count = int(shortlisted_candidate_count)
        except (TypeError, ValueError) as exc:
            raise WorkflowError(
                "shortlisted_candidate_count and spatial_candidate_limit must be integers"
            ) from exc
        if candidate_limit < 1:
            raise WorkflowError("spatial_candidate_limit must be positive")
        if candidate_count < 0:
            raise WorkflowError("shortlisted_candidate_count cannot be negative")
        selected_providers = [
            str(provider).strip().lower()
            for provider in (providers or ["materials_project", "oqmd", "nomad"])
            if str(provider).strip()
        ]
        if not selected_providers:
            raise WorkflowError("at least one discovery provider is required")

        if constraints is not None and not isinstance(constraints, dict):
            raise WorkflowError("constraints must be an object")
        shared = dict(constraints or {})
        nested_specs: dict[str, dict[str, Any]] = {}
        for key in ("surface_specs", "adsorption_specs", "conditions"):
            value = shared.get(key, {})
            if value is None:
                value = {}
            if not isinstance(value, dict):
                raise WorkflowError(f"constraints.{key} must be an object")
            nested_specs[key] = value
        surface_specs = nested_specs["surface_specs"]
        adsorption_specs = nested_specs["adsorption_specs"]
        condition_specs = nested_specs["conditions"]
        plan: list[dict[str, Any]] = [
            {
                "task_id": "generate",
                "capability": "structure.generate.mattergen",
                "parameters": {
                    "chemical_system": system,
                    "constraints": shared.get("generation_constraints", {}),
                    "samples": shared.get("samples", 32),
                    "model": shared.get("mattergen_model", "chemical_system"),
                },
                "objective": "Generate candidate crystals with MatterGen; retain each structure hash and generation manifest.",
            },
            {
                "task_id": "references",
                "capability": "materials.discover.database",
                "parameters": {
                    "query": shared.get("reference_query", system),
                    "providers": selected_providers,
                    "limit": shared.get("reference_limit", 100),
                },
                "objective": "Collect Materials Project/OQMD/NOMAD reference structures and stability records with provider-level uncertainty.",
            },
            {
                "task_id": "standardize",
                "capability": "structure.standardize.mattergen",
                "depends_on": ["generate"],
                "parameters": shared.get("standardization_policy", {}),
                "objective": "Standardize generated bulk and requested surfaces before any model inference.",
            },
            {
                "task_id": "validate",
                "capability": "structure.validate",
                "depends_on": ["standardize"],
                "parameters": {"min_distance": shared.get("min_distance", 0.8)},
                "objective": "Reject malformed, overlapping, or provenance-incomplete structures before screening.",
            },
            {
                "task_id": "thermo",
                "capability": "thermo.analyze.pymatgen",
                "depends_on": ["references", "validate"],
                "parameters": {
                    "chemical_potentials": shared.get("chemical_potentials", {}),
                    "pH_range": condition_specs.get("pH_range"),
                    "reference_records_from": "references",
                },
                "objective": "Use pymatgen for phase stability and Pourbaix screening; preserve missing chemical potentials as evidence gaps.",
            },
        ]

        optional_stages: list[dict[str, Any]] = []
        structure_dependency = "validate"
        ce_path = str(existing_cluster_expansion or "").strip()
        ce_sha256: str | None = None
        ce_invalid = False
        if ce_path:
            try:
                ce_path_obj = self._artifact_path(ce_path)
            except WorkflowError:
                ce_path_obj = None
            if ce_path_obj is None or not ce_path_obj.is_file():
                ce_invalid = True
                ce_path = ""
            else:
                try:
                    if ce_path_obj.stat().st_size <= 0:
                        raise OSError("cluster expansion is empty")
                    ce_sha256 = self._sha256_file(ce_path_obj)
                except OSError:
                    ce_invalid = True
                    ce_path = ""
                else:
                    ce_path = ce_path_obj.relative_to(self.workspace).as_posix()
        if ce_path:
            plan.append({
                "task_id": "smol",
                "capability": "alloy.sample.smol",
                "depends_on": ["validate"],
                "parameters": {
                    "existing_cluster_expansion": ce_path,
                    "existing_cluster_expansion_sha256": ce_sha256,
                    "composition_grid": shared.get("composition_grid", []),
                    "samples": shared.get("disorder_samples", 0),
                },
                "objective": "Sample alloy/disorder configurations only from the supplied existing cluster expansion.",
            })
            structure_dependency = "smol"
        else:
            optional_stages.append({
                "stage": "alloy.sample.smol",
                "status": "skipped",
                "reason": "existing_cluster_expansion_invalid" if ce_invalid else "existing_cluster_expansion_missing",
                "next_step": "supply a compatible, validated cluster expansion before sampling alloy disorder",
            })

        plan.extend([
            {
                "task_id": "surfaces",
                "capability": "surface.construct.catkit",
                "depends_on": [structure_dependency],
                "parameters": {
                    "miller_indices": surface_specs.get("miller_indices", []),
                    "terminations": surface_specs.get("terminations", []),
                    "adsorbates": adsorption_specs.get("adsorbates", []),
                    "site_policy": adsorption_specs.get("site_policy", "explicit"),
                },
                "objective": "Build periodic facets, terminations, and explicit adsorption-site structure sets with CatKit+ASE+pymatgen.",
            },
            {
                "task_id": "mattersim",
                "capability": "stability.screen.mattersim",
                "depends_on": [structure_dependency],
                "parameters": {
                    "structure_kind": "bulk",
                    "device": shared.get("device", "cuda"),
                    "relax": True,
                },
                "objective": "Use MatterSim for fast bulk relaxation and stability proxy screening; do not interpret it as formation or synthesis proof.",
            },
            {
                "task_id": "adsorption",
                "capability": "adsorption.screen.uma",
                "depends_on": ["surfaces"],
                "parameters": {
                    "model_name": shared.get("uma_model", "uma-s-1p2p1"),
                    "task_name": shared.get("uma_task", "oc25"),
                    "device": shared.get("device", "cuda"),
                    "relax": True,
                    "fixed_bottom_layers": shared.get("fixed_bottom_layers", 3),
                },
                "objective": "Use FairChem UMA for consistent slab/adsorbate/adsorbed relaxation and adsorption-configuration screening.",
            },
            {
                "task_id": "evidence",
                "capability": "adsorption.evidence.retrieve",
                "depends_on": ["references", "surfaces"],
                "parameters": {
                    "reaction": reaction_name,
                    "surface_family": surface_specs.get("family", system),
                    "providers": shared.get("evidence_providers", ["catalysis_hub", "oc20", "oc22", "oc25", "literature"]),
                    "query_scope": shared.get("evidence_query_scope", {}),
                },
                "objective": "Retrieve adsorption/reaction energies, BEP parameters, and scaling relations with source provenance and evidence gaps.",
            },
            {
                "task_id": "scaling_bep",
                "capability": "kinetics.complete.scaling_bep",
                "depends_on": ["adsorption", "evidence"],
                "parameters": {
                    "reference_state": shared.get("reference_state", "CHE"),
                    "scaling_parameters_from": "evidence",
                    "bep_parameters_from": "evidence",
                },
                "objective": "Complete missing intermediate free energies and transition-state barriers only through declared scaling/BEP relations.",
            },
            {
                "task_id": "catmap",
                "capability": "microkinetics.screen.catmap",
                "depends_on": ["scaling_bep"],
                "parameters": {
                    "reaction": reaction_name,
                    "pH_range": condition_specs.get("pH_range"),
                    "potential_range": condition_specs.get("potential_range"),
                    "field_range": condition_specs.get("field_range"),
                    "coverage_model": shared.get("coverage_model", "mean_field"),
                },
                "objective": "Screen pH-potential-field-dependent rates, selectivity, rate-limiting steps, and sensitivity with CatMAP.",
            },
        ])

        tail_dependency = "catmap"
        if include_reactor:
            plan.append({
                "task_id": "reactor",
                "capability": "reactor.validate.cantera",
                "depends_on": ["catmap"],
                "parameters": {
                    "reactor_type": condition_specs.get("reactor_type", "batch"),
                    "temperature_range": condition_specs.get("temperature_range"),
                    "pressure_range": condition_specs.get("pressure_range"),
                    "flow_conditions": condition_specs.get("flow_conditions"),
                    "engine": shared.get("reactor_engine", "cantera"),
                },
                "objective": "Validate the selected mechanism under reactor temperature, pressure, and flow conditions with Cantera/OpenMKM.",
            })
            tail_dependency = "reactor"
        else:
            optional_stages.append({
                "stage": "reactor.validate.cantera",
                "status": "skipped",
                "reason": "reactor_conditions_not_requested",
                "next_step": "provide reactor temperature, pressure, and flow conditions for Cantera/OpenMKM validation",
            })

        if include_spatial and candidate_count > 0 and candidate_count <= candidate_limit:
            plan.append({
                "task_id": "kmos",
                "capability": "spatial.refine.kmos",
                "depends_on": [tail_dependency],
                "parameters": {
                    "shortlisted_candidate_count": candidate_count,
                    "candidate_limit": candidate_limit,
                    "lattice": shared.get("lattice", {}),
                    "neighbor_rules": shared.get("neighbor_rules", []),
                    "diffusion_events": shared.get("diffusion_events", []),
                },
                "objective": "Refine only the short-listed candidates for diffusion, neighboring-site, and finite-lattice effects with kmos.",
            })
            tail_dependency = "kmos"
        else:
            reason = "spatial_analysis_not_requested"
            if include_spatial and candidate_count == 0:
                reason = "shortlisted_candidate_count_missing"
            elif include_spatial and candidate_count > candidate_limit:
                reason = "shortlisted_candidate_count_exceeds_limit"
            optional_stages.append({
                "stage": "spatial.refine.kmos",
                "status": "skipped",
                "reason": reason,
                "candidate_limit": candidate_limit,
                "next_step": "shortlist a small candidate set and justify a spatial/diffusion question before enabling kmos",
            })

        plan.append({
            "task_id": "report",
            "capability": "workflow.summarize",
            "depends_on": [tail_dependency, "thermo", "mattersim"],
            "parameters": {"reaction": reaction_name, "uncertainty_policy": "preserve_gaps"},
            "objective": "Freeze an evidence-linked discovery report with candidate ranking, uncertainty, skipped stages, and the next validation action.",
        })

        data = self.create_dag(
            goal,
            constraints={**shared, "chemical_system": system, "reaction": reaction_name},
            domain_profile="general",
            response_language=response_language,
            route="agent",
            capability_plan=plan,
        )
        data.update({
            "workflow_template": "electrocatalysis-discovery-v1",
            "workflow_scope": {
                "chemical_system": system,
                "reaction": reaction_name,
                "providers": selected_providers,
                "existing_cluster_expansion": ce_path or None,
                "existing_cluster_expansion_sha256": ce_sha256,
            },
            "optional_stages": optional_stages,
            "scientific_boundaries": [
                "MatterGen generation is candidate discovery, not a stability or synthesizability claim.",
                "MatterSim and FairChem UMA are screening proxies and require calibration before final selection.",
                "Scaling and BEP completion is an extrapolation whenever a direct label is missing.",
                "CatMAP, reactor, and kmos outputs inherit all upstream thermochemistry and mechanism uncertainty.",
            ],
        })
        with self._lock:
            self._write_data(data)
            self._append_event({
                "event_id": f"mwe_{uuid.uuid4().hex[:16]}",
                "event": "discovery_template_created",
                "workflow_id": data["workflow_id"],
                "template": "electrocatalysis-discovery-v1",
                "optional_stages": optional_stages,
                "at": _now(),
            })
        return data

    def create_dag(
        self,
        goal: str,
        constraints: dict[str, Any] | None = None,
        include_dft: bool = False,
        design_mode: bool = False,
        domain_profile: str = "general",
        response_language: str | None = None,
        route: str = "standard",
        capability_plan: list[dict[str, Any] | str] | None = None,
    ) -> dict[str, Any]:
        domain_profile = str(domain_profile or "general").strip().lower()
        if domain_profile not in DOMAIN_PROFILES:
            raise WorkflowError(f"unsupported domain profile: {domain_profile}")
        requested_route = str(route or "standard").strip().lower()
        if requested_route not in {"agent", "fast", "standard", "high-risk"}:
            raise WorkflowError("unsupported route; choose agent, fast, standard, or high-risk")
        normalized_plan: list[dict[str, Any]] = []
        if capability_plan is not None:
            try:
                capability_specs, normalized_plan = capability_plan_tasks(capability_plan, self.workspace)
                tasks = []
                for spec in capability_specs:
                    task = self._task(
                        spec["task_id"],
                        spec["role"],
                        spec["objective"],
                        spec["dependencies"],
                        spec["acceptance_tests"],
                    )
                    task.update({
                        "capability_id": spec["capability_id"],
                        "capability_tool": spec["capability_tool"],
                        "capability_executor": spec["capability_executor"],
                        "capability_parameters": spec["capability_parameters"],
                        "capability_inputs": spec["capability_inputs"],
                        "capability_outputs": spec["capability_outputs"],
                        "capability_risk": spec["capability_risk"],
                        "capability_cost": spec["capability_cost"],
                        "parallelizable": spec["parallelizable"],
                    })
                    tasks.append(task)
            except CapabilityError as exc:
                raise WorkflowError(str(exc)) from exc
            capability_route = plan_risk(capability_plan, self.workspace)
            effective_route = (
                "high-risk"
                if include_dft or design_mode or capability_route == "high" or requested_route == "high-risk"
                else "agent"
            )
        else:
            if requested_route == "agent":
                raise WorkflowError("route=agent requires capability_plan")
            effective_route = "high-risk" if include_dft or design_mode else requested_route
            tasks = (
                self._fast_tasks()
                if effective_route == "fast"
                else self._standard_tasks(domain_profile)
                if effective_route == "standard"
                else self._default_tasks(include_dft, design_mode, domain_profile)
            )
        data = super().create(goal, constraints)
        data.update({
            "execution_mode": "dag",
            "route": effective_route,
            "include_dft": bool(include_dft),
            "design_mode": bool(design_mode),
            "domain_profile": domain_profile,
            "current_iteration": 1 if design_mode else 0,
            "tasks": tasks,
            "plan_source": "agent" if capability_plan is not None else "route",
            "capability_plan": capability_plan,
            "capability_plan_normalized": normalized_plan,
            "review_votes": [],
            "review_decision": None,
            "design_snapshots": {},
            "novelty_audits": [],
            "physics_screens": {},
            "dag_version": 7,
            "response_language": infer_response_language(goal, response_language or (constraints or {}).get("response_language")),
            "dft_cost_audits": [],
            "dft_human_reviews": [],
            "dft_approval": None,
        })
        with self._lock:
            self._write_data(data)
            self._append_event({
                "event_id": f"mwe_{uuid.uuid4().hex[:16]}",
                "event": "dag_created",
                "workflow_id": data["workflow_id"],
                "task_count": len(data["tasks"]),
                "route": effective_route,
                "include_dft": bool(include_dft),
                "design_mode": bool(design_mode),
                "domain_profile": domain_profile,
                "at": _now(),
            })
        return data

    def add_design_iteration(self, workflow_id: str, actor: str, note: str = "") -> dict[str, Any]:
        if actor != "materials-reviewer:judge" and not actor.startswith("human:"):
            raise WorkflowError("a new design iteration requires materials-reviewer:judge or human:<id>")
        with self._lock:
            data, by_id = self._load_tasks(workflow_id)
            if not data.get("design_mode"):
                raise WorkflowError("workflow is not a design workflow")
            complete = by_id.get("complete") or {}
            if complete.get("status") != "pending":
                raise WorkflowError("cannot add an iteration after final review has started")
            current = int(data.get("current_iteration", 1))
            prior = by_id.get(f"experiment:interpret:{current}") or {}
            if prior.get("status") not in TASK_SUCCESS:
                raise WorkflowError("the current experiment interpretation must complete before another iteration")
            next_iteration = current + 1
            tasks, tail = self._design_iteration_tasks(
                next_iteration,
                f"experiment:interpret:{current}",
                bool(data.get("include_dft")),
                str(data.get("domain_profile", "general")),
            )
            data["tasks"].extend(tasks)
            complete["dependencies"] = [tail]
            complete["updated_at"] = _now()
            data["current_iteration"] = next_iteration
            data["updated_at"] = _now()
            self._write_data(data)
            self._append_event({
                "event_id": f"mwe_{uuid.uuid4().hex[:16]}",
                "event": "design_iteration_added",
                "workflow_id": workflow_id,
                "iteration": next_iteration,
                "actor": actor,
                "note": note.strip(),
                "at": _now(),
            })
            return {
                "workflow_id": workflow_id,
                "iteration": next_iteration,
                "task_ids": [str(task["task_id"]) for task in tasks],
                "ready": self.ready_tasks(workflow_id),
            }

    @staticmethod
    def _actor_matches(actor: str, role: str) -> bool:
        return actor == role or (":" not in role and actor.startswith(role + ":"))

    @staticmethod
    def _task_ready(task: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> bool:
        if task.get("status") != "pending":
            return False
        dependencies = [by_id.get(dep) for dep in task.get("dependencies", [])]
        if any(dep is None for dep in dependencies):
            return False
        successful = sum(1 for dep in dependencies if dep and dep.get("status") in TASK_SUCCESS)
        minimum = task.get("min_successful_dependencies")
        if minimum is not None:
            # Quorum tasks may start as soon as enough useful evidence exists;
            # slower optional providers can enrich the workflow later.
            return successful >= max(1, int(minimum))
        if any(dep and dep.get("status") not in TASK_TERMINAL for dep in dependencies):
            return False
        failed = any(dep and dep.get("status") in {"failed", "blocked", "dead_letter"} for dep in dependencies)
        if failed:
            return bool(task.get("continue_on_failure"))
        return successful == len(dependencies)

    @staticmethod
    def _dependency_artifacts(task: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> list[str]:
        artifacts: list[str] = []
        for dependency in task.get("dependencies", []):
            output = (by_id.get(str(dependency)) or {}).get("output") or {}
            artifacts.extend(_as_list(output.get("artifacts")))
        return artifacts

    def _load_tasks(self, workflow_id: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        data = self.get(workflow_id)
        if data.get("execution_mode") != "dag":
            raise WorkflowError("workflow is not a DAG workflow")
        tasks = [task for task in data.get("tasks", []) if isinstance(task, dict)]
        return data, {str(task.get("task_id")): task for task in tasks}

    def ready_tasks(self, workflow_id: str, include_background: bool = False) -> list[dict[str, Any]]:
        data, by_id = self._load_tasks(workflow_id)
        task_constraints = dict(data.get("constraints") or {})
        task_constraints["domain_profile"] = str(data.get("domain_profile", "general"))
        ready: list[dict[str, Any]] = []
        for task in data.get("tasks", []):
            if (
                isinstance(task, dict)
                and (include_background or not task.get("background"))
                and self._task_ready(task, by_id)
                and self._gate_ready(data, task)
            ):
                task_copy = dict(task)
                task_copy["input"] = AgentTaskInput(
                    task_id=str(task["task_id"]),
                    workflow_id=workflow_id,
                    role=str(task["role"]),
                    objective=str(task["objective"]),
                    input_artifacts=self._dependency_artifacts(task, by_id),
                    dependencies=list(task.get("dependencies", [])),
                    acceptance_tests=list(task.get("acceptance_tests", [])),
                    constraints=task_constraints,
                    response_language=str(data.get("response_language", "en")),
                    runtime={"dependency_policy": task.get("dependency_policy", "all_success"), "lease_seconds": task.get("lease_seconds", 300), "attempt": task.get("attempt", 0)},
        ).to_dict()
                ready.append(task_copy)
        return ready

    def background_ready_tasks(self, workflow_id: str) -> list[dict[str, Any]]:
        return [task for task in self.ready_tasks(workflow_id, include_background=True) if task.get("background")]

    def claim_task(self, workflow_id: str, task_id: str, actor: str) -> dict[str, Any]:
        with self._lock:
            data, by_id = self._load_tasks(workflow_id)
            task = by_id.get(_safe_id(task_id))
            if task is None:
                raise WorkflowError(f"task not found: {task_id}")
            if task.get("status") == "running" and float(task.get("lease_until") or 0) <= time.time():
                task["status"] = "pending"
                task["claimed_by"] = None
            if not self._task_ready(task, by_id) or not self._gate_ready(data, task):
                raise WorkflowError(f"task is not ready: {task_id}")
            if not self._actor_matches(actor, str(task.get("role"))):
                raise WorkflowError(f"actor {actor} cannot claim {task_id}")
            task["status"] = "running"
            task["attempt"] = int(task.get("attempt", 0)) + 1
            task["claimed_by"] = actor
            task["lease_until"] = time.time() + int(task.get("lease_seconds", 300))
            task["heartbeat_at"] = _now()
            task["updated_at"] = _now()
            task["input"] = AgentTaskInput(
                task_id=task_id,
                workflow_id=workflow_id,
                role=str(task["role"]),
                objective=str(task["objective"]),
                input_artifacts=self._dependency_artifacts(task, by_id),
                dependencies=list(task.get("dependencies", [])),
                acceptance_tests=list(task.get("acceptance_tests", [])),
                constraints=dict(data.get("constraints") or {}),
                response_language=str(data.get("response_language", "en")),
                runtime={"dependency_policy": task.get("dependency_policy", "all_success"), "lease_seconds": task.get("lease_seconds", 300), "attempt": task.get("attempt", 0)},
            ).to_dict()
            self._write_data(data)
            self._append_event({"event_id": f"mwe_{uuid.uuid4().hex[:16]}", "event": "task_claimed", "workflow_id": workflow_id, "task_id": task_id, "actor": actor, "at": _now()})
            return dict(task)

    def heartbeat_task(self, workflow_id: str, task_id: str, actor: str) -> dict[str, Any]:
        with self._lock:
            data, by_id = self._load_tasks(workflow_id)
            task = by_id.get(_safe_id(task_id))
            if task is None or task.get("status") != "running" or task.get("claimed_by") != actor:
                raise WorkflowError(f"task is not claimed by {actor}: {task_id}")
            task["lease_until"] = time.time() + int(task.get("lease_seconds", 300))
            task["heartbeat_at"] = _now()
            task["updated_at"] = _now()
            self._write_data(data)
            self._append_event({"event_id": f"mwe_{uuid.uuid4().hex[:16]}", "event": "task_heartbeat", "workflow_id": workflow_id, "task_id": task_id, "actor": actor, "lease_until": task["lease_until"], "at": _now()})
            return dict(task)

    def recover_expired_tasks(self, workflow_id: str | None = None) -> dict[str, Any]:
        recovered: list[str] = []
        dead_letter: list[str] = []
        with self._lock:
            paths = [self._path(workflow_id)] if workflow_id else list(self.store.glob("*.json"))
            for path in paths:
                if not path.is_file():
                    continue
                data = json.loads(path.read_text(encoding="utf-8"))
                if data.get("execution_mode") != "dag":
                    continue
                changed = False
                workflow_recovered: list[str] = []
                workflow_dead: list[str] = []
                for task in data.get("tasks", []):
                    if task.get("status") != "running" or float(task.get("lease_until") or 0) > time.time():
                        continue
                    task_id = str(task.get("task_id"))
                    if int(task.get("attempt", 0)) < int(task.get("max_attempts", 3)):
                        task.update({"status": "pending", "claimed_by": None, "lease_until": None, "heartbeat_at": None, "updated_at": _now()})
                        recovered.append(task_id)
                        workflow_recovered.append(task_id)
                    else:
                        task.update({"status": "dead_letter", "claimed_by": None, "lease_until": None, "dead_letter": {"reason": "lease_expired_and_attempts_exhausted", "at": _now()}, "updated_at": _now()})
                        dead_letter.append(task_id)
                        workflow_dead.append(task_id)
                    changed = True
                if changed:
                    self._write_data(data)
                    self._append_event({"event_id": f"mwe_{uuid.uuid4().hex[:16]}", "event": "expired_tasks_recovered", "workflow_id": data.get("workflow_id"), "recovered": workflow_recovered, "dead_letter": workflow_dead, "at": _now()})
        return {"workflow_id": workflow_id, "recovered": recovered, "dead_letter": dead_letter}

    def retry_task(self, workflow_id: str, task_id: str, actor: str, note: str = "") -> dict[str, Any]:
        if not actor.startswith("materials-supervisor") and not actor.startswith("human:"):
            raise WorkflowError("only supervisor or human can retry a task")
        with self._lock:
            data, by_id = self._load_tasks(workflow_id)
            task = by_id.get(_safe_id(task_id))
            if task is None:
                raise WorkflowError(f"task not found: {task_id}")
            if task.get("status") not in {"failed", "blocked", "dead_letter"}:
                raise WorkflowError("only failed, blocked, or dead-letter tasks can be retried")
            if int(task.get("attempt", 0)) >= int(task.get("max_attempts", 3)):
                raise WorkflowError("task retry budget exhausted")
            task.update({"status": "pending", "claimed_by": None, "lease_until": None, "heartbeat_at": None, "dead_letter": None, "updated_at": _now()})
            data["status"] = "active"
            data["updated_at"] = _now()
            self._write_data(data)
            self._append_event({"event_id": f"mwe_{uuid.uuid4().hex[:16]}", "event": "task_retry_requested", "workflow_id": workflow_id, "task_id": task_id, "actor": actor, "note": note.strip(), "at": _now()})
            return dict(task)

    def complete_task(self, workflow_id: str, task_id: str, actor: str, output: dict[str, Any]) -> dict[str, Any]:
        result = AgentTaskOutput.from_dict(output)
        if result.task_id != task_id or result.workflow_id != workflow_id or result.agent != actor:
            raise WorkflowError("task output identity does not match the claimed task")
        with self._lock:
            data, by_id = self._load_tasks(workflow_id)
            task = by_id.get(_safe_id(task_id))
            if task is None:
                raise WorkflowError(f"task not found: {task_id}")
            result_dict = result.to_dict()
            expected_language = str(data.get("response_language", "en"))
            if result.response_language and result.response_language != expected_language:
                raise WorkflowError(
                    f"task output language {result.response_language!r} does not match workflow language {expected_language!r}"
                )
            result_dict["response_language"] = expected_language
            fingerprint_payload = {key: value for key, value in result_dict.items() if key != "created_at"}
            output_hash = hashlib.sha256(
                json.dumps(fingerprint_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).hexdigest()
            if task.get("status") in TASK_TERMINAL and task.get("output_hash") == output_hash:
                return dict(task)
            if task.get("status") != "running" or task.get("claimed_by") != actor:
                raise WorkflowError(f"task is not claimed by {actor}: {task_id}")
            if result.status in {"completed", "review"} and not self._gate_ready(data, task):
                raise WorkflowError("task gate is no longer satisfied")
            if result.status in {"completed", "review"} and task_id.startswith("dft:prepare"):
                if self._dft_engine(result.artifacts) == "vasp":
                    self._validate_vaspkit_plan(
                        result.artifacts,
                        final=False,
                        objective=str(data.get("goal") or ""),
                    )
            if result.status in {"completed", "review"} and task_id == "dft:audit":
                self._validate_dft_model_audit(result.artifacts)
                self._validate_dft_cost_audit(result.artifacts, data)
            if result.status in {"completed", "review"} and task_id == "dft:run":
                self._require_dft_approval(data, [*data.get("artifacts", []), *result.artifacts])
            if result.status in {"completed", "review"} and task_id.startswith("dft:postprocess"):
                workflow_artifacts = [*data.get("artifacts", []), *result.artifacts]
                if self._dft_engine(workflow_artifacts) == "vasp":
                    self._validate_vaspkit_plan(
                        workflow_artifacts,
                        final=True,
                        objective=str(data.get("goal") or ""),
                        output_artifacts=result.artifacts,
                    )
            if task_id == "design:brief" and result.status == "completed":
                data["design_brief"] = self._validate_design_brief(result.artifacts)
            if task_id.startswith("design:candidates:") and result.status == "completed":
                try:
                    iteration = int(task_id.rsplit(":", 1)[1])
                except ValueError as exc:
                    raise WorkflowError("invalid design candidate task id") from exc
                self._freeze_design_snapshot(data, iteration, result.artifacts)
            if task_id.startswith("design:physics:") and result.status == "completed":
                try:
                    iteration = int(task_id.rsplit(":", 1)[1])
                except ValueError as exc:
                    raise WorkflowError("invalid physics screen task id") from exc
                data.setdefault("physics_screens", {})[str(iteration)] = self._validate_physics_screen(data, iteration, result.artifacts)
            if task_id.startswith("design:novelty:"):
                try:
                    iteration = int(task_id.rsplit(":", 1)[1])
                except ValueError as exc:
                    raise WorkflowError("invalid novelty task id") from exc
                novelty = self._latest_novelty_audit(data, iteration)
                if not novelty or novelty.get("auditor") != actor:
                    raise WorkflowError("novelty task cannot complete before its isolated audit is recorded")
                required = {
                    str(novelty["artifact"]),
                    str(novelty["candidate_artifact"]),
                    str(novelty["evidence_graph_artifact"]),
                }
                if not required.issubset(set(result.artifacts)):
                    raise WorkflowError("novelty output must preserve the audit and frozen design artifacts")
                if result.status == "completed" and novelty.get("decision") not in {"pass", "pass_with_exclusions"}:
                    raise WorkflowError("a blocked novelty audit cannot complete successfully")
                if result.status == "blocked" and novelty.get("decision") != "blocked":
                    raise WorkflowError("a passing novelty audit cannot be reported as blocked")
            if task_id == "review:judge" and result.status == "completed":
                decision = (data.get("review_decision") or {}).get("decision")
                if decision != "approved":
                    raise WorkflowError("review judge can complete only after an approved vote")
            if task_id.startswith("review:") and task_id != "review:judge" and result.status in {"completed", "review"}:
                votes = [row for row in data.get("review_votes", []) if isinstance(row, dict)]
                if not any(row.get("task_id") == task_id and row.get("reviewer_id") == actor for row in votes):
                    raise WorkflowError("reviewer task cannot complete before its vote is recorded")
            task["status"] = result.status
            task["output"] = result_dict
            task["output_hash"] = output_hash
            task["lease_until"] = None
            task["heartbeat_at"] = _now()
            task["updated_at"] = _now()
            retry_scheduled = False
            if result.status in {"failed", "blocked"} and result.retryable:
                if int(task.get("attempt", 0)) < int(task.get("max_attempts", 3)):
                    task["status"] = "pending"
                    task["claimed_by"] = None
                    retry_scheduled = True
                else:
                    task["status"] = "dead_letter"
                    task["dead_letter"] = {"reason": "retryable_failure_attempts_exhausted", "at": _now()}
            data["artifacts"] = list(data.get("artifacts", [])) + list(result.artifacts)
            data["evidence"] = list(data.get("evidence", [])) + list(result.evidence)
            if result.status in {"failed", "blocked"}:
                tolerated = any(
                    task_id in downstream.get("dependencies", []) and downstream.get("continue_on_failure")
                    for downstream in data.get("tasks", [])
                    if isinstance(downstream, dict)
                )
                data["status"] = "degraded" if tolerated else result.status
            elif task_id == "complete" and result.status == "completed":
                data["status"] = "terminal"
                data["stage"] = "completed"
            data["updated_at"] = _now()
            self._write_data(data)
            self._append_event({"event_id": f"mwe_{uuid.uuid4().hex[:16]}", "event": "task_completed", "workflow_id": workflow_id, "task_id": task_id, "actor": actor, "status": result.status, "next_status": task["status"], "at": _now()})
            if retry_scheduled:
                self._append_event({"event_id": f"mwe_{uuid.uuid4().hex[:16]}", "event": "task_retry_scheduled", "workflow_id": workflow_id, "task_id": task_id, "actor": actor, "attempt": task.get("attempt"), "at": _now()})
            return dict(task)

    def record_review_vote(
        self,
        workflow_id: str,
        task_id: str,
        reviewer_id: str,
        scope: str,
        verdict: str,
        findings: list[dict[str, Any]] | None = None,
        evidence: list[str] | None = None,
        confidence: float = 0.0,
    ) -> dict[str, Any]:
        vote = ReviewVote(
            workflow_id=workflow_id,
            task_id=task_id,
            reviewer_id=reviewer_id,
            scope=scope,
            verdict=verdict,
            findings=list(findings or []),
            evidence=_as_list(evidence),
            confidence=confidence,
        )
        vote.validate()
        with self._lock:
            data, by_id = self._load_tasks(workflow_id)
            task = by_id.get(_safe_id(task_id))
            if task is None or not str(task.get("role", "")).startswith("materials-reviewer:"):
                raise WorkflowError("review votes must target a reviewer task")
            if reviewer_id != task.get("role"):
                raise WorkflowError("reviewer id does not match the reviewer task role")
            if task.get("status") != "running" or task.get("claimed_by") != reviewer_id:
                raise WorkflowError("reviewer task must be claimed before voting")
            votes = [row for row in data.get("review_votes", []) if isinstance(row, dict)]
            if any(row.get("task_id") == task_id and row.get("reviewer_id") == reviewer_id for row in votes):
                raise WorkflowError("reviewer has already voted for this task")
            votes.append(vote.to_dict())
            data["review_votes"] = votes
            self._write_data(data)
            self._append_event({"event_id": f"mwe_{uuid.uuid4().hex[:16]}", "event": "review_vote", "workflow_id": workflow_id, "task_id": task_id, "reviewer_id": reviewer_id, "verdict": verdict, "at": _now()})
            return self.review_summary(workflow_id)

    def review_summary(self, workflow_id: str) -> dict[str, Any]:
        data, _ = self._load_tasks(workflow_id)
        votes = [row for row in data.get("review_votes", []) if isinstance(row, dict)]
        counts = {value: sum(1 for vote in votes if vote.get("verdict") == value) for value in ("approve", "reject", "abstain")}
        if counts["approve"] >= 2 and counts["approve"] > counts["reject"]:
            decision = "approved"
        elif counts["reject"] >= 2 and counts["reject"] > counts["approve"]:
            decision = "rejected"
        else:
            decision = "needs_more_evidence"
        return {"workflow_id": workflow_id, "decision": decision, "quorum": 2, "counts": counts, "votes": votes}

    def finalize_review(self, workflow_id: str, actor: str, decision: str, note: str = "") -> dict[str, Any]:
        if actor != "materials-reviewer:judge":
            raise WorkflowError("only materials-reviewer:judge can finalize a vote")
        if decision not in {"approved", "rejected", "needs_more_evidence"}:
            raise WorkflowError("invalid review decision")
        summary = self.review_summary(workflow_id)
        if decision != summary["decision"]:
            raise WorkflowError(f"decision does not match vote summary: {summary['decision']}")
        with self._lock:
            data, by_id = self._load_tasks(workflow_id)
            judge = by_id.get("review:judge") or {}
            if judge.get("status") != "running" or judge.get("claimed_by") != actor:
                raise WorkflowError("review judge task must be claimed before finalization")
            data["review_decision"] = {"decision": decision, "actor": actor, "note": note.strip(), "at": _now()}
            self._write_data(data)
            self._append_event({"event_id": f"mwe_{uuid.uuid4().hex[:16]}", "event": "review_finalized", "workflow_id": workflow_id, "actor": actor, "decision": decision, "at": _now()})
            return data["review_decision"]


class EvolutionStore:
    """Append-only agent memory with explicit proposal and promotion stages."""

    def __init__(self, workspace: Path) -> None:
        self.root = workspace.resolve() / ".openscience"
        self.learning_path = self.root / "material-agent-learning.jsonl"
        self.rules_path = self.root / "material-agent-rules.jsonl"
        self.runtime_path = self.root / "material-runtime-policies.jsonl"
        self._lock = threading.RLock()

    def _append(self, path: Path, payload: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True, sort_keys=True) + "\n")

    @staticmethod
    def _read(path: Path) -> list[dict[str, Any]]:
        if not path.is_file():
            return []
        rows: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                rows.append(value)
        return rows

    def record_experience(
        self,
        workflow_id: str,
        agent: str,
        stage: str,
        lesson: str,
        evidence: Iterable[str],
        outcome: str,
        confidence: float,
        tags: Iterable[str] | None = None,
    ) -> dict[str, Any]:
        if not lesson or not lesson.strip():
            raise WorkflowError("lesson is required")
        if outcome not in {"success", "failure", "blocked", "mixed"}:
            raise WorkflowError("outcome must be success, failure, blocked, or mixed")
        if not 0.0 <= float(confidence) <= 1.0:
            raise WorkflowError("confidence must be between 0 and 1")
        record = {
            "experience_id": f"mle_{uuid.uuid4().hex[:16]}",
            "workflow_id": workflow_id,
            "agent": agent,
            "stage": stage,
            "lesson": lesson.strip(),
            "evidence": _as_list(evidence),
            "outcome": outcome,
            "confidence": round(float(confidence), 4),
            "tags": _as_list(tags),
            "created_at": _now(),
        }
        with self._lock:
            self._append(self.learning_path, record)
        return record

    def propose_rule(self, agent: str, scope: str, rule: str, evidence: Iterable[str]) -> dict[str, Any]:
        if not agent or not scope or not rule:
            raise WorkflowError("agent, scope, and rule are required")
        fingerprint = hashlib.sha256(f"{agent}\n{scope}\n{rule}".encode("utf-8")).hexdigest()[:20]
        proposal = {
            "proposal_id": f"mep_{uuid.uuid4().hex[:16]}",
            "fingerprint": fingerprint,
            "agent": agent,
            "scope": scope,
            "rule": rule.strip(),
            "evidence": _as_list(evidence),
            "status": "pending",
            "created_at": _now(),
        }
        with self._lock:
            previous = [row for row in self._read(self.rules_path) if row.get("fingerprint") == fingerprint]
            if previous and previous[-1].get("status") not in {"rolled_back", "canary_failed", "evaluation_failed"}:
                return previous[-1]
            self._append(self.rules_path, proposal)
        return proposal

    def _latest_proposal(self, proposal_id: str) -> dict[str, Any]:
        rows = self._read(self.rules_path)
        proposal = next((row for row in reversed(rows) if row.get("proposal_id") == proposal_id), None)
        if proposal is None:
            raise WorkflowError(f"rule proposal not found: {proposal_id}")
        return proposal

    def evaluate_rule(self, proposal_id: str, benchmark_report: dict[str, Any]) -> dict[str, Any]:
        """Attach an offline benchmark result before any canary exposure."""
        proposal = self._latest_proposal(proposal_id)
        metrics = dict(benchmark_report.get("metrics") or {})
        baseline_score = float(benchmark_report.get("baseline_score", metrics.get("baseline_score", 0.0)))
        candidate_score = float(benchmark_report.get("candidate_score", metrics.get("candidate_score", -1.0)))
        passed = (
            bool(benchmark_report.get("passed"))
            and bool(benchmark_report.get("replay_passed"))
            and candidate_score >= baseline_score
            and not benchmark_report.get("regressions")
        )
        status = "evaluated" if passed else "evaluation_failed"
        result = {
            **proposal,
            "status": status,
            "benchmark": benchmark_report,
            "evaluated_at": _now(),
        }
        with self._lock:
            self._append(self.rules_path, result)
        return result

    def start_canary(self, proposal_id: str, cohort: Iterable[str]) -> dict[str, Any]:
        proposal = self._latest_proposal(proposal_id)
        if proposal.get("status") != "evaluated":
            raise WorkflowError("only an evaluated rule can enter canary")
        cohort_list = _as_list(cohort)
        if not cohort_list:
            raise WorkflowError("canary cohort cannot be empty")
        result = {**proposal, "status": "canary", "canary_cohort": cohort_list, "canary_started_at": _now()}
        with self._lock:
            self._append(self.rules_path, result)
        return result

    def finish_canary(self, proposal_id: str, metrics: dict[str, Any]) -> dict[str, Any]:
        proposal = self._latest_proposal(proposal_id)
        if proposal.get("status") != "canary":
            raise WorkflowError("only an active canary can be finished")
        regressions = metrics.get("regressions") or []
        sample_size = int(metrics.get("sample_size", 0))
        passed = sample_size > 0 and bool(metrics.get("passed", not regressions)) and not regressions
        result = {**proposal, "status": "canary_passed" if passed else "canary_failed", "canary_metrics": dict(metrics), "canary_finished_at": _now()}
        with self._lock:
            self._append(self.rules_path, result)
        return result

    def promote_rule(self, proposal_id: str, approved_by: str) -> dict[str, Any]:
        if not approved_by or not (approved_by == "materials-reviewer" or approved_by.startswith("human:")):
            raise WorkflowError("rules require materials-reviewer or an explicit human:<id> approver")
        proposal = self._latest_proposal(proposal_id)
        if proposal.get("status") == "approved":
            return proposal
        if proposal.get("status") != "canary_passed":
            raise WorkflowError("rule must pass offline evaluation and canary before promotion")
        promoted = {
            **proposal,
            "status": "approved",
            "approved_by": approved_by,
            "approved_at": _now(),
        }
        with self._lock:
            self._append(self.rules_path, promoted)
        return promoted

    def rollback_rule(self, proposal_id: str, reason: str, approved_by: str) -> dict[str, Any]:
        if not reason.strip():
            raise WorkflowError("rollback reason is required")
        if not approved_by or not (approved_by == "materials-reviewer" or approved_by.startswith("human:")):
            raise WorkflowError("rollback requires materials-reviewer or an explicit human:<id> approver")
        proposal = self._latest_proposal(proposal_id)
        if proposal.get("status") not in {"approved", "canary_passed"}:
            raise WorkflowError("only an approved or canary-passed rule can be rolled back")
        result = {**proposal, "status": "rolled_back", "rollback_reason": reason.strip(), "rolled_back_by": approved_by, "rolled_back_at": _now()}
        with self._lock:
            self._append(self.rules_path, result)
        return result

    def context(self, agent: str, limit: int = 12) -> dict[str, Any]:
        rows = self._read(self.rules_path)
        latest: dict[str, dict[str, Any]] = {}
        for row in rows:
            proposal_id = row.get("proposal_id")
            if proposal_id:
                latest[str(proposal_id)] = row
        approved = [
            row for row in latest.values()
            if row.get("status") == "approved"
            and (row.get("agent") == agent or (row.get("agent") == "materials-supervisor" and row.get("scope") == "global"))
        ]
        experiences = [row for row in self._read(self.learning_path) if row.get("agent") == agent]
        return {
            "agent": agent,
            "approved_rules": approved[-limit:],
            "recent_experiences": experiences[-limit:],
            "policy": "Use approved rules as hypotheses; never treat them as a substitute for deterministic validation.",
        }

    def propose_runtime_policy(
        self,
        provider: str,
        changes: dict[str, Any],
        evidence: Iterable[str],
        proposed_by: str = "materials-supervisor",
    ) -> dict[str, Any]:
        """Create a typed, bounded provider-policy proposal."""
        from .execution import ProviderPolicy

        if not provider.strip() or not isinstance(changes, dict) or not changes:
            raise WorkflowError("provider and non-empty policy changes are required")
        baseline = ProviderPolicy()
        # Validation rejects unknown or unsafe values before a proposal can be
        # evaluated. It does not apply the candidate to live traffic.
        candidate = baseline.with_changes(changes)
        fingerprint = hashlib.sha256(
            json.dumps({"provider": provider, "changes": candidate.to_dict()}, sort_keys=True).encode("utf-8")
        ).hexdigest()[:20]
        proposal = {
            "proposal_id": f"mrp_{uuid.uuid4().hex[:16]}",
            "fingerprint": fingerprint,
            "provider": provider,
            "changes": candidate.to_dict(),
            "evidence": _as_list(evidence),
            "proposed_by": proposed_by,
            "status": "pending",
            "created_at": _now(),
        }
        with self._lock:
            previous = [row for row in self._read(self.runtime_path) if row.get("fingerprint") == fingerprint]
            if previous and previous[-1].get("status") not in {"rolled_back", "evaluation_failed", "canary_failed"}:
                return previous[-1]
            self._append(self.runtime_path, proposal)
        return proposal

    def _latest_runtime_policy(self, proposal_id: str) -> dict[str, Any]:
        rows = self._read(self.runtime_path)
        proposal = next((row for row in reversed(rows) if row.get("proposal_id") == proposal_id), None)
        if proposal is None:
            raise WorkflowError(f"runtime policy proposal not found: {proposal_id}")
        return proposal

    def evaluate_runtime_policy(self, proposal_id: str, report: dict[str, Any]) -> dict[str, Any]:
        proposal = self._latest_runtime_policy(proposal_id)
        baseline = float(report.get("baseline_score", 0.0))
        candidate = float(report.get("candidate_score", -1.0))
        passed = bool(report.get("passed")) and bool(report.get("replay_passed", True)) and candidate >= baseline and not report.get("regressions")
        result = {**proposal, "status": "evaluated" if passed else "evaluation_failed", "benchmark": dict(report), "evaluated_at": _now()}
        with self._lock:
            self._append(self.runtime_path, result)
        return result

    def start_runtime_canary(self, proposal_id: str, cohort: Iterable[str]) -> dict[str, Any]:
        proposal = self._latest_runtime_policy(proposal_id)
        if proposal.get("status") != "evaluated":
            raise WorkflowError("only an evaluated runtime policy can enter canary")
        members = _as_list(cohort)
        if not members:
            raise WorkflowError("runtime policy canary cohort cannot be empty")
        result = {**proposal, "status": "canary", "canary_cohort": members, "canary_started_at": _now()}
        with self._lock:
            self._append(self.runtime_path, result)
        return result

    def finish_runtime_canary(self, proposal_id: str, report: dict[str, Any]) -> dict[str, Any]:
        proposal = self._latest_runtime_policy(proposal_id)
        if proposal.get("status") != "canary":
            raise WorkflowError("only an active runtime policy canary can be finished")
        passed = int(report.get("sample_size", 0)) > 0 and bool(report.get("passed", True)) and not report.get("regressions")
        result = {**proposal, "status": "canary_passed" if passed else "canary_failed", "canary_metrics": dict(report), "canary_finished_at": _now()}
        with self._lock:
            self._append(self.runtime_path, result)
        return result

    def promote_runtime_policy(self, proposal_id: str, approved_by: str) -> dict[str, Any]:
        if not (approved_by == "materials-reviewer" or approved_by.startswith("human:")):
            raise WorkflowError("runtime policies require materials-reviewer or human:<id> approval")
        proposal = self._latest_runtime_policy(proposal_id)
        if proposal.get("status") != "canary_passed":
            raise WorkflowError("runtime policy must pass offline evaluation and canary")
        result = {**proposal, "status": "approved", "approved_by": approved_by, "approved_at": _now()}
        with self._lock:
            self._append(self.runtime_path, result)
        return result

    def rollback_runtime_policy(self, proposal_id: str, reason: str, approved_by: str) -> dict[str, Any]:
        if not reason.strip() or not (approved_by == "materials-reviewer" or approved_by.startswith("human:")):
            raise WorkflowError("runtime rollback requires a reason and reviewer or human approval")
        proposal = self._latest_runtime_policy(proposal_id)
        if proposal.get("status") not in {"approved", "canary_passed"}:
            raise WorkflowError("only an approved runtime policy can be rolled back")
        result = {**proposal, "status": "rolled_back", "rollback_reason": reason.strip(), "rolled_back_by": approved_by, "rolled_back_at": _now()}
        with self._lock:
            self._append(self.runtime_path, result)
        return result

    def runtime_policy_context(self, provider: str) -> dict[str, Any]:
        latest: dict[str, dict[str, Any]] = {}
        for row in self._read(self.runtime_path):
            if row.get("provider") == provider and row.get("proposal_id"):
                latest[str(row["proposal_id"])] = row
        approved = [row for row in latest.values() if row.get("status") == "approved"]
        return {"provider": provider, "approved_policies": approved, "policy": "Runtime policies are bounded, versioned, and never self-applied without promotion."}
