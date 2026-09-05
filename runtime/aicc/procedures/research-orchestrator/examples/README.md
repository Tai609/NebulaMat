# Research Orchestrator Examples

Examples are small state directories for validating the research-orchestrator protocol.

- `minimal-project/` is valid and should produce at least one ready task.
- `blocked-project/` is valid but demonstrates blocked reasons.
- `role-handoff-project/` is valid and demonstrates Phase 2 role contracts, a critic
  evidence packet, single-owner execution, and report blocking until a claim is
  accepted.
- `structure-review-project/` is valid and demonstrates the slab/adsorbate model review
  gate: surface-literature review, structure-prep generation, and read-only structure
  criticism before engine handoff.
- `iterative-followup-project/` is valid and demonstrates an unrolled scientific
  loop: first-wave parser evidence, result criticism, accepted `follow-up-proposal`,
  follow-up execution, re-criticism, and final report release only after the proposal is
  resolved.
- `claim-ready-project/` is valid and demonstrates a ready task that must be claimed
  before expensive execution.
- `claimed-execution-project/` is valid and demonstrates an active single-owner lease.
- `stale-lease-project/` is valid but `reconcile_leases.py --now ...` reports a stale
  lease.
- `broken-cycle/`, `broken-missing-artifact/`, `broken-path-escape/`, and
  `broken-role-boundary/`, `broken-running-without-lease/`, and
  `broken-lease-conflict/` are negative fixtures for `validate_state.py`.

Smoke-test commands:

```bash
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/smoke_tests.py

uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/validate_state.py \
  __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/examples/minimal-project/.research
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/ready_tasks.py \
  __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/examples/minimal-project/.research
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/ready_tasks.py \
  __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/examples/role-handoff-project/.research
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/ready_tasks.py \
  __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/examples/structure-review-project/.research
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/check_pre_report.py \
  __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/examples/iterative-followup-project/.research T006
uv run __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/scripts/reconcile_leases.py \
  __NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/examples/stale-lease-project/.research \
  --now 2026-06-25T00:30:00+08:00
```
