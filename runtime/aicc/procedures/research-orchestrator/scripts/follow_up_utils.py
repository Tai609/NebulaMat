"""Helpers for report-blocking follow-up proposal state."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


BLOCKING_PROPOSAL_STATUSES = {"validated", "accepted"}
RESOLVED_STATUSES = {"resolved", "waived", "limited", "closed", "not-required", "not_required"}
RESOLUTION_DECISION_KINDS = {
    "follow-up-resolution",
    "follow_up_resolution",
    "follow-up-waiver",
    "follow_up_waiver",
    "follow-up-decision",
    "follow_up_decision",
}
RESOLUTION_DECISIONS = {
    "resolved",
    "waived",
    "limited",
    "accepted-limitation",
    "accepted_limitation",
    "rejected",
    "not-required",
    "not_required",
}


@dataclass(frozen=True)
class FollowUpBlocker:
    artifact_id: str
    status: str
    path: str
    reason: str

    def message(self) -> str:
        return f"{self.artifact_id} is {self.status}: {self.reason} ({self.path})"


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def references_id(value: Any, target_id: str) -> bool:
    if isinstance(value, str):
        return value == target_id
    if isinstance(value, dict):
        for key in ["artifact_id", "follow_up_id", "follow-up-id", "id"]:
            if value.get(key) == target_id:
                return True
        return any(references_id(item, target_id) for item in value.values())
    if isinstance(value, list):
        return any(references_id(item, target_id) for item in value)
    return False


def proposal_blocks_report(row: dict[str, Any]) -> bool:
    if row.get("type") != "follow-up-proposal":
        return False
    if row.get("status") not in BLOCKING_PROPOSAL_STATUSES:
        return False
    for field in ["blocks_report", "report_blocking", "required_before_report"]:
        if row.get(field) is False:
            return False
    return True


def proposal_has_inline_resolution(row: dict[str, Any]) -> bool:
    status = row.get("resolution_status") or row.get("follow_up_status")
    if isinstance(status, str) and status in RESOLVED_STATUSES:
        return True
    if row.get("resolved_by") or row.get("waived_by") or row.get("limitation_note"):
        return True
    return False


def decision_resolves_proposal(decision: dict[str, Any], proposal_id: str) -> bool:
    if decision.get("artifact_id") != proposal_id and not references_id(decision.get("resolves_follow_up"), proposal_id):
        return False
    kind = decision.get("kind")
    outcome = decision.get("decision")
    return kind in RESOLUTION_DECISION_KINDS and outcome in RESOLUTION_DECISIONS


def artifact_resolves_proposal(row: dict[str, Any], proposal_id: str) -> bool:
    if row.get("artifact_id") == proposal_id:
        return False
    if row.get("status") != "accepted":
        return False
    if references_id(row.get("resolves_follow_up"), proposal_id):
        return True
    if row.get("type") == "limitation-note" and references_id(row.get("provenance"), proposal_id):
        return True
    return False


def task_resolves_proposal(task: dict[str, Any], proposal_id: str) -> bool:
    if task.get("status") != "accepted":
        return False
    return references_id(task.get("resolves_follow_up"), proposal_id)


def unresolved_follow_up_proposals(
    artifacts: dict[str, dict[str, Any]] | list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    tasks: dict[str, dict[str, Any]] | None = None,
) -> list[FollowUpBlocker]:
    if isinstance(artifacts, dict):
        rows = list(artifacts.values())
    else:
        rows = list(artifacts)
    tasks = tasks or {}

    blockers: list[FollowUpBlocker] = []
    for row in sorted(rows, key=lambda item: str(item.get("artifact_id", ""))):
        artifact_id = row.get("artifact_id")
        if not isinstance(artifact_id, str) or not proposal_blocks_report(row):
            continue
        if proposal_has_inline_resolution(row):
            continue
        if any(decision_resolves_proposal(decision, artifact_id) for decision in decisions):
            continue
        if any(artifact_resolves_proposal(candidate, artifact_id) for candidate in rows):
            continue
        if any(task_resolves_proposal(task, artifact_id) for task in tasks.values()):
            continue
        reason = str(row.get("summary") or row.get("reason") or "follow-up proposal is not resolved")
        blockers.append(
            FollowUpBlocker(
                artifact_id=artifact_id,
                status=str(row.get("status", "")),
                path=str(row.get("path", "")),
                reason=reason,
            )
        )
    return blockers


def format_follow_up_blockers(blockers: list[FollowUpBlocker]) -> str:
    return "; ".join(blocker.message() for blocker in blockers)
