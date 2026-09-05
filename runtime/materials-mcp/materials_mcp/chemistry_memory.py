"""Governed chemistry memory adapted from ChemAgent's three-memory method.

ChemAgent (https://github.com/gersteinlab/ChemAgent) separates reusable
planning, execution, and scientific knowledge memories. NebulaMat keeps that
separation while replacing model-specific vector stores and generated-code
execution with deterministic local retrieval and the existing review gates.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import unicodedata
import uuid
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .workflow import WorkflowError


MEMORY_TYPES = ("plan", "execution", "knowledge")
MEMORY_STATUSES = (
    "pending",
    "evaluated",
    "evaluation_failed",
    "canary",
    "canary_passed",
    "canary_failed",
    "approved",
    "rolled_back",
)
EXECUTION_OUTCOMES = ("success", "failure", "blocked", "mixed")
TERMINAL_RETRY_STATUSES = {"evaluation_failed", "canary_failed", "rolled_back"}
_WORD_RE = re.compile(r"[a-z0-9]+(?:[._+\-][a-z0-9]+)*")
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]+")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _strings(values: Iterable[str] | None) -> list[str]:
    if isinstance(values, str):
        values = [values]
    return [str(value).strip() for value in (values or []) if str(value).strip()]


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise WorkflowError(f"{field} is required")
    return value.strip()


def _required_string_list(value: Any, field: str) -> list[str]:
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(item, str) or not item.strip() for item in value)
    ):
        raise WorkflowError(f"{field} must be a non-empty list of strings")
    return [item.strip() for item in value]


def _jsonable(value: Any, field: str) -> Any:
    try:
        json.dumps(value, ensure_ascii=True, sort_keys=True)
    except (TypeError, ValueError) as exc:
        raise WorkflowError(f"{field} must be JSON serializable") from exc
    return value


def _validate_payload(memory_type: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise WorkflowError("payload must be an object")
    result = dict(payload)
    if memory_type == "plan":
        result["strategy"] = _required_text(payload.get("strategy"), "payload.strategy")
        result["steps"] = _required_string_list(payload.get("steps"), "payload.steps")
        if "failure_modes" in payload:
            result["failure_modes"] = _required_string_list(
                payload.get("failure_modes"), "payload.failure_modes"
            )
    elif memory_type == "execution":
        result["goal"] = _required_text(payload.get("goal"), "payload.goal")
        trace = payload.get("trace")
        if not isinstance(trace, list) or not trace:
            raise WorkflowError("payload.trace must be a non-empty list")
        for item in trace:
            if not isinstance(item, (str, Mapping)):
                raise WorkflowError("payload.trace entries must be strings or objects")
            if isinstance(item, str) and not item.strip():
                raise WorkflowError("payload.trace entries cannot be empty")
        result["trace"] = _jsonable(trace, "payload.trace")
        if "result" not in payload:
            raise WorkflowError("payload.result is required")
        result["result"] = _jsonable(payload.get("result"), "payload.result")
        result["reflection"] = _required_text(
            payload.get("reflection"), "payload.reflection"
        )
        outcome = _required_text(payload.get("outcome"), "payload.outcome")
        if outcome not in EXECUTION_OUTCOMES:
            raise WorkflowError(
                "payload.outcome must be success, failure, blocked, or mixed"
            )
        result["outcome"] = outcome
    elif memory_type == "knowledge":
        result["concept"] = _required_text(payload.get("concept"), "payload.concept")
        result["statement"] = _required_text(
            payload.get("statement"), "payload.statement"
        )
        result["associations"] = _required_string_list(
            payload.get("associations"), "payload.associations"
        )
    else:
        raise WorkflowError(f"memory_type must be one of: {', '.join(MEMORY_TYPES)}")
    return _jsonable(result, "payload")


def _flatten_text(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, Mapping):
        result: list[str] = []
        for key, nested in value.items():
            result.append(str(key))
            result.extend(_flatten_text(nested))
        return result
    if isinstance(value, Iterable) and not isinstance(value, (bytes, bytearray)):
        result = []
        for nested in value:
            result.extend(_flatten_text(nested))
        return result
    if value is None:
        return []
    return [str(value)]


def _tokenize(value: Any) -> set[str]:
    text = unicodedata.normalize("NFKC", " ".join(_flatten_text(value))).casefold()
    tokens = set(_WORD_RE.findall(text))
    for run in _CJK_RE.findall(text):
        tokens.update(run)
        tokens.update(run[index : index + 2] for index in range(len(run) - 1))
    return tokens


def _weighted_jaccard(query_tokens: set[str], fields: Iterable[tuple[Any, float]]) -> float:
    if not query_tokens:
        return 0.0
    materialized = [(value, float(weight)) for value, weight in fields]
    max_weight = max((weight for _, weight in materialized), default=1.0)
    best = 0.0
    for value, weight in materialized:
        field_tokens = _tokenize(value)
        union = query_tokens | field_tokens
        if union:
            jaccard = len(query_tokens & field_tokens) / len(union)
            best = max(best, jaccard * (weight / max_weight))
    return best


def _memory_fields(memory: Mapping[str, Any], association: bool = False) -> list[tuple[Any, float]]:
    payload = memory.get("payload") or {}
    fields: list[tuple[Any, float]] = [
        (memory.get("query", ""), 3.0),
        (memory.get("domain", ""), 1.5),
        (memory.get("tags") or [], 1.5),
    ]
    memory_type = memory.get("memory_type")
    if memory_type == "plan":
        fields.extend(((payload.get("strategy", ""), 2.5), (payload.get("steps") or [], 1.5)))
    elif memory_type == "execution":
        fields.extend(
            (
                (payload.get("goal", ""), 2.5),
                (payload.get("trace") or [], 1.0),
                (payload.get("result", ""), 1.5),
                (payload.get("reflection", ""), 2.0),
            )
        )
    elif memory_type == "knowledge":
        fields.extend(
            (
                (payload.get("concept", ""), 3.0),
                (payload.get("statement", ""), 2.0),
                (payload.get("associations") or [], 3.0 if association else 2.0),
            )
        )
    return fields


class ChemistryMemoryStore:
    """Workspace-local, append-only chemistry memory with explicit promotion."""

    def __init__(self, workspace: Path) -> None:
        self.root = workspace.resolve() / ".openscience"
        self.path = self.root / "chemistry-memory.jsonl"
        self._lock = threading.RLock()

    def _append(self, payload: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True, sort_keys=True) + "\n")

    def _read(self) -> list[dict[str, Any]]:
        if not self.path.is_file():
            return []
        rows: list[dict[str, Any]] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                rows.append(value)
        return rows

    def _latest(self) -> dict[str, dict[str, Any]]:
        latest: dict[str, dict[str, Any]] = {}
        for row in self._read():
            memory_id = row.get("memory_id")
            if memory_id:
                latest[str(memory_id)] = row
        return latest

    def _get(self, memory_id: str) -> dict[str, Any]:
        memory = self._latest().get(memory_id)
        if memory is None:
            raise WorkflowError(f"chemistry memory not found: {memory_id}")
        return memory

    def record(
        self,
        memory_type: str,
        workflow_id: str,
        agent: str,
        query: str,
        payload: dict[str, Any],
        evidence: Iterable[str],
        confidence: float,
        domain: str = "chemistry",
        tags: Iterable[str] | None = None,
    ) -> dict[str, Any]:
        memory_type = _required_text(memory_type, "memory_type").casefold()
        if memory_type not in MEMORY_TYPES:
            raise WorkflowError(f"memory_type must be one of: {', '.join(MEMORY_TYPES)}")
        workflow_id = _required_text(workflow_id, "workflow_id")
        agent = _required_text(agent, "agent")
        query = _required_text(query, "query")
        domain = _required_text(domain, "domain").casefold()
        try:
            evidence_values = list(evidence) if not isinstance(evidence, str) else []
        except TypeError:
            evidence_values = []
        try:
            evidence_list = _required_string_list(evidence_values, "evidence")
        except WorkflowError as exc:
            raise WorkflowError("at least one string evidence reference is required") from exc
        if not 0.0 <= float(confidence) <= 1.0:
            raise WorkflowError("confidence must be between 0 and 1")
        normalized_payload = _validate_payload(memory_type, payload)
        normalized_tags = sorted(set(tag.casefold() for tag in _strings(tags)))
        fingerprint_input = {
            "memory_type": memory_type,
            "query": query,
            "payload": normalized_payload,
            "domain": domain,
            "tags": normalized_tags,
        }
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_input, ensure_ascii=True, sort_keys=True).encode("utf-8")
        ).hexdigest()[:24]
        record = {
            "memory_id": f"cmm_{uuid.uuid4().hex[:16]}",
            "memory_type": memory_type,
            "workflow_id": workflow_id,
            "agent": agent,
            "query": query,
            "payload": normalized_payload,
            "domain": domain,
            "tags": normalized_tags,
            "evidence": evidence_list,
            "confidence": round(float(confidence), 4),
            "status": "pending",
            "fingerprint": fingerprint,
            "created_at": _now(),
        }
        with self._lock:
            previous = [
                row
                for row in self._latest().values()
                if row.get("fingerprint") == fingerprint
            ]
            if previous:
                latest = max(previous, key=lambda row: str(row.get("created_at", "")))
                if latest.get("status") not in TERMINAL_RETRY_STATUSES:
                    return latest
            self._append(record)
        return record

    def evaluate(self, memory_id: str, benchmark_report: dict[str, Any]) -> dict[str, Any]:
        memory = self._get(memory_id)
        if memory.get("status") != "pending":
            raise WorkflowError("only a pending chemistry memory can be evaluated")
        metrics = dict(benchmark_report.get("metrics") or {})
        baseline = float(benchmark_report.get("baseline_score", metrics.get("baseline_score", 0.0)))
        candidate = float(benchmark_report.get("candidate_score", metrics.get("candidate_score", -1.0)))
        passed = (
            bool(benchmark_report.get("passed"))
            and bool(benchmark_report.get("replay_passed"))
            and candidate >= baseline
            and not benchmark_report.get("regressions")
        )
        result = {
            **memory,
            "status": "evaluated" if passed else "evaluation_failed",
            "benchmark": dict(benchmark_report),
            "evaluated_at": _now(),
        }
        with self._lock:
            self._append(result)
        return result

    def start_canary(self, memory_id: str, cohort: Iterable[str]) -> dict[str, Any]:
        memory = self._get(memory_id)
        if memory.get("status") != "evaluated":
            raise WorkflowError("only an evaluated chemistry memory can enter canary")
        members = sorted(set(_strings(cohort)))
        if not members:
            raise WorkflowError("chemistry memory canary cohort cannot be empty")
        result = {
            **memory,
            "status": "canary",
            "canary_cohort": members,
            "canary_started_at": _now(),
        }
        with self._lock:
            self._append(result)
        return result

    def finish_canary(self, memory_id: str, report: dict[str, Any]) -> dict[str, Any]:
        memory = self._get(memory_id)
        if memory.get("status") != "canary":
            raise WorkflowError("only an active chemistry memory canary can be finished")
        regressions = report.get("regressions") or []
        passed = (
            int(report.get("sample_size", 0)) > 0
            and bool(report.get("passed"))
            and not regressions
        )
        result = {
            **memory,
            "status": "canary_passed" if passed else "canary_failed",
            "canary_metrics": dict(report),
            "canary_finished_at": _now(),
        }
        with self._lock:
            self._append(result)
        return result

    def promote(self, memory_id: str, approved_by: str) -> dict[str, Any]:
        if not approved_by or not (
            approved_by == "materials-reviewer" or approved_by.startswith("human:")
        ):
            raise WorkflowError(
                "chemistry memories require materials-reviewer or human:<id> approval"
            )
        memory = self._get(memory_id)
        if memory.get("status") == "approved":
            return memory
        if memory.get("status") != "canary_passed":
            raise WorkflowError(
                "chemistry memory must pass offline evaluation and canary before promotion"
            )
        result = {
            **memory,
            "status": "approved",
            "approved_by": approved_by,
            "approved_at": _now(),
        }
        with self._lock:
            self._append(result)
        return result

    def rollback(self, memory_id: str, reason: str, approved_by: str) -> dict[str, Any]:
        reason = _required_text(reason, "rollback reason")
        if not approved_by or not (
            approved_by == "materials-reviewer" or approved_by.startswith("human:")
        ):
            raise WorkflowError(
                "chemistry memory rollback requires materials-reviewer or human:<id> approval"
            )
        memory = self._get(memory_id)
        if memory.get("status") not in {"approved", "canary_passed"}:
            raise WorkflowError(
                "only an approved or canary-passed chemistry memory can be rolled back"
            )
        result = {
            **memory,
            "status": "rolled_back",
            "rollback_reason": reason,
            "rolled_back_by": approved_by,
            "rolled_back_at": _now(),
        }
        with self._lock:
            self._append(result)
        return result

    @staticmethod
    def _visible(memory: Mapping[str, Any], canary_cohort: str | None) -> bool:
        if memory.get("status") == "approved":
            return True
        return bool(
            canary_cohort
            and memory.get("status") == "canary"
            and canary_cohort in (memory.get("canary_cohort") or [])
        )

    @staticmethod
    def _score(
        memory: Mapping[str, Any],
        query_tokens: set[str],
        domain: str | None,
        tags: set[str],
        association: bool = False,
    ) -> float:
        lexical = _weighted_jaccard(query_tokens, _memory_fields(memory, association))
        domain_boost = 0.12 if domain and memory.get("domain") == domain else 0.0
        memory_tags = set(memory.get("tags") or [])
        tag_boost = 0.12 * (len(tags & memory_tags) / len(tags)) if tags else 0.0
        quality = 0.75 + 0.25 * float(memory.get("confidence", 0.0))
        return round((lexical + domain_boost + tag_boost) * quality, 6)

    def search(
        self,
        query: str,
        memory_types: Iterable[str] | None = None,
        domain: str | None = None,
        tags: Iterable[str] | None = None,
        limit: int = 8,
        canary_cohort: str | None = None,
        association_threshold: float = 0.15,
    ) -> dict[str, Any]:
        query = _required_text(query, "query")
        if not 1 <= int(limit) <= 100:
            raise WorkflowError("limit must be between 1 and 100")
        if not 0.0 <= float(association_threshold) <= 1.0:
            raise WorkflowError("association_threshold must be between 0 and 1")
        selected_types = [value.casefold() for value in _strings(memory_types)]
        if any(value not in MEMORY_TYPES for value in selected_types):
            raise WorkflowError(f"memory_types must contain only: {', '.join(MEMORY_TYPES)}")
        normalized_domain = domain.strip().casefold() if domain and domain.strip() else None
        normalized_tags = set(tag.casefold() for tag in _strings(tags))
        candidates = [
            memory
            for memory in self._latest().values()
            if self._visible(memory, canary_cohort)
            and (not normalized_domain or memory.get("domain") == normalized_domain)
            and (not normalized_tags or normalized_tags.issubset(set(memory.get("tags") or [])))
        ]
        query_tokens = _tokenize(query)

        def ranked(values: Iterable[dict[str, Any]], association: bool = False) -> list[dict[str, Any]]:
            results = []
            for memory in values:
                score = self._score(
                    memory, query_tokens, normalized_domain, normalized_tags, association
                )
                if score > 0.0:
                    results.append({**memory, "retrieval_score": score})
            return sorted(
                results,
                key=lambda row: (
                    float(row.get("retrieval_score", 0.0)),
                    float(row.get("confidence", 0.0)),
                    str(row.get("created_at", "")),
                ),
                reverse=True,
            )

        if selected_types:
            results = ranked(
                memory for memory in candidates if memory.get("memory_type") in selected_types
            )
            mode = (
                "knowledge_association"
                if set(selected_types) == {"knowledge"}
                else "direct"
            )
        else:
            direct = ranked(
                memory
                for memory in candidates
                if memory.get("memory_type") in {"plan", "execution"}
            )
            top_score = float(direct[0]["retrieval_score"]) if direct else 0.0
            if top_score >= float(association_threshold):
                results = direct
                mode = "direct"
            else:
                results = ranked(
                    (
                        memory
                        for memory in candidates
                        if memory.get("memory_type") == "knowledge"
                    ),
                    association=True,
                )
                mode = "knowledge_association"
        return {
            "query": query,
            "retrieval_mode": mode,
            "results": results[: int(limit)],
            "policy": (
                "Retrieved memories are reviewed hypotheses, not scientific evidence. "
                "Revalidate claims and preserve source provenance."
            ),
        }

    def list(
        self,
        memory_type: str | None = None,
        status: str | None = None,
        domain: str | None = None,
        tags: Iterable[str] | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        if not 1 <= int(limit) <= 500:
            raise WorkflowError("limit must be between 1 and 500")
        normalized_type = memory_type.strip().casefold() if memory_type else None
        normalized_status = status.strip().casefold() if status else None
        normalized_domain = domain.strip().casefold() if domain else None
        normalized_tags = set(tag.casefold() for tag in _strings(tags))
        if normalized_type and normalized_type not in MEMORY_TYPES:
            raise WorkflowError(f"memory_type must be one of: {', '.join(MEMORY_TYPES)}")
        if normalized_status and normalized_status not in MEMORY_STATUSES:
            raise WorkflowError(f"status must be one of: {', '.join(MEMORY_STATUSES)}")
        memories = [
            memory
            for memory in self._latest().values()
            if (not normalized_type or memory.get("memory_type") == normalized_type)
            and (not normalized_status or memory.get("status") == normalized_status)
            and (not normalized_domain or memory.get("domain") == normalized_domain)
            and (not normalized_tags or normalized_tags.issubset(set(memory.get("tags") or [])))
        ]
        memories.sort(key=lambda row: str(row.get("created_at", "")), reverse=True)
        return {"memories": memories[: int(limit)], "count": min(len(memories), int(limit))}
