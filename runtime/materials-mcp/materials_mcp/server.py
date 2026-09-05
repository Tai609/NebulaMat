"""MCP entry point for the unified materials service."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .adapters import MaterialsRegistry, ProviderError
from .capabilities import capability_catalog
from .benchmark import BenchmarkRunner, ReplayEvaluator
from .chemistry_memory import ChemistryMemoryStore
from .design import generate_inverse_design_candidates, select_active_learning_batch
from .design_operators import (
    apply_design_operators,
    operator_catalog,
    validate_design_candidate,
)
from .evidence_graph import compile_evidence_graph
from .models import normalize_record
from .physics_screen import pre_dft_physics_screen
from .schemas import schema_catalog
from .structure_compiler import compile_candidate_structure
from .structure_standardizer import StandardizationError, standardize_adsorption_set, standardize_structure
from .mattersim_adapter import MatterSimError, run_mattersim_stability_screen as run_mattersim_stability_screen_impl
from .uma import DEFAULT_MODEL, DEFAULT_TASK, UMAError, run_uma_adsorption_screen
from .uma_runtime import run_uma_surface_md_runtime
from .validation import validate_payload, validate_structure
from .workflow import EvolutionStore, MaterialsDAGCoordinator
from .runtime_config import probe_runtime_status, write_runtime_status

try:
    from mcp.server.fastmcp import FastMCP  # type: ignore
except ImportError:  # keeps validation/tests usable before provisioning finishes
    FastMCP = None  # type: ignore[assignment,misc]


def _registry() -> MaterialsRegistry:
    workspace = Path.cwd().resolve()
    evolution = EvolutionStore(workspace)
    policies: dict[str, dict[str, Any]] = {}
    for provider in ("materials_project", "oqmd", "aflow", "nomad"):
        approved = evolution.runtime_policy_context(provider)["approved_policies"]
        if approved:
            policies[provider] = dict(approved[-1]["changes"])
    return MaterialsRegistry(
        state_path=workspace / ".openscience" / "materials-provider-execution.sqlite3",
        policies=policies,
    )


mcp = FastMCP("materials-mcp") if FastMCP is not None else None


def _workspace_path(value: str) -> Path:
    candidate = Path(value)
    root = Path.cwd().resolve()
    resolved = (root / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("path must stay inside the active workspace")
    return resolved


def _coordinator() -> MaterialsDAGCoordinator:
    return MaterialsDAGCoordinator(Path.cwd().resolve())


def _evolution() -> EvolutionStore:
    return EvolutionStore(Path.cwd().resolve())


def _chemistry_memory() -> ChemistryMemoryStore:
    return ChemistryMemoryStore(Path.cwd().resolve())


def _write_json_artifact(path: str, payload: dict[str, Any]) -> str:
    target = _workspace_path(path)
    if target.suffix.lower() != ".json":
        raise ValueError("output_path must end in .json")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
    temporary.replace(target)
    return target.relative_to(Path.cwd().resolve()).as_posix()


def _standardize_mattergen_structure(
    source_path: str,
    output_dir: str,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run the governed primitive-cell/surface standardizer inside the workspace."""
    root = Path.cwd().resolve()
    try:
        target = _workspace_path(output_dir)
        result = standardize_structure(
            _workspace_path(source_path),
            target,
            policy,
        )
    except (StandardizationError, ValueError) as exc:
        return {
            "schema_version": 1,
            "status": "hold",
            "error": str(exc),
            "definition": (
                "MatterGen standardization requires a controlled bulk supercell and, when requested, "
                "a fixed-layer slab with an in-plane atom-count window. Sorting sites, reducing a formula, "
                "changing symmetry notation, or rewriting the same CIF is not standardization."
            ),
            "next_step": "provide a workspace-local MatterGen CIF and an explicit atom-count/layer policy",
        }

    for field in ("source", "manifest"):
        record = result.get(field)
        if isinstance(record, dict) and isinstance(record.get("path"), str):
            record["path"] = Path(record["path"]).resolve().relative_to(root).as_posix()

    workspace_artifacts: list[dict[str, Any]] = []
    for kind in ("bulk", "surface"):
        record = result.get(kind)
        if not isinstance(record, dict):
            continue
        for artifact in record.get("files", []):
            if not isinstance(artifact, dict) or not isinstance(artifact.get("path"), str):
                continue
            workspace_artifacts.append({
                **artifact,
                "path": (target / artifact["path"]).resolve().relative_to(root).as_posix(),
            })
    result["workspace_artifacts"] = workspace_artifacts
    result["definition"] = (
        "Controlled expansion to a comparable atom-count window; surface outputs additionally preserve "
        "the requested Miller index and layer count while expanding only in plane."
    )
    return result


if mcp is not None:

    @mcp.tool()
    def get_material_agent_schemas() -> dict[str, Any]:
        """Return the shared task, result, and review-vote contracts."""
        return schema_catalog()

    @mcp.tool()
    def get_materials_runtime_status(write_status: bool = False) -> dict[str, Any]:
        """Report configured/discovered/ready materials runtimes without loading models.

        Set ``write_status`` to persist the machine-specific report under
        ``.openscience/materials-runtime.status.json``. This preflight is
        intentionally cheap; it does not download gated Hugging Face weights or
        start MatterSim/UMA inference.
        """
        return write_runtime_status(Path.cwd()) if write_status else probe_runtime_status(Path.cwd())

    @mcp.tool()
    def get_material_capabilities() -> dict[str, Any]:
        """Return the modular material capability registry and planning contract."""
        return capability_catalog(Path.cwd())

    @mcp.tool()
    def get_material_design_operators() -> dict[str, Any]:
        """Return the typed, executable material-design operator registry."""
        return operator_catalog()

    @mcp.tool()
    def compile_material_evidence_graph(
        graph: dict[str, Any],
        output_path: str | None = None,
    ) -> dict[str, Any]:
        """Validate and score a mechanism/failure evidence graph, optionally writing JSON."""
        compiled = compile_evidence_graph(graph)
        if output_path:
            compiled["artifact"] = _write_json_artifact(output_path, compiled)
        return compiled

    @mcp.tool()
    def apply_material_design_operators(
        base_state: dict[str, Any],
        operators: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Apply validated design operators to an explicit material-state descriptor."""
        return apply_design_operators(base_state, operators)

    @mcp.tool()
    def validate_material_design_candidate(
        candidate: dict[str, Any],
        evidence_graph: dict[str, Any],
    ) -> dict[str, Any]:
        """Validate operator lineage and graph-linked, falsifiable candidate effects."""
        compiled = compile_evidence_graph(evidence_graph)
        return validate_design_candidate(candidate, compiled)

    @mcp.tool()
    def pre_dft_physics_screen_candidate(
        candidate: dict[str, Any],
        conditions: dict[str, Any] | None = None,
        output_path: str | None = None,
        candidate_sha256: str = "",
        evidence_graph_hash: str = "",
    ) -> dict[str, Any]:
        """Run deterministic hard-constraint and physics/chemistry proxy screening before DFT."""
        safe_output = _workspace_path(output_path) if output_path else None
        result = pre_dft_physics_screen(
            candidate,
            conditions,
            str(safe_output) if safe_output else None,
            candidate_sha256,
            evidence_graph_hash,
        )
        if safe_output:
            result["artifact"] = safe_output.relative_to(Path.cwd().resolve()).as_posix()
        return result

    @mcp.tool()
    def standardize_mattergen_structure(
        source_path: str,
        output_dir: str,
        policy: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Expand one raw MatterGen CIF into comparable, manifest-backed structures.

        Bulk output is a near-isotropic supercell in the requested atom-count
        window. If the policy includes a Miller index and layer count, surface
        output preserves that layer count and expands only in plane. Merely
        sorting atoms, reducing the formula, changing symmetry notation, or
        rewriting CIF/POSCAR is explicitly not accepted as standardization.
        """
        return _standardize_mattergen_structure(source_path, output_dir, policy)

    @mcp.tool()
    def standardize_uma_adsorption_structure_set(
        slab_path: str,
        adsorbate_path: str,
        adsorbed_path: str,
        output_dir: str,
    ) -> dict[str, Any]:
        """Validate and normalize an explicit slab/adsorbate/adsorbed cohort.

        This tool does not generate or place an adsorbate.  The slab must
        already come from MatterGen standardization; the supplied adsorbed
        structure must preserve that slab cell and exact combined composition.
        """
        root = Path.cwd().resolve()
        try:
            result = standardize_adsorption_set(
                _workspace_path(slab_path),
                _workspace_path(adsorbate_path),
                _workspace_path(adsorbed_path),
                _workspace_path(output_dir),
            )
        except StandardizationError as exc:
            return {
                "schema_version": 1,
                "status": "hold",
                "error": str(exc),
                "next_step": "provide an explicit adsorption structure set with one standardized slab cell and conserved atom count/composition",
            }
        for record in result.get("source", {}).values():
            if isinstance(record, dict) and isinstance(record.get("path"), str):
                record["path"] = Path(record["path"]).resolve().relative_to(root).as_posix()
        for field in ("source_slab_manifest",):
            if isinstance(result.get(field), str):
                result[field] = Path(result[field]).resolve().relative_to(root).as_posix()
        if isinstance(result.get("manifest"), dict) and isinstance(result["manifest"].get("path"), str):
            result["manifest"]["path"] = Path(result["manifest"]["path"]).resolve().relative_to(root).as_posix()
        return result

    @mcp.tool()
    def run_uma_adsorption_energy_screen(
        slab_path: str,
        adsorbate_path: str,
        adsorbed_path: str,
        model_name: str = DEFAULT_MODEL,
        task_name: str = DEFAULT_TASK,
        device: str = "cuda",
        relax: bool = True,
        fmax_ev_per_angstrom: float = 0.05,
        max_steps: int = 200,
        freeze_indices: list[int] | None = None,
        fixed_bottom_layers: int = 3,
        layer_tolerance_angstrom: float = 0.25,
        output_dir: str | None = None,
        output_path: str | None = None,
    ) -> dict[str, Any]:
        """Run a same-model fairchem/UMA adsorption-energy screen.

        ``oc25`` is the default task for electrocatalysis. All three structures
        must relax to the requested force threshold before any energy is
        evaluated. The tool returns ``status=hold`` without energy fields when
        relaxation does not converge.
        """
        safe_inputs = {
            "slab": _workspace_path(slab_path),
            "adsorbate": _workspace_path(adsorbate_path),
            "adsorbed": _workspace_path(adsorbed_path),
        }
        safe_output_dir = _workspace_path(output_dir) if output_dir else None
        try:
            result = run_uma_adsorption_screen(
                safe_inputs["slab"],
                safe_inputs["adsorbate"],
                safe_inputs["adsorbed"],
                model_name=model_name,
                task_name=task_name,
                device=device,
                relax=relax,
                fmax_ev_per_angstrom=fmax_ev_per_angstrom,
                max_steps=max_steps,
                freeze_indices=freeze_indices,
                fixed_bottom_layers=fixed_bottom_layers,
                layer_tolerance_angstrom=layer_tolerance_angstrom,
                output_dir=safe_output_dir,
            )
        except UMAError as exc:
            return {
                "schema_version": 1,
                "screen_type": "uma_adsorption_energy",
                "status": "error",
                "error": str(exc),
                "next_step": "install the optional UMA environment, verify Hugging Face access to facebook/UMA, and rerun after checking the structure protocol",
            }

        root = Path.cwd().resolve()
        for record in result.get("inputs", {}).values():
            if isinstance(record, dict):
                for field in ("path", "standardization_manifest"):
                    if isinstance(record.get(field), str):
                        record[field] = Path(record[field]).resolve().relative_to(root).as_posix()
        for label, path in list((result.get("relaxed_structure_artifacts") or {}).items()):
            result["relaxed_structure_artifacts"][label] = Path(path).resolve().relative_to(root).as_posix()
        if output_path:
            result["artifact"] = _write_json_artifact(output_path, result)
        return result

    @mcp.tool()
    def run_uma_surface_md(
        adsorbed_path: str,
        output_dir: str,
        model_name: str = DEFAULT_MODEL,
        task_name: str = DEFAULT_TASK,
        device: str = "cuda",
        supercell: list[int] | None = None,
        ensemble: str = "nvt",
        temperature_k: float = 300.0,
        timestep_fs: float = 0.5,
        equilibration_ps: float = 5.0,
        production_ps: float = 20.0,
        friction_per_fs: float = 0.01,
        seeds: list[int] | None = None,
        fixed_bottom_layers: int = 2,
        freeze_indices: list[int] | None = None,
        layer_tolerance_angstrom: float = 0.25,
        pre_relax: bool = True,
        fmax_ev_per_angstrom: float = 0.05,
        max_relax_steps: int = 200,
        thermo_interval_steps: int = 10,
        trajectory_interval_steps: int = 10,
        collision_distance_angstrom: float = 0.6,
    ) -> dict[str, Any]:
        """Run ASE molecular dynamics with UMA on a standardized adsorbed slab.

        The complete adsorption system is expanded ``2 x 2 x 1`` by default,
        preserving coverage.  The bottom two atomic planes are fixed unless
        explicit input-cell indices are supplied.  Surface NPT is deliberately
        unsupported; use NVT for the operating-temperature screen or NVE for
        an integration check.
        """
        root = Path.cwd().resolve()
        try:
            result = run_uma_surface_md_runtime(
                _workspace_path(adsorbed_path),
                _workspace_path(output_dir),
                workspace_root=root,
                model_name=model_name,
                task_name=task_name,
                device=device,
                supercell=supercell,
                ensemble=ensemble,
                temperature_k=temperature_k,
                timestep_fs=timestep_fs,
                equilibration_ps=equilibration_ps,
                production_ps=production_ps,
                friction_per_fs=friction_per_fs,
                seeds=seeds,
                fixed_bottom_layers=fixed_bottom_layers,
                freeze_indices=freeze_indices,
                layer_tolerance_angstrom=layer_tolerance_angstrom,
                pre_relax=pre_relax,
                fmax_ev_per_angstrom=fmax_ev_per_angstrom,
                max_relax_steps=max_relax_steps,
                thermo_interval_steps=thermo_interval_steps,
                trajectory_interval_steps=trajectory_interval_steps,
                collision_distance_angstrom=collision_distance_angstrom,
            )
        except UMAError as exc:
            return {
                "schema_version": 1,
                "simulation_type": "uma_surface_md",
                "status": "error",
                "error": str(exc),
                "next_step": "provide a standardized adsorbed surface and an empty output directory, then verify the UMA runtime and MD protocol",
            }

        absolute_output_dir = Path(result["output_dir"]).resolve()
        for artifact in result.get("artifacts", []):
            if isinstance(artifact, dict) and isinstance(artifact.get("path"), str):
                artifact["path"] = (absolute_output_dir / artifact["path"]).resolve().relative_to(root).as_posix()
        for field in ("manifest", "output_dir"):
            if isinstance(result.get(field), str):
                result[field] = Path(result[field]).resolve().relative_to(root).as_posix()
        input_record = result.get("input")
        if isinstance(input_record, dict):
            for field in ("path", "standardization_manifest"):
                if isinstance(input_record.get(field), str):
                    input_record[field] = Path(input_record[field]).resolve().relative_to(root).as_posix()
        return result

    @mcp.tool()
    def run_mattersim_stability_screen(
        structure_path: str,
        model_path: str | None = None,
        device: str = "cuda",
        structure_kind: str = "bulk",
        relax: bool = True,
        relax_cell: bool = False,
        fmax_ev_per_angstrom: float = 0.05,
        max_steps: int = 200,
        max_displacement_angstrom: float = 0.75,
        output_dir: str | None = None,
        output_path: str | None = None,
    ) -> dict[str, Any]:
        """Run MatterSim-v1.0.0-5M as a first-stage stability/relaxation proxy."""
        safe_structure = _workspace_path(structure_path)
        model_aliases = {"5m", "mattersim-v1.0.0-5m", "mattersim-v1.0.0-5m.pth"}
        safe_model = (
            model_path
            if str(model_path or "").strip().lower() in model_aliases
            else (_workspace_path(model_path) if model_path else None)
        )
        safe_output_dir = _workspace_path(output_dir) if output_dir else None
        try:
            result = run_mattersim_stability_screen_impl(
                safe_structure,
                model_path=safe_model,
                workspace_root=Path.cwd().resolve(),
                device=device,
                structure_kind=structure_kind,
                relax=relax,
                relax_cell=relax_cell,
                fmax_ev_per_angstrom=fmax_ev_per_angstrom,
                max_steps=max_steps,
                max_displacement_angstrom=max_displacement_angstrom,
                output_dir=safe_output_dir,
            )
        except MatterSimError as exc:
            return {
                "schema_version": 1,
                "screen_type": "mattersim_stability_proxy",
                "status": "error",
                "error": str(exc),
                "next_step": "install MatterSim v1.0.0, place the 5M checkpoint under runtime/mattersim/models, and rerun after checking the device",
            }
        root = Path.cwd().resolve()
        if isinstance(result.get("input"), dict):
            for field in ("path", "standardization_manifest"):
                if isinstance(result["input"].get(field), str):
                    result["input"][field] = Path(result["input"][field]).resolve().relative_to(root).as_posix()
        if isinstance(result.get("relaxed_structure_artifact"), str):
            result["relaxed_structure_artifact"] = Path(result["relaxed_structure_artifact"]).resolve().relative_to(root).as_posix()
        if output_path:
            result["artifact"] = _write_json_artifact(output_path, result)
        return result

    @mcp.tool()
    def search_materials(query: str, providers: list[str] | None = None, limit: int = 20) -> dict[str, Any]:
        """Search MP, OQMD, AFLOW, and NOMAD with one normalized contract."""
        return _registry().search(query, providers, limit)

    @mcp.tool()
    def discover_materials(
        elements: list[str],
        formulas: list[str] | None = None,
        providers: list[str] | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        """Prefer provider element queries and use concurrent formula fallbacks."""
        return _registry().discover(elements, formulas, providers, limit)

    @mcp.tool()
    def search_material_formulas(
        formulas: list[str],
        providers: list[str] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Run resumable formula queries under bounded provider concurrency."""
        return _registry().search_many(formulas, providers, limit)

    @mcp.tool()
    def get_material_provider_status(providers: list[str] | None = None) -> dict[str, Any]:
        """Return provider capabilities, active policy, health, and query counts."""
        registry = _registry()
        result = registry.capabilities()
        if providers:
            result["providers"] = {name: value for name, value in result["providers"].items() if name in providers}
            result["policies"] = {name: value for name, value in result["policies"].items() if name in providers}
            result["health"] = registry.store.status(providers)
        return result

    @mcp.tool()
    def resume_material_queries(providers: list[str] | None = None, limit: int = 100) -> dict[str, Any]:
        """Resume only retryable provider queries from durable checkpoints."""
        return _registry().resume(providers, limit)

    @mcp.tool()
    def get_material(provider: str, material_id: str) -> dict[str, Any]:
        """Fetch one material record from a named provider."""
        try:
            return _registry().get(provider, material_id)
        except ProviderError as exc:
            return {"error": str(exc), "provider": provider, "material_id": material_id}

    @mcp.tool()
    def normalize_material(provider: str, record: dict[str, Any]) -> dict[str, Any]:
        """Normalize an already fetched provider payload without network access."""
        return normalize_record(provider, record).to_dict()

    @mcp.tool()
    def validate_material(payload: dict[str, Any]) -> dict[str, Any]:
        """Run formula, oxidation, ratio, unit, structure, and DFT gates."""
        safe_payload = dict(payload)
        if isinstance(safe_payload.get("structure_path"), str):
            safe_payload["structure_path"] = str(_workspace_path(safe_payload["structure_path"]))
        return validate_payload(safe_payload).to_dict()

    @mcp.tool()
    def validate_structure_file(path: str, min_distance: float = 0.8) -> dict[str, Any]:
        """Validate a CIF/POSCAR/XYZ/SMILES file inside the active workspace."""
        return validate_structure(_workspace_path(path), min_distance).to_dict()

    @mcp.tool()
    def compile_material_candidate_structure(
        candidate: dict[str, Any],
        structure_spec: dict[str, Any] | None,
        output_dir: str,
        surface_specs: list[dict[str, Any]] | None = None,
        interface_specs: list[dict[str, Any]] | None = None,
        min_distance_angstrom: float = 0.8,
    ) -> dict[str, Any]:
        """Compile a frozen candidate into validated CIF, POSCAR, slabs, interfaces, and render JSON."""
        safe_output = _workspace_path(output_dir)
        result = compile_candidate_structure(
            candidate,
            structure_spec,
            safe_output,
            surface_specs,
            interface_specs,
            min_distance_angstrom,
        )
        root = Path.cwd().resolve()
        result["output_dir"] = safe_output.relative_to(root).as_posix()
        if result.get("manifest"):
            result["manifest"] = (safe_output / str(result["manifest"])).relative_to(root).as_posix()
        for item in result.get("files", []):
            if isinstance(item, dict) and isinstance(item.get("path"), str):
                item["path"] = (safe_output / item["path"]).relative_to(root).as_posix()
        return result

    @mcp.tool()
    def create_materials_workflow(
        goal: str,
        constraints: dict[str, Any] | None = None,
        include_dft: bool = False,
        design_mode: bool = False,
        domain_profile: str = "general",
        response_language: str | None = None,
        route: str = "standard",
        capability_plan: list[dict[str, Any] | str] | None = None,
    ) -> dict[str, Any]:
        """Create a bounded workflow or execute an explicit agent capability plan.

        ``fast`` creates a two-step decision record, ``standard`` is the
        default five-step materials path, and ``high-risk`` enables the full
        provider quorum/review DAG. DFT and design mode automatically promote
        to high-risk so they cannot bypass their gates. Supplying
        ``capability_plan`` executes only the submitted nodes and dependencies.
        No hidden completion or review tasks are appended.
        """
        return _coordinator().create_dag(
            goal,
            constraints,
            include_dft,
            design_mode,
            domain_profile,
            response_language,
            route,
            capability_plan,
        )

    @mcp.tool()
    def create_material_discovery_workflow(
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
        """Create the staged MatterGen-to-microkinetics discovery workflow.

        The template records explicit skips for smol, Cantera/OpenMKM, and
        kmos when their prerequisites are absent. It creates a plan only; the
        registered task executors still own actual generation, retrieval, and
        model runs.
        """
        cluster_expansion = str(existing_cluster_expansion or "").strip() or None
        return _coordinator().create_discovery_dag(
            goal=goal,
            chemical_system=chemical_system,
            reaction=reaction,
            constraints=constraints,
            existing_cluster_expansion=cluster_expansion,
            include_reactor=include_reactor,
            include_spatial=include_spatial,
            shortlisted_candidate_count=shortlisted_candidate_count,
            spatial_candidate_limit=spatial_candidate_limit,
            providers=providers,
            response_language=response_language,
        )

    @mcp.tool()
    def get_materials_workflow(workflow_id: str) -> dict[str, Any]:
        """Read the current state and history of a materials workflow."""
        return _coordinator().get(workflow_id)

    @mcp.tool()
    def advance_materials_workflow(
        workflow_id: str,
        actor: str,
        to_stage: str,
        artifacts: list[str] | None = None,
        evidence: list[str] | None = None,
        outcome: str | None = None,
        note: str = "",
    ) -> dict[str, Any]:
        """Advance a workflow only when the named role owns the next stage."""
        return _coordinator().advance(workflow_id, actor, to_stage, artifacts, evidence, outcome, note)

    @mcp.tool()
    def record_material_experience(
        workflow_id: str,
        agent: str,
        stage: str,
        lesson: str,
        evidence: list[str],
        outcome: str,
        confidence: float,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """Record an evidence-backed lesson without changing agent instructions."""
        return _evolution().record_experience(workflow_id, agent, stage, lesson, evidence, outcome, confidence, tags)

    @mcp.tool()
    def propose_material_rule(agent: str, scope: str, rule: str, evidence: list[str]) -> dict[str, Any]:
        """Propose a reusable rule; proposals remain pending until reviewed."""
        return _evolution().propose_rule(agent, scope, rule, evidence)

    @mcp.tool()
    def get_material_agent_context(agent: str, limit: int = 12) -> dict[str, Any]:
        """Load approved rules and recent evidence-backed lessons for one role."""
        return _evolution().context(agent, limit)

    @mcp.tool()
    def record_chemistry_memory(
        memory_type: str,
        workflow_id: str,
        agent: str,
        query: str,
        payload: dict[str, Any],
        evidence: list[str],
        confidence: float,
        domain: str = "chemistry",
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """Record a pending plan, execution, or knowledge memory with evidence."""
        return _chemistry_memory().record(
            memory_type,
            workflow_id,
            agent,
            query,
            payload,
            evidence,
            confidence,
            domain,
            tags,
        )

    @mcp.tool()
    def search_chemistry_memories(
        query: str,
        memory_types: list[str] | None = None,
        domain: str | None = None,
        tags: list[str] | None = None,
        limit: int = 8,
        canary_cohort: str | None = None,
        association_threshold: float = 0.15,
    ) -> dict[str, Any]:
        """Retrieve approved memories, with governed knowledge-association fallback."""
        return _chemistry_memory().search(
            query,
            memory_types,
            domain,
            tags,
            limit,
            canary_cohort,
            association_threshold,
        )

    @mcp.tool()
    def evaluate_chemistry_memory(
        memory_id: str, benchmark_report: dict[str, Any]
    ) -> dict[str, Any]:
        """Evaluate a candidate memory against offline benchmark and workflow replay."""
        return _chemistry_memory().evaluate(memory_id, benchmark_report)

    @mcp.tool()
    def start_chemistry_memory_canary(
        memory_id: str, cohort: list[str]
    ) -> dict[str, Any]:
        """Expose an evaluated memory only to an explicit canary cohort."""
        return _chemistry_memory().start_canary(memory_id, cohort)

    @mcp.tool()
    def finish_chemistry_memory_canary(
        memory_id: str, metrics: dict[str, Any]
    ) -> dict[str, Any]:
        """Finish a memory canary and reject any observed regression."""
        return _chemistry_memory().finish_canary(memory_id, metrics)

    @mcp.tool()
    def promote_chemistry_memory(memory_id: str, approved_by: str) -> dict[str, Any]:
        """Promote a passing memory with materials-reviewer or human approval."""
        return _chemistry_memory().promote(memory_id, approved_by)

    @mcp.tool()
    def rollback_chemistry_memory(
        memory_id: str, reason: str, approved_by: str
    ) -> dict[str, Any]:
        """Rollback a memory without deleting its append-only audit history."""
        return _chemistry_memory().rollback(memory_id, reason, approved_by)

    @mcp.tool()
    def list_chemistry_memories(
        memory_type: str | None = None,
        status: str | None = None,
        domain: str | None = None,
        tags: list[str] | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        """List latest memory states for review and lifecycle administration."""
        return _chemistry_memory().list(memory_type, status, domain, tags, limit)

    @mcp.tool()
    def promote_material_rule(proposal_id: str, approved_by: str) -> dict[str, Any]:
        """Promote a pending rule only with reviewer or explicit human approval."""
        return _evolution().promote_rule(proposal_id, approved_by)

    @mcp.tool()
    def list_material_tasks(workflow_id: str) -> dict[str, Any]:
        """List ready tasks for parallel dispatch and their typed inputs."""
        coordinator = _coordinator()
        return {
            "workflow_id": workflow_id,
            "ready": coordinator.ready_tasks(workflow_id),
            "background_ready": coordinator.background_ready_tasks(workflow_id),
        }

    @mcp.tool()
    def claim_material_task(workflow_id: str, task_id: str, actor: str) -> dict[str, Any]:
        """Claim one ready DAG task for a role-specific agent session."""
        return _coordinator().claim_task(workflow_id, task_id, actor)

    @mcp.tool()
    def heartbeat_material_task(workflow_id: str, task_id: str, actor: str) -> dict[str, Any]:
        """Extend a claimed task lease while a worker is making progress."""
        return _coordinator().heartbeat_task(workflow_id, task_id, actor)

    @mcp.tool()
    def recover_material_tasks(workflow_id: str | None = None) -> dict[str, Any]:
        """Recover expired leases or move exhausted tasks to dead-letter."""
        return _coordinator().recover_expired_tasks(workflow_id)

    @mcp.tool()
    def retry_material_task(workflow_id: str, task_id: str, actor: str, note: str = "") -> dict[str, Any]:
        """Retry a failed task within its bounded attempt budget."""
        return _coordinator().retry_task(workflow_id, task_id, actor, note)

    @mcp.tool()
    def complete_material_task(workflow_id: str, task_id: str, actor: str, output: dict[str, Any]) -> dict[str, Any]:
        """Commit a typed agent output and release dependent DAG tasks."""
        return _coordinator().complete_task(workflow_id, task_id, actor, output)

    @mcp.tool()
    def record_dft_human_review(
        workflow_id: str,
        task_id: str,
        actor: str,
        decision: str,
        note: str = "",
        requested_changes: list[str] | None = None,
    ) -> dict[str, Any]:
        """Record the named human's approval, revision request, or rejection of a DFT submission."""
        return _coordinator().record_dft_human_review(
            workflow_id, task_id, actor, decision, note, requested_changes
        )

    @mcp.tool()
    def start_material_design_iteration(workflow_id: str, actor: str, note: str = "") -> dict[str, Any]:
        """Append another evidence-linked design and experiment round after human results."""
        return _coordinator().add_design_iteration(workflow_id, actor, note)

    @mcp.tool()
    def record_material_novelty_audit(
        workflow_id: str,
        iteration: int,
        auditor: str,
        search_scope: dict[str, Any],
        candidate_results: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Record a hash-bound novelty audit from the isolated novelty role."""
        return _coordinator().record_novelty_audit(
            workflow_id,
            iteration,
            auditor,
            search_scope,
            candidate_results,
        )

    @mcp.tool()
    def record_material_review_vote(
        workflow_id: str,
        task_id: str,
        reviewer_id: str,
        scope: str,
        verdict: str,
        findings: list[dict[str, Any]] | None = None,
        evidence: list[str] | None = None,
        confidence: float = 0.0,
    ) -> dict[str, Any]:
        """Record an independent review vote and return the quorum summary."""
        return _coordinator().record_review_vote(workflow_id, task_id, reviewer_id, scope, verdict, findings, evidence, confidence)

    @mcp.tool()
    def get_material_review_summary(workflow_id: str) -> dict[str, Any]:
        """Return independent reviewer counts and the current vote decision."""
        return _coordinator().review_summary(workflow_id)

    @mcp.tool()
    def finalize_material_review(workflow_id: str, actor: str, decision: str, note: str = "") -> dict[str, Any]:
        """Finalize a multi-reviewer vote through the dedicated judge role."""
        return _coordinator().finalize_review(workflow_id, actor, decision, note)

    @mcp.tool()
    def run_materials_benchmark(case_ids: list[str] | None = None) -> dict[str, Any]:
        """Run deterministic materials validation benchmark cases."""
        return BenchmarkRunner().run(case_ids)

    @mcp.tool()
    def replay_material_workflow(workflow_id: str | None = None) -> dict[str, Any]:
        """Replay the append-only workflow event stream and report anomalies."""
        return ReplayEvaluator(Path.cwd().resolve()).run(workflow_id)

    @mcp.tool()
    def evaluate_material_rule(proposal_id: str, benchmark_report: dict[str, Any]) -> dict[str, Any]:
        """Attach an offline benchmark result to a proposed evolution rule."""
        return _evolution().evaluate_rule(proposal_id, benchmark_report)

    @mcp.tool()
    def start_material_rule_canary(proposal_id: str, cohort: list[str]) -> dict[str, Any]:
        """Expose an evaluated rule to an explicit canary cohort."""
        return _evolution().start_canary(proposal_id, cohort)

    @mcp.tool()
    def finish_material_rule_canary(proposal_id: str, metrics: dict[str, Any]) -> dict[str, Any]:
        """Close a canary and mark it passed or failed based on regressions."""
        return _evolution().finish_canary(proposal_id, metrics)

    @mcp.tool()
    def rollback_material_rule(proposal_id: str, reason: str, approved_by: str) -> dict[str, Any]:
        """Rollback a promoted rule without deleting its audit history."""
        return _evolution().rollback_rule(proposal_id, reason, approved_by)

    @mcp.tool()
    def propose_material_runtime_policy(provider: str, changes: dict[str, Any], evidence: list[str], proposed_by: str = "materials-supervisor") -> dict[str, Any]:
        """Propose bounded timeout, concurrency, retry, cache, or circuit changes."""
        return _evolution().propose_runtime_policy(provider, changes, evidence, proposed_by)

    @mcp.tool()
    def evaluate_material_runtime_policy(proposal_id: str, benchmark_report: dict[str, Any]) -> dict[str, Any]:
        """Evaluate a runtime policy against offline failures and workflow replay."""
        return _evolution().evaluate_runtime_policy(proposal_id, benchmark_report)

    @mcp.tool()
    def start_material_runtime_canary(proposal_id: str, cohort: list[str]) -> dict[str, Any]:
        """Start a provider-policy canary for an explicit workflow cohort."""
        return _evolution().start_runtime_canary(proposal_id, cohort)

    @mcp.tool()
    def finish_material_runtime_canary(proposal_id: str, metrics: dict[str, Any]) -> dict[str, Any]:
        """Finish runtime canary and reject any observed regression."""
        return _evolution().finish_runtime_canary(proposal_id, metrics)

    @mcp.tool()
    def promote_material_runtime_policy(proposal_id: str, approved_by: str) -> dict[str, Any]:
        """Promote a passing runtime policy with reviewer or human approval."""
        return _evolution().promote_runtime_policy(proposal_id, approved_by)

    @mcp.tool()
    def rollback_material_runtime_policy(proposal_id: str, reason: str, approved_by: str) -> dict[str, Any]:
        """Rollback a runtime policy while preserving its audit trail."""
        return _evolution().rollback_runtime_policy(proposal_id, reason, approved_by)

    @mcp.tool()
    def select_material_active_learning_batch(
        records: list[dict[str, Any]],
        target_property: str,
        batch_size: int = 5,
        exploration_weight: float = 0.25,
        maximize: bool = True,
    ) -> dict[str, Any]:
        """Select an uncertainty-aware batch without making a model claim."""
        return select_active_learning_batch(records, target_property, batch_size, exploration_weight, maximize)

    @mcp.tool()
    def generate_material_inverse_design_candidates(
        element_groups: list[list[str]],
        stoichiometries: list[list[int]],
        batch_size: int = 20,
    ) -> dict[str, Any]:
        """Generate explicit composition proposals that still require validation."""
        return generate_inverse_design_candidates(element_groups, stoichiometries, batch_size)


def main() -> None:
    if mcp is None:
        raise SystemExit("materials-mcp is not provisioned; install the materials environment first")
    mcp.run()


if __name__ == "__main__":
    main()
