"""Best-effort adapters for public materials repositories.

The public APIs evolve independently. Each adapter owns its endpoint and
payload parsing, while callers only see MaterialRecord objects. A failed
provider is reported separately so one unavailable database does not discard
results from the others.
"""
from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Semaphore
from typing import Any, Callable

import httpx

from .execution import (
    QUERY_RETRYABLE,
    ProviderCapability,
    ProviderExecutionStore,
    ProviderPolicy,
    QuerySpec,
    SourceObservation,
    query_idempotency_key,
)
from .models import MaterialRecord, normalize_payload, normalize_record


class ProviderError(RuntimeError):
    def __init__(self, message: str, kind: str = "unavailable", retryable: bool = True) -> None:
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable


@dataclass
class Adapter:
    provider: str
    base_url: str
    api_key_env: str | None = None
    request: Callable[..., Any] | None = None
    request_timeout_seconds: float = 10.0

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=self.request_timeout_seconds, follow_redirects=True)

    def capabilities(self) -> ProviderCapability:
        return ProviderCapability(self.provider, ("formula",))

    def _get(self, path: str, params: dict[str, Any]) -> Any:
        url = self.base_url.rstrip("/") + "/" + path.lstrip("/")
        headers: dict[str, str] = {"User-Agent": "open-science-materials-mcp/0.1"}
        key = os.getenv(self.api_key_env) if self.api_key_env else None
        if key:
            headers["X-API-KEY"] = key
            headers["Authorization"] = f"Bearer {key}"
        try:
            if self.request is not None:
                response = self.request(
                    "GET",
                    url,
                    params=params,
                    headers=headers,
                    timeout=self.request_timeout_seconds,
                )
            else:
                with self._client() as client:
                    response = client.get(url, params=params, headers=headers)
            response.raise_for_status()
            return response.json()
        except (httpx.TimeoutException, TimeoutError) as exc:
            raise ProviderError(f"{self.provider} request timed out: {exc}", "timeout", True) from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 429:
                kind, retryable = "rate_limited", True
            elif status in {401, 403}:
                kind, retryable = "authentication_error", False
            elif 400 <= status < 500:
                kind, retryable = "invalid_query", False
            else:
                kind, retryable = "unavailable", True
            raise ProviderError(f"{self.provider} HTTP {status}: {exc}", kind, retryable) from exc
        except (json.JSONDecodeError, ValueError) as exc:
            raise ProviderError(f"{self.provider} response schema failed: {exc}", "schema_error", True) from exc
        except Exception as exc:  # httpx and provider JSON errors are user-facing
            raise ProviderError(f"{self.provider} request failed: {exc}", "unavailable", True) from exc

    def search(self, query: str, limit: int) -> list[MaterialRecord]:
        payload = self._get("", {"query": query, "limit": limit, "page_size": limit})
        return normalize_payload(self.provider, payload)[:limit]

    def search_elements(self, elements: list[str], limit: int) -> list[MaterialRecord]:
        raise ProviderError(
            f"{self.provider} does not support element-set search",
            "invalid_query",
            False,
        )

    def get(self, material_id: str) -> MaterialRecord:
        payload = self._get(material_id, {})
        records = normalize_payload(self.provider, payload)
        if not records:
            raise ProviderError(f"{self.provider} returned no record for {material_id}")
        return records[0]


class MaterialsProjectAdapter(Adapter):
    def __init__(self, request: Callable[..., Any] | None = None) -> None:
        super().__init__("materials_project", "https://api.materialsproject.org", "MP_API_KEY", request)

    def capabilities(self) -> ProviderCapability:
        return ProviderCapability(
            self.provider,
            ("formula", "elements"),
            bulk_formula_size=1,
            pagination=True,
            api_version="v2-summary",
            fallback_routes=("mp-api", "materials/summary"),
        )

    def search(self, query: str, limit: int) -> list[MaterialRecord]:
        # mp-api is preferred because it tracks the MP summary schema. The
        # HTTP fallback keeps the MCP useful when only the base dependencies are
        # installed or when the client package changes its import path.
        key = os.getenv("MP_API_KEY")
        if not key:
            raise ProviderError("Materials Project requires MP_API_KEY")
        try:
            from mp_api.client import MPRester  # type: ignore

            with MPRester(key) as mpr:
                docs = mpr.materials.summary.search(
                    formula=query or None,
                    fields=[
                        "material_id",
                        "formula_pretty",
                        "elements",
                        "band_gap",
                        "formation_energy_per_atom",
                        "energy_above_hull",
                        "density",
                        "volume",
                        "structure",
                    ],
                    num_chunks=1,
                )[:limit]
            return [normalize_record(self.provider, _model_dump(doc)) for doc in docs]
        except ImportError:
            payload = self._get("materials/summary", {"formula": query, "_limit": limit})
            return normalize_payload(self.provider, payload)[:limit]
        except Exception as exc:
            raise ProviderError(f"Materials Project request failed: {exc}") from exc

    def search_elements(self, elements: list[str], limit: int) -> list[MaterialRecord]:
        key = os.getenv("MP_API_KEY")
        if not key:
            raise ProviderError("Materials Project requires MP_API_KEY", "authentication_error", False)
        try:
            from mp_api.client import MPRester  # type: ignore

            with MPRester(key) as mpr:
                docs = mpr.materials.summary.search(
                    elements=elements,
                    fields=[
                        "material_id",
                        "formula_pretty",
                        "elements",
                        "band_gap",
                        "formation_energy_per_atom",
                        "energy_above_hull",
                        "density",
                        "volume",
                        "structure",
                    ],
                    num_chunks=1,
                )[:limit]
            return [normalize_record(self.provider, _model_dump(doc)) for doc in docs]
        except ImportError:
            payload = self._get(
                "materials/summary",
                {"elements": ",".join(elements), "_limit": limit},
            )
            return normalize_payload(self.provider, payload)[:limit]
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(f"Materials Project element search failed: {exc}") from exc

    def get(self, material_id: str) -> MaterialRecord:
        key = os.getenv("MP_API_KEY")
        if not key:
            raise ProviderError("Materials Project requires MP_API_KEY")
        try:
            from mp_api.client import MPRester  # type: ignore

            with MPRester(key) as mpr:
                docs = mpr.materials.summary.search(
                    material_ids=[material_id],
                    fields=[
                        "material_id",
                        "formula_pretty",
                        "elements",
                        "band_gap",
                        "formation_energy_per_atom",
                        "energy_above_hull",
                        "density",
                        "volume",
                        "structure",
                    ],
                )
            if not docs:
                raise ProviderError(f"Materials Project returned no record for {material_id}")
            return normalize_record(self.provider, _model_dump(docs[0]))
        except ImportError:
            return super().get(f"materials/summary/{material_id}")
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(f"Materials Project request failed: {exc}") from exc


class OqmdAdapter(Adapter):
    def __init__(self, request: Callable[..., Any] | None = None) -> None:
        super().__init__("oqmd", "https://oqmd.org/oqmdapi", None, request)

    def capabilities(self) -> ProviderCapability:
        return ProviderCapability(
            self.provider,
            ("formula",),
            pagination=True,
            api_version="oqmdapi",
            fallback_routes=("direct-rest",),
        )

    def search(self, query: str, limit: int) -> list[MaterialRecord]:
        payload = self._get("formationenergy", {"composition": query, "limit": limit})
        return normalize_payload(self.provider, payload)[:limit]

    def get(self, material_id: str) -> MaterialRecord:
        payload = self._get("formationenergy", {"entry_id": material_id, "limit": 1})
        records = normalize_payload(self.provider, payload)
        if not records:
            raise ProviderError(f"OQMD returned no record for {material_id}")
        return records[0]


class AflowAdapter(Adapter):
    def __init__(self, request: Callable[..., Any] | None = None) -> None:
        super().__init__("aflow", "https://aflow.org/API/aflux", None, request)

    def capabilities(self) -> ProviderCapability:
        return ProviderCapability(
            self.provider,
            ("formula", "elements"),
            pagination=True,
            api_version="aflux",
            fallback_routes=("compound", "species"),
        )

    def search(self, query: str, limit: int) -> list[MaterialRecord]:
        if not re.fullmatch(r"[A-Za-z0-9.]+", query):
            raise ProviderError("AFLOW search currently accepts an exact formula")
        payload = self._get(f"?compound({query}),paging(1,{limit}),format(json)", {})
        return normalize_payload(self.provider, payload)[:limit]

    def search_elements(self, elements: list[str], limit: int) -> list[MaterialRecord]:
        if not elements or any(not re.fullmatch(r"[A-Z][a-z]?", value) for value in elements):
            raise ProviderError("AFLOW element search requires valid element symbols", "invalid_query", False)
        species = ",".join(elements)
        payload = self._get(f"?species({species}),paging(1,{limit}),format(json)", {})
        return normalize_payload(self.provider, payload)[:limit]

    def get(self, material_id: str) -> MaterialRecord:
        if not re.fullmatch(r"[A-Za-z0-9:._-]+", material_id):
            raise ProviderError("invalid AFLOW material id")
        payload = self._get(f"?auid('{material_id}'),paging(1,1),format(json)", {})
        records = normalize_payload(self.provider, payload)
        if not records:
            raise ProviderError(f"AFLOW returned no record for {material_id}")
        return records[0]


class NomadAdapter(Adapter):
    def __init__(self, request: Callable[..., Any] | None = None) -> None:
        super().__init__("nomad", "https://nomad-laboratory.eu/api/v1", None, request)

    def capabilities(self) -> ProviderCapability:
        return ProviderCapability(
            self.provider,
            ("formula", "elements"),
            pagination=True,
            api_version="v1",
            fallback_routes=("chemical_formula_reduced", "elements-all"),
        )

    def search(self, query: str, limit: int) -> list[MaterialRecord]:
        nomad_query = {"results.material.chemical_formula_reduced": query} if query else {}
        payload = self._get(
            "entries",
            {"owner": "public", "query": json.dumps(nomad_query), "page_size": limit},
        )
        return normalize_payload(self.provider, payload)[:limit]

    def search_elements(self, elements: list[str], limit: int) -> list[MaterialRecord]:
        nomad_query = {"results.material.elements": {"all": elements}}
        payload = self._get(
            "entries",
            {"owner": "public", "query": json.dumps(nomad_query), "page_size": limit},
        )
        return normalize_payload(self.provider, payload)[:limit]


def _model_dump(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return {
        key: getattr(value, key)
        for key in ("material_id", "formula_pretty", "elements", "band_gap", "formation_energy_per_atom", "energy_above_hull", "density", "volume")
        if hasattr(value, key)
    }


def default_adapters(request: Callable[..., Any] | None = None) -> dict[str, Adapter]:
    return {
        "materials_project": MaterialsProjectAdapter(request),
        "oqmd": OqmdAdapter(request),
        "aflow": AflowAdapter(request),
        "nomad": NomadAdapter(request),
    }


class MaterialsRegistry:
    """Capability-driven query planner backed by a durable execution ledger."""

    def __init__(
        self,
        adapters: dict[str, Adapter] | None = None,
        state_path: Path | None = None,
        policies: dict[str, dict[str, Any]] | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.adapters = adapters or default_adapters()
        self.store = ProviderExecutionStore(state_path)
        self._default_policy = ProviderPolicy()
        self._policies: dict[str, ProviderPolicy] = {}
        self._sleep = sleep
        self.update_policies(policies or {})

    def update_policies(self, policies: dict[str, dict[str, Any]]) -> None:
        for provider, changes in policies.items():
            if provider not in self.adapters:
                continue
            self._policies[provider] = self._default_policy.with_changes(dict(changes))

    def _policy(self, provider: str) -> ProviderPolicy:
        return self._policies.get(provider, self._default_policy)

    def capabilities(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "providers": {
                name: adapter.capabilities().to_dict()
                for name, adapter in self.adapters.items()
            },
            "policies": {
                name: self._policy(name).to_dict()
                for name in self.adapters
            },
            "health": self.store.status(self.adapters),
        }

    @staticmethod
    def _observation_from_job(
        provider: str,
        query: QuerySpec,
        job: dict[str, Any],
        cached: bool = False,
    ) -> SourceObservation:
        records = ProviderExecutionStore.records_from_job(job)
        status = str(job.get("status") or "pending")
        return SourceObservation(
            provider=provider,
            query=query.to_dict(),
            status=status,
            record_count=len(records),
            attempts=int(job.get("attempts") or 0),
            duration_ms=float(job.get("duration_ms") or 0.0),
            cached=cached,
            retryable=bool(job.get("retryable")),
            error=str(job.get("error_message")) if job.get("error_message") else None,
            idempotency_key=str(job.get("idempotency_key") or ""),
        )

    def _execute_query(
        self,
        provider: str,
        query: QuerySpec,
        limit: int,
        deadline: float,
        semaphore: Semaphore,
    ) -> tuple[list[dict[str, Any]], SourceObservation]:
        adapter = self.adapters.get(provider)
        if adapter is None:
            return [], SourceObservation(
                provider=provider,
                query=query.to_dict(),
                status="invalid_query",
                error="unknown provider",
                retryable=False,
                idempotency_key=query_idempotency_key(provider, query, limit),
            )
        policy = self._policy(provider)
        capability = adapter.capabilities()
        if query.mode not in capability.query_modes:
            return [], SourceObservation(
                provider=provider,
                query=query.to_dict(),
                status="invalid_query",
                error=f"{provider} does not support {query.mode} queries",
                retryable=False,
                idempotency_key=query_idempotency_key(provider, query, limit),
            )
        claim_state, job = self.store.claim(provider, query, limit, policy)
        if claim_state == "cached":
            return ProviderExecutionStore.records_from_job(job), self._observation_from_job(provider, query, job, True)
        if claim_state == "busy":
            return [], SourceObservation(
                provider=provider,
                query=query.to_dict(),
                status="pending",
                attempts=int(job.get("attempts") or 0),
                error="an existing worker holds the query lease",
                retryable=True,
                idempotency_key=str(job["idempotency_key"]),
            )

        key = str(job["idempotency_key"])
        owner = str(job["lease_owner"])
        started = time.monotonic()
        last_error = ProviderError("provider query was not attempted", "budget_exhausted", True)
        total_attempts = int(job.get("attempts") or 0)
        with semaphore:
            if not self.store.provider_available(provider):
                last_error = ProviderError("provider circuit is open", "circuit_open", True)
            for local_attempt in range(policy.max_attempts):
                if last_error.kind == "circuit_open":
                    break
                if time.monotonic() >= deadline:
                    last_error = ProviderError("provider time budget exhausted", "budget_exhausted", True)
                    break
                total_attempts = self.store.begin_attempt(key, owner, policy.lease_seconds)
                adapter.request_timeout_seconds = min(
                    policy.request_timeout_seconds,
                    max(1.0, deadline - time.monotonic()),
                )
                try:
                    if query.mode == "elements":
                        records = adapter.search_elements(list(query.value), limit)  # type: ignore[arg-type]
                    else:
                        records = adapter.search(str(query.value), limit)
                    values = [record.to_dict() for record in records]
                    duration_ms = (time.monotonic() - started) * 1000.0
                    status = "found" if values else "not_found"
                    finished = self.store.finish(key, owner, status, values, duration_ms)
                    self.store.record_provider_result(provider, True, duration_ms, policy)
                    return values, self._observation_from_job(provider, query, finished)
                except ProviderError as exc:
                    last_error = exc
                except Exception as exc:
                    last_error = ProviderError(
                        f"{provider} normalization failed: {exc}",
                        "schema_error",
                        True,
                    )
                if not last_error.retryable or local_attempt + 1 >= policy.max_attempts:
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._sleep(min(remaining, 0.25 * (2**local_attempt)))

        duration_ms = (time.monotonic() - started) * 1000.0
        failure_status = last_error.kind
        failure_retryable = last_error.retryable
        failure_message = str(last_error)
        if total_attempts >= policy.max_total_attempts:
            failure_status = "dead_letter"
            failure_retryable = False
            failure_message = f"query retry budget exhausted after {total_attempts} attempts: {last_error}"
        failed = self.store.fail(
            key,
            owner,
            failure_status,
            failure_message,
            failure_retryable,
            duration_ms,
        )
        self.store.record_provider_result(provider, False, duration_ms, policy, str(last_error))
        return [], self._observation_from_job(provider, query, failed)

    def _execute_plan(
        self,
        plan: list[tuple[str, QuerySpec, int]],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if not plan:
            return [], []
        deadlines = {
            provider: time.monotonic() + self._policy(provider).provider_budget_seconds
            for provider, _, _ in plan
            if provider in self.adapters
        }
        semaphores = {
            provider: Semaphore(self._policy(provider).max_concurrency)
            for provider, _, _ in plan
            if provider in self.adapters
        }
        results: dict[int, tuple[list[dict[str, Any]], SourceObservation]] = {}
        max_workers = max(1, min(32, sum(self._policy(name).max_concurrency for name in semaphores)))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(
                    self._execute_query,
                    provider,
                    query,
                    limit,
                    deadlines.get(provider, time.monotonic()),
                    semaphores.get(provider, Semaphore(1)),
                ): index
                for index, (provider, query, limit) in enumerate(plan)
            }
            for future in as_completed(futures):
                results[futures[future]] = future.result()
        records: list[dict[str, Any]] = []
        observations: list[dict[str, Any]] = []
        for index in range(len(plan)):
            rows, observation = results[index]
            records.extend(rows)
            observations.append(observation.to_dict())
        return records, observations

    @staticmethod
    def _result(
        records: list[dict[str, Any]],
        observations: list[dict[str, Any]],
        providers: list[str],
        query_plan: list[dict[str, Any]],
    ) -> dict[str, Any]:
        errors: dict[str, str] = {}
        for observation in observations:
            if observation["status"] not in {"found", "not_found"}:
                errors.setdefault(str(observation["provider"]), str(observation.get("error") or observation["status"]))
        status_counts: dict[str, int] = {}
        for observation in observations:
            status = str(observation["status"])
            status_counts[status] = status_counts.get(status, 0) + 1
        return {
            "schema_version": 1,
            "records": records,
            "source_observations": observations,
            "provider_errors": errors,
            "errors": errors,
            "providers": providers,
            "query_plan": query_plan,
            "status_counts": status_counts,
            "partial": any(row["status"] not in {"found", "not_found"} for row in observations),
            "retrieved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

    def search_many(
        self,
        queries: list[str],
        providers: list[str] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        formulas = list(dict.fromkeys(value.strip() for value in queries if value.strip()))
        if not formulas:
            raise ValueError("at least one formula query is required")
        if len(formulas) > 500:
            raise ValueError("a batch can contain at most 500 formula queries")
        names = providers or list(self.adapters)
        item_limit = max(1, min(int(limit), 500))
        # Interleave providers so one slow provider cannot occupy every worker
        # before another provider receives its first request.
        plan = [(name, QuerySpec.formula(formula), item_limit) for formula in formulas for name in names]
        records, observations = self._execute_plan(plan)
        result = self._result(records, observations, names, [
            {"provider": provider, "query": query.to_dict(), "limit": query_limit}
            for provider, query, query_limit in plan
        ])
        result["queries"] = formulas
        return result

    def discover(
        self,
        elements: list[str],
        formulas: list[str] | None = None,
        providers: list[str] | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        """Prefer one element-set query and fall back to concurrent formula queries."""
        names = providers or list(self.adapters)
        element_query = QuerySpec.elements(elements)
        formula_queries = [QuerySpec.formula(value) for value in dict.fromkeys(formulas or [])]
        item_limit = max(1, min(int(limit), 500))
        plan: list[tuple[str, QuerySpec, int]] = []
        for name in names:
            adapter = self.adapters.get(name)
            if adapter is not None and "elements" in adapter.capabilities().query_modes:
                plan.append((name, element_query, item_limit))
            elif formula_queries:
                plan.extend((name, query, item_limit) for query in formula_queries)
            else:
                plan.append((name, element_query, item_limit))
        records, observations = self._execute_plan(plan)
        result = self._result(records, observations, names, [
            {"provider": provider, "query": query.to_dict(), "limit": query_limit}
            for provider, query, query_limit in plan
        ])
        result["elements"] = list(element_query.value)
        result["fallback_formulas"] = [query.label for query in formula_queries]
        return result

    def resume(self, providers: list[str] | None = None, limit: int = 100) -> dict[str, Any]:
        jobs = self.store.retryable_queries(providers, limit)
        plan: list[tuple[str, QuerySpec, int]] = []
        for job in jobs:
            raw = json.loads(str(job["query_json"]))
            value = raw.get("value")
            query = QuerySpec(str(raw.get("mode")), tuple(value) if isinstance(value, list) else str(value))
            plan.append((str(job["provider"]), query, int(job["limit_count"])))
        records, observations = self._execute_plan(plan)
        names = list(dict.fromkeys(provider for provider, _, _ in plan))
        return self._result(records, observations, names, [
            {"provider": provider, "query": query.to_dict(), "limit": query_limit}
            for provider, query, query_limit in plan
        ])

    def search(self, query: str, providers: list[str] | None = None, limit: int = 20) -> dict[str, Any]:
        result = self.search_many([query], providers, limit)
        result["query"] = query
        return result

    def get(self, provider: str, material_id: str) -> dict[str, Any]:
        adapter = self.adapters.get(provider)
        if adapter is None:
            raise ProviderError(f"unknown provider: {provider}")
        return adapter.get(material_id).to_dict()
