"""Durable, bounded execution primitives for materials data providers.

Agents submit query intents.  This module owns the operational details that
must remain deterministic: idempotency, leases, checkpoints, circuit state,
and the distinction between an empty result and an unavailable provider.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

from .schemas import SOURCE_OBSERVATION_STATUSES, now_iso


QUERY_TERMINAL = {"found", "not_found"}
QUERY_RETRYABLE = {"timeout", "rate_limited", "unavailable", "schema_error", "budget_exhausted"}
QUERY_STATUSES = set(SOURCE_OBSERVATION_STATUSES) | {"running"}


@dataclass(frozen=True)
class ProviderPolicy:
    """Allowlisted operational policy that may be tuned through canary rollout."""

    request_timeout_seconds: float = 10.0
    provider_budget_seconds: float = 120.0
    max_attempts: int = 2
    max_total_attempts: int = 6
    max_concurrency: int = 4
    failure_threshold: int = 3
    cooldown_seconds: float = 60.0
    cache_ttl_seconds: float = 86_400.0
    batch_size: int = 50
    lease_seconds: float = 45.0

    def validate(self) -> None:
        bounds = {
            "request_timeout_seconds": (1.0, 60.0),
            "provider_budget_seconds": (5.0, 900.0),
            "max_attempts": (1, 5),
            "max_total_attempts": (1, 20),
            "max_concurrency": (1, 16),
            "failure_threshold": (1, 20),
            "cooldown_seconds": (5.0, 3_600.0),
            "cache_ttl_seconds": (0.0, 604_800.0),
            "batch_size": (1, 500),
            "lease_seconds": (5.0, 300.0),
        }
        for name, (minimum, maximum) in bounds.items():
            value = getattr(self, name)
            if not minimum <= value <= maximum:
                raise ValueError(f"{name} must be between {minimum} and {maximum}")
        if self.max_total_attempts < self.max_attempts:
            raise ValueError("max_total_attempts must be at least max_attempts")

    def with_changes(self, changes: dict[str, Any]) -> "ProviderPolicy":
        unknown = sorted(set(changes) - set(asdict(self)))
        if unknown:
            raise ValueError(f"unsupported provider policy fields: {unknown}")
        values = {**asdict(self), **changes}
        policy = ProviderPolicy(
            request_timeout_seconds=float(values["request_timeout_seconds"]),
            provider_budget_seconds=float(values["provider_budget_seconds"]),
            max_attempts=int(values["max_attempts"]),
            max_total_attempts=int(values["max_total_attempts"]),
            max_concurrency=int(values["max_concurrency"]),
            failure_threshold=int(values["failure_threshold"]),
            cooldown_seconds=float(values["cooldown_seconds"]),
            cache_ttl_seconds=float(values["cache_ttl_seconds"]),
            batch_size=int(values["batch_size"]),
            lease_seconds=float(values["lease_seconds"]),
        )
        policy.validate()
        return policy

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)


@dataclass(frozen=True)
class ProviderCapability:
    provider: str
    query_modes: tuple[str, ...]
    bulk_formula_size: int = 1
    pagination: bool = False
    api_version: str = "unknown"
    fallback_routes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["query_modes"] = list(self.query_modes)
        value["fallback_routes"] = list(self.fallback_routes)
        return value


@dataclass(frozen=True)
class QuerySpec:
    mode: str
    value: str | tuple[str, ...]

    @classmethod
    def formula(cls, value: str) -> "QuerySpec":
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("formula query cannot be empty")
        return cls("formula", cleaned)

    @classmethod
    def elements(cls, values: Iterable[str]) -> "QuerySpec":
        cleaned = tuple(sorted({str(value).strip() for value in values if str(value).strip()}))
        if not cleaned:
            raise ValueError("element query cannot be empty")
        return cls("elements", cleaned)

    def to_dict(self) -> dict[str, Any]:
        return {"mode": self.mode, "value": list(self.value) if isinstance(self.value, tuple) else self.value}

    @property
    def label(self) -> str:
        return ",".join(self.value) if isinstance(self.value, tuple) else self.value


@dataclass
class SourceObservation:
    provider: str
    query: dict[str, Any]
    status: str
    record_count: int = 0
    attempts: int = 0
    duration_ms: float = 0.0
    cached: bool = False
    retryable: bool = False
    error: str | None = None
    idempotency_key: str = ""
    observed_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        if self.status not in QUERY_STATUSES:
            raise ValueError(f"unknown source observation status: {self.status}")
        value = asdict(self)
        value["observed_at"] = self.observed_at or now_iso()
        return value


def query_idempotency_key(provider: str, query: QuerySpec, limit: int, schema_version: int = 1) -> str:
    payload = json.dumps(
        {"provider": provider, "query": query.to_dict(), "limit": int(limit), "schema_version": schema_version},
        sort_keys=True,
        separators=(",", ":"),
    )
    return "mq_" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


class ProviderExecutionStore:
    """SQLite-backed query ledger shared by concurrent agent sessions."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path.resolve() if path is not None else None
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        target = str(self.path) if self.path is not None else ":memory:"
        self._target = target
        self._memory_connection = (
            sqlite3.connect(":memory:", timeout=10.0, check_same_thread=False)
            if self.path is None
            else None
        )
        self._lock = threading.RLock()
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS query_jobs (
                    idempotency_key TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    query_mode TEXT NOT NULL,
                    query_json TEXT NOT NULL,
                    limit_count INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    lease_owner TEXT,
                    lease_until REAL,
                    result_json TEXT,
                    error_kind TEXT,
                    error_message TEXT,
                    retryable INTEGER NOT NULL DEFAULT 0,
                    duration_ms REAL NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_epoch REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS query_jobs_provider_status
                    ON query_jobs(provider, status, updated_epoch);
                CREATE TABLE IF NOT EXISTS provider_health (
                    provider TEXT PRIMARY KEY,
                    state TEXT NOT NULL,
                    consecutive_failures INTEGER NOT NULL DEFAULT 0,
                    opened_until REAL,
                    last_error TEXT,
                    last_latency_ms REAL NOT NULL DEFAULT 0,
                    success_count INTEGER NOT NULL DEFAULT 0,
                    failure_count INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                """
            )

    @contextmanager
    def _connection(self):
        connection = self._memory_connection or sqlite3.connect(
            self._target, timeout=10.0, check_same_thread=False
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 10000")
        if self.path is not None:
            connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
            connection.commit()
        finally:
            if self._memory_connection is None:
                connection.close()

    @staticmethod
    def _dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
        return dict(row) if row is not None else None

    def claim(
        self,
        provider: str,
        query: QuerySpec,
        limit: int,
        policy: ProviderPolicy,
    ) -> tuple[str, dict[str, Any]]:
        """Return claimed, cached, or busy and the durable job snapshot."""
        key = query_idempotency_key(provider, query, limit)
        now = time.time()
        owner = f"worker_{uuid.uuid4().hex[:16]}"
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM query_jobs WHERE idempotency_key = ?", (key,)
            ).fetchone()
            existing = self._dict(row)
            if existing and existing["status"] in QUERY_TERMINAL:
                age = max(0.0, now - float(existing["updated_epoch"]))
                if age <= policy.cache_ttl_seconds:
                    return "cached", existing
            if existing and existing["status"] == "running" and float(existing.get("lease_until") or 0) > now:
                return "busy", existing
            created_at = str(existing["created_at"]) if existing else now_iso()
            connection.execute(
                """
                INSERT INTO query_jobs (
                    idempotency_key, provider, query_mode, query_json, limit_count,
                    status, attempts, lease_owner, lease_until, result_json,
                    error_kind, error_message, retryable, duration_ms,
                    created_at, updated_at, updated_epoch
                ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, NULL, NULL, NULL, 0, 0, ?, ?, ?)
                ON CONFLICT(idempotency_key) DO UPDATE SET
                    status = 'running', lease_owner = excluded.lease_owner,
                    lease_until = excluded.lease_until, error_kind = NULL,
                    error_message = NULL, result_json = NULL, retryable = 0,
                    updated_at = excluded.updated_at, updated_epoch = excluded.updated_epoch
                """,
                (
                    key,
                    provider,
                    query.mode,
                    json.dumps(query.to_dict(), sort_keys=True),
                    int(limit),
                    int(existing["attempts"]) if existing else 0,
                    owner,
                    now + policy.lease_seconds,
                    created_at,
                    now_iso(),
                    now,
                ),
            )
            claimed = connection.execute(
                "SELECT * FROM query_jobs WHERE idempotency_key = ?", (key,)
            ).fetchone()
            return "claimed", dict(claimed)

    def begin_attempt(self, key: str, owner: str, lease_seconds: float) -> int:
        now = time.time()
        with self._lock, self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE query_jobs
                SET attempts = attempts + 1, lease_until = ?, updated_at = ?, updated_epoch = ?
                WHERE idempotency_key = ? AND lease_owner = ? AND status = 'running'
                """,
                (now + lease_seconds, now_iso(), now, key, owner),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("query lease was lost before execution")
            row = connection.execute(
                "SELECT attempts FROM query_jobs WHERE idempotency_key = ?", (key,)
            ).fetchone()
            return int(row["attempts"])

    def finish(
        self,
        key: str,
        owner: str,
        status: str,
        records: list[dict[str, Any]],
        duration_ms: float,
    ) -> dict[str, Any]:
        if status not in QUERY_TERMINAL:
            raise ValueError("successful query status must be found or not_found")
        now = time.time()
        with self._lock, self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE query_jobs
                SET status = ?, result_json = ?, lease_owner = NULL, lease_until = NULL,
                    retryable = 0, duration_ms = ?, updated_at = ?, updated_epoch = ?
                WHERE idempotency_key = ? AND lease_owner = ?
                """,
                (status, json.dumps(records, sort_keys=True), float(duration_ms), now_iso(), now, key, owner),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("query lease was lost before completion")
            return dict(connection.execute(
                "SELECT * FROM query_jobs WHERE idempotency_key = ?", (key,)
            ).fetchone())

    def fail(
        self,
        key: str,
        owner: str,
        status: str,
        message: str,
        retryable: bool,
        duration_ms: float,
    ) -> dict[str, Any]:
        if status not in QUERY_STATUSES - QUERY_TERMINAL - {"pending", "running"}:
            raise ValueError(f"invalid query failure status: {status}")
        now = time.time()
        with self._lock, self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE query_jobs
                SET status = ?, error_kind = ?, error_message = ?, retryable = ?,
                    lease_owner = NULL, lease_until = NULL, duration_ms = ?,
                    updated_at = ?, updated_epoch = ?
                WHERE idempotency_key = ? AND lease_owner = ?
                """,
                (status, status, message, int(retryable), float(duration_ms), now_iso(), now, key, owner),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("query lease was lost before failure was recorded")
            return dict(connection.execute(
                "SELECT * FROM query_jobs WHERE idempotency_key = ?", (key,)
            ).fetchone())

    def provider_available(self, provider: str) -> bool:
        now = time.time()
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM provider_health WHERE provider = ?", (provider,)
            ).fetchone()
            if row is None or row["state"] == "closed":
                return True
            if row["state"] == "half_open":
                return False
            if float(row["opened_until"] or 0) > now:
                return False
            connection.execute(
                "UPDATE provider_health SET state = 'half_open', updated_at = ? WHERE provider = ?",
                (now_iso(), provider),
            )
            return True

    def record_provider_result(
        self,
        provider: str,
        success: bool,
        latency_ms: float,
        policy: ProviderPolicy,
        error: str | None = None,
    ) -> None:
        now = time.time()
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM provider_health WHERE provider = ?", (provider,)
            ).fetchone()
            failures = 0 if success else int(row["consecutive_failures"] if row else 0) + 1
            state = "closed" if success else ("open" if failures >= policy.failure_threshold else "closed")
            opened_until = now + policy.cooldown_seconds if state == "open" else None
            success_count = int(row["success_count"] if row else 0) + int(success)
            failure_count = int(row["failure_count"] if row else 0) + int(not success)
            connection.execute(
                """
                INSERT INTO provider_health (
                    provider, state, consecutive_failures, opened_until, last_error,
                    last_latency_ms, success_count, failure_count, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                    state = excluded.state,
                    consecutive_failures = excluded.consecutive_failures,
                    opened_until = excluded.opened_until,
                    last_error = excluded.last_error,
                    last_latency_ms = excluded.last_latency_ms,
                    success_count = excluded.success_count,
                    failure_count = excluded.failure_count,
                    updated_at = excluded.updated_at
                """,
                (
                    provider,
                    state,
                    failures,
                    opened_until,
                    None if success else error,
                    float(latency_ms),
                    success_count,
                    failure_count,
                    now_iso(),
                ),
            )

    def status(self, providers: Iterable[str] | None = None) -> dict[str, Any]:
        names = list(providers or [])
        with self._lock, self._connection() as connection:
            if names:
                placeholders = ",".join("?" for _ in names)
                rows = connection.execute(
                    f"SELECT * FROM provider_health WHERE provider IN ({placeholders}) ORDER BY provider", names
                ).fetchall()
            else:
                rows = connection.execute("SELECT * FROM provider_health ORDER BY provider").fetchall()
            jobs = connection.execute(
                "SELECT provider, status, COUNT(*) AS count FROM query_jobs GROUP BY provider, status ORDER BY provider, status"
            ).fetchall()
        health = {str(row["provider"]): dict(row) for row in rows}
        counts: dict[str, dict[str, int]] = {}
        for row in jobs:
            counts.setdefault(str(row["provider"]), {})[str(row["status"])] = int(row["count"])
        return {"providers": health, "query_counts": counts, "generated_at": now_iso()}

    def retryable_queries(self, providers: Iterable[str] | None = None, limit: int = 100) -> list[dict[str, Any]]:
        names = list(providers or [])
        parameters: list[Any] = []
        where = "retryable = 1"
        if names:
            where += " AND provider IN (" + ",".join("?" for _ in names) + ")"
            parameters.extend(names)
        parameters.append(max(1, min(int(limit), 500)))
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                f"SELECT * FROM query_jobs WHERE {where} ORDER BY updated_epoch ASC LIMIT ?", parameters
            ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def records_from_job(job: dict[str, Any]) -> list[dict[str, Any]]:
        try:
            value = json.loads(str(job.get("result_json") or "[]"))
        except json.JSONDecodeError:
            return []
        return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []
