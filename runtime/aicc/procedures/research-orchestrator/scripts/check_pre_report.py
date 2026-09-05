#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6.0"]
# ///
"""Block report generation unless report gate and consumed claims are acceptable."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from follow_up_utils import FollowUpBlocker, format_follow_up_blockers, unresolved_follow_up_proposals
from gate_hook_utils import artifact_path, load_state, require_passing_gate, task_input_artifact_ids
from lease_utils import append_event, fail_if_invalid, iso, now_local, parse_time
from scaffold_follow_up_tasks import scaffold_tasks_from_proposal
from validate_state import load_jsonl


REPORTABLE_OUTCOMES = {"addresses", "contradicts", "inconclusive"}
STAGE_SYNTHESIS_MODES = {"stage-synthesis", "stage_synthesis", "interim"}
FIGURE_ROUTING_ARTIFACT_TYPES = {"figure", "report-manifest"}
TEXT_SIDE_EXTENSIONS = {".json", ".md", ".txt", ".yaml", ".yml"}
MAX_SIDE_TEXT_BYTES = 300_000
FIGURE_METADATA_KEYS = {
    "metadata_path",
    "provenance_path",
    "render_metadata_path",
    "render_provenance_path",
    "sidecar",
    "sidecar_path",
}
VASP_VOLUMETRIC_TERMS = (
    "chgcar",
    "chgdiff",
    "parchg",
    "elfcar",
    "wavecar",
    "wfn_real",
    "delta rho",
    "delta-rho",
    "delta_rho",
    "charge density difference",
    "charge-density difference",
    "charge-density-difference",
    "spin density",
    "spin-density",
    "wavefunction",
    "wave function",
    "partial charge density",
    "vasp volumetric",
    "chgcar-like",
)
CHARGE_DENSITY_DIFFERENCE_TERMS = (
    "chgdiff",
    "delta rho",
    "delta-rho",
    "delta_rho",
    "charge density difference",
    "charge-density difference",
    "charge-density-difference",
)
VOLUMETRIC_VIS_REF_TERMS = (
    "tools/vasp/references/volumetric-visualization.md",
    "vasp/references/volumetric-visualization.md",
)
VASP_ELECTRONIC_REF_TERMS = (
    "tools/vasp/references/electronic-analysis.md",
    "vasp/references/electronic-analysis.md",
)


def gate_scope_claims(gate: dict[str, object]) -> set[str]:
    scope = gate.get("scope")
    if not isinstance(scope, dict):
        return set()
    claims = scope.get("claims")
    if isinstance(claims, str):
        return {claims}
    if isinstance(claims, list):
        return {claim for claim in claims if isinstance(claim, str)}
    return set()


def selected_report_task(tasks: dict[str, dict[str, object]], task_id: str | None) -> dict[str, object]:
    if task_id:
        task = tasks.get(task_id)
        if task is None:
            raise SystemExit(f"pre_report blocked: task not found: {task_id}")
        return task
    candidates = [
        task
        for task in tasks.values()
        if task.get("role") == "synthesis-report" or task.get("skill") == "report"
    ]
    if len(candidates) != 1:
        raise SystemExit("pre_report blocked: pass TASK_ID when there is not exactly one report task")
    return candidates[0]


def is_stage_synthesis(task: dict[str, object]) -> bool:
    for field in ["report_mode", "mode", "stage", "workflow_stage"]:
        value = task.get(field)
        if isinstance(value, str) and value.strip().lower() in STAGE_SYNTHESIS_MODES:
            return True
    return False


def project_rel(path: Path, project_root: Path) -> str:
    try:
        return path.resolve().relative_to(project_root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def default_stage_synthesis_path(task: dict[str, object]) -> str:
    task_id = task.get("id")
    suffix = str(task_id) if isinstance(task_id, str) and task_id else "report"
    return f"work/report/stage-synthesis-{suffix}.md"


def json_text(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)
    except TypeError:
        return str(value)


def contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def project_path_from_token(token: str, project_root: Path) -> Path | None:
    path = Path(token)
    candidate = path if path.is_absolute() else project_root / path
    resolved = candidate.resolve()
    try:
        resolved.relative_to(project_root.resolve())
    except ValueError:
        return None
    return resolved


def read_small_text(path: Path) -> str:
    if path.suffix.lower() not in TEXT_SIDE_EXTENSIONS or not path.is_file():
        return ""
    try:
        if path.stat().st_size > MAX_SIDE_TEXT_BYTES:
            return ""
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def metadata_tokens(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    return []


def figure_sidecar_text(row: dict[str, object], project_root: Path) -> str:
    candidates: list[Path] = []
    base = artifact_path(row, project_root)
    candidates.append(base)
    for suffix in sorted(TEXT_SIDE_EXTENSIONS):
        candidates.append(Path(str(base) + suffix))
        candidates.append(base.with_suffix(suffix))
    for key in FIGURE_METADATA_KEYS:
        for token in metadata_tokens(row.get(key)):
            path = project_path_from_token(token, project_root)
            if path is not None:
                candidates.append(path)

    text_parts: list[str] = []
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        text = read_small_text(resolved)
        if text:
            text_parts.append(text)
    return "\n".join(text_parts)


def artifact_refs(value: Any, known_ids: set[str]) -> set[str]:
    refs: set[str] = set()
    if isinstance(value, str):
        if value in known_ids:
            refs.add(value)
    elif isinstance(value, list):
        for item in value:
            refs.update(artifact_refs(item, known_ids))
    elif isinstance(value, dict):
        for item in value.values():
            refs.update(artifact_refs(item, known_ids))
    return refs


def figure_evidence_text(
    row: dict[str, object],
    artifacts: dict[str, dict[str, object]],
    tasks: dict[str, dict[str, object]],
    project_root: Path,
) -> str:
    parts = [json_text(row), figure_sidecar_text(row, project_root)]

    produced_by = row.get("produced_by")
    if isinstance(produced_by, str) and produced_by in tasks:
        parts.append(json_text(tasks[produced_by]))

    for artifact_id in sorted(artifact_refs(row, set(artifacts))):
        source = artifacts.get(artifact_id)
        if source is None:
            continue
        parts.append(json_text(source))
        parts.append(figure_sidecar_text(source, project_root))
        source_producer = source.get("produced_by")
        if isinstance(source_producer, str) and source_producer in tasks:
            parts.append(json_text(tasks[source_producer]))
    return "\n".join(part for part in parts if part).lower()


def figure_routing_problems(
    task: dict[str, object],
    input_ids: set[str],
    artifacts: dict[str, dict[str, object]],
    tasks: dict[str, dict[str, object]],
    project_root: Path,
) -> list[str]:
    if is_stage_synthesis(task):
        return []

    problems: list[str] = []
    for artifact_id in sorted(input_ids):
        row = artifacts.get(artifact_id)
        if row is None or row.get("type") not in FIGURE_ROUTING_ARTIFACT_TYPES:
            continue

        evidence = figure_evidence_text(row, artifacts, tasks, project_root)
        if not contains_any(evidence, VASP_VOLUMETRIC_TERMS):
            continue

        missing: list[str] = []
        if not contains_any(evidence, VOLUMETRIC_VIS_REF_TERMS):
            missing.append("tools/vasp/references/volumetric-visualization.md")
        if contains_any(evidence, CHARGE_DENSITY_DIFFERENCE_TERMS) and not contains_any(
            evidence,
            VASP_ELECTRONIC_REF_TERMS,
        ):
            missing.append("tools/vasp/references/electronic-analysis.md")

        if missing:
            problems.append(
                f"{artifact_id} uses VASP volumetric data but lacks "
                + ", ".join(missing)
            )
    return problems


def write_stage_synthesis(
    project_root: Path,
    task: dict[str, object],
    consumed_claims: list[dict[str, object]],
    blockers: list[FollowUpBlocker],
    scaffolded: dict[str, list[str]],
    skipped: dict[str, list[str]],
    out_token: str,
) -> Path:
    out_path = Path(out_token)
    if not out_path.is_absolute():
        out_path = project_root / out_path
    out_path = out_path.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lines: list[str] = [
        "# Stage Synthesis: Follow-up Required",
        "",
        f"- report_task: {task.get('id', '')}",
        "- report_mode: stage-synthesis",
        "- final_report_status: blocked",
        "",
        "## Consumed Claims",
        "",
    ]
    if consumed_claims:
        lines.extend(["| claim | status | outcome | path |", "|---|---|---|---|"])
        for claim in consumed_claims:
            lines.append(
                "| "
                + " | ".join(
                    [
                        str(claim.get("artifact_id", "")),
                        str(claim.get("status", "")),
                        str(claim.get("claim_outcome", "")),
                        str(claim.get("path", "")),
                    ]
                )
                + " |"
            )
    else:
        lines.append("- No scientific-claim artifacts were declared by the final report task.")

    lines.extend(["", "## Open Follow-up Proposals", ""])
    lines.extend(["| proposal | status | path | reason | scaffolded_tasks | existing_tasks |", "|---|---|---|---|---|---|"])
    for blocker in blockers:
        proposal_id = blocker.artifact_id
        lines.append(
            "| "
            + " | ".join(
                [
                    proposal_id,
                    blocker.status,
                    blocker.path,
                    blocker.reason.replace("|", "\\|"),
                    ", ".join(scaffolded.get(proposal_id, [])) or "-",
                    ", ".join(skipped.get(proposal_id, [])) or "-",
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## Next Action",
            "",
            "Run or approve the generated follow-up tasks, then re-run result criticism. "
            "The final report remains blocked until every report-blocking follow-up proposal "
            "is resolved by accepted evidence, an explicit waiver, or a visible limitation.",
            "",
        ]
    )
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def scaffold_blocking_followups(
    research_dir: Path,
    project_root: Path,
    blockers: list[FollowUpBlocker],
) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, str]]:
    scaffolded: dict[str, list[str]] = {}
    skipped: dict[str, list[str]] = {}
    errors: dict[str, str] = {}
    for blocker in blockers:
        proposal_id = blocker.artifact_id
        try:
            new_tasks, existing = scaffold_tasks_from_proposal(
                research_dir,
                project_root,
                proposal_id,
                skip_existing=True,
            )
        except SystemExit as exc:
            errors[proposal_id] = str(exc)
            continue
        if new_tasks:
            scaffolded[proposal_id] = [str(task.get("id")) for task in new_tasks]
        if existing:
            skipped[proposal_id] = existing
    return scaffolded, skipped, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to .research directory or project root")
    parser.add_argument("task_id", nargs="?", help="Report task ID. Required when multiple/no obvious report tasks exist.")
    parser.add_argument(
        "--stage-synthesis-out",
        help="Markdown path for the temporary stage-synthesis report when final report is blocked.",
    )
    parser.add_argument(
        "--no-stage-synthesis",
        action="store_true",
        help="Do not write a temporary stage-synthesis report when unresolved follow-ups block final report.",
    )
    parser.add_argument(
        "--no-scaffold-follow-ups",
        action="store_true",
        help="Do not scaffold next-wave follow-up task YAML files from accepted proposal artifacts.",
    )
    parser.add_argument("--now", help="ISO timestamp for deterministic tests and events")
    args = parser.parse_args()

    research_dir, project_root, tasks, artifacts = load_state(Path(args.path))
    try:
        task = selected_report_task(tasks, args.task_id)
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        return 1

    input_ids = task_input_artifact_ids(task)
    if not input_ids:
        print(f"pre_report blocked: task {task.get('id')} declares no artifact inputs", file=sys.stderr)
        return 1

    consumed_claims = [
        artifacts[artifact_id]
        for artifact_id in sorted(input_ids)
        if artifact_id in artifacts and artifacts[artifact_id].get("type") == "scientific-claim"
    ]
    if not consumed_claims:
        print(f"pre_report blocked: task {task.get('id')} consumes no scientific-claim artifacts", file=sys.stderr)
        return 1

    problems: list[str] = []
    for claim in consumed_claims:
        artifact_id = claim.get("artifact_id")
        if claim.get("status") != "accepted":
            problems.append(f"{artifact_id} is {claim.get('status')}, needs accepted")
            continue
        outcome = claim.get("claim_outcome")
        if outcome not in REPORTABLE_OUTCOMES:
            problems.append(f"{artifact_id} outcome is {outcome}, needs one of {sorted(REPORTABLE_OUTCOMES)}")
    if problems:
        print("pre_report blocked: " + "; ".join(problems), file=sys.stderr)
        return 1

    if not is_stage_synthesis(task):
        decisions = load_jsonl(research_dir / "decisions.jsonl", [], research_dir)
        blockers = unresolved_follow_up_proposals(artifacts, decisions, tasks)
        if blockers:
            scaffolded: dict[str, list[str]] = {}
            skipped: dict[str, list[str]] = {}
            scaffold_errors: dict[str, str] = {}
            if not args.no_scaffold_follow_ups:
                scaffolded, skipped, scaffold_errors = scaffold_blocking_followups(
                    research_dir,
                    project_root,
                    blockers,
                )
                if scaffolded:
                    print(
                        "pre_report: scaffolded follow-up task(s): "
                        + "; ".join(
                            f"{proposal}: {', '.join(task_ids)}"
                            for proposal, task_ids in sorted(scaffolded.items())
                        ),
                        file=sys.stderr,
                    )
                if skipped:
                    print(
                        "pre_report: follow-up task(s) already exist: "
                        + "; ".join(
                            f"{proposal}: {', '.join(task_ids)}"
                            for proposal, task_ids in sorted(skipped.items())
                        ),
                        file=sys.stderr,
                    )
                if scaffold_errors:
                    print(
                        "pre_report: could not scaffold some follow-up proposal(s): "
                        + "; ".join(f"{proposal}: {error}" for proposal, error in sorted(scaffold_errors.items())),
                        file=sys.stderr,
                    )
                if scaffolded:
                    fail_if_invalid(research_dir)

            if not args.no_stage_synthesis:
                out_token = args.stage_synthesis_out or default_stage_synthesis_path(task)
                out_path = write_stage_synthesis(
                    project_root,
                    task,
                    consumed_claims,
                    blockers,
                    scaffolded,
                    skipped,
                    out_token,
                )
                now = parse_time(args.now) if args.now else now_local()
                append_event(
                    research_dir,
                    {
                        "event": "stage_synthesis_written",
                        "task_id": task.get("id"),
                        "path": project_rel(out_path, project_root),
                        "blocked_by_follow_up": [blocker.artifact_id for blocker in blockers],
                        "scaffolded_tasks": scaffolded,
                        "existing_follow_up_tasks": skipped,
                        "created_at": iso(now),
                    },
                )
                print(
                    "pre_report: wrote temporary stage-synthesis report: "
                    + project_rel(out_path, project_root),
                    file=sys.stderr,
                )
            print(
                "pre_report blocked: unresolved follow-up proposal(s): "
                + format_follow_up_blockers(blockers),
                file=sys.stderr,
            )
            return 1

    figure_problems = figure_routing_problems(task, input_ids, artifacts, tasks, project_root)
    if figure_problems:
        print("pre_report blocked: figure-routing gate: " + "; ".join(figure_problems), file=sys.stderr)
        return 1

    try:
        row, path, gate = require_passing_gate(
            artifacts,
            project_root,
            research_dir,
            "report_gate",
            candidate_ids=input_ids,
            context="pre_report",
        )
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        return 1

    consumed_claim_ids = {
        str(claim.get("artifact_id"))
        for claim in consumed_claims
        if isinstance(claim.get("artifact_id"), str)
    }
    scoped_claims = gate_scope_claims(gate)
    missing_scope = sorted(consumed_claim_ids - scoped_claims)
    if missing_scope:
        print(
            "pre_report blocked: report_gate scope does not cover consumed claim(s): "
            + ", ".join(missing_scope),
            file=sys.stderr,
        )
        return 1

    print(
        f"pre_report: passed via {row.get('artifact_id')} "
        f"({path.relative_to(project_root).as_posix()}); claims={len(consumed_claims)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
