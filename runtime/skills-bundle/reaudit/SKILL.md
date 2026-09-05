---
name: reaudit
description: >
  Use when the user types /reaudit or asks to verify that security fixes have
  been applied, re-audit a codebase after fixes, or check whether previous audit
  findings are resolved. Shortcut for code-security-audit Phase 4 (re-audit
  verification). Triggers on "/reaudit", "re-audit", "verify fixes", "再审计",
  "检查修复", "确认修复". Also enables lightweight state tracking:
  /reaudit mark-fixed <ID>, /reaudit mark-deferred <ID>, /reaudit status.
---

# /reaudit — Verify Security Fixes & State Tracking

Three modes of operation:

| Command | Action | Reads files? |
|---------|--------|-------------|
| `/reaudit` | Full incremental re-audit (Phase 4) | Only changed files |
| `/reaudit mark-fixed <ID>` | Lightweight: mark finding as fixed | No |
| `/reaudit mark-deferred <ID>` | Lightweight: mark as structurally deferred | No |
| `/reaudit status` | Show fix progress summary | No (scans annotations) |

---

## Mode 1: Full Re-Audit (`/reaudit`)

Load and follow `code-security-audit` Phase 4. Key steps:

1. **Parse status annotations** — scan `docs/SECURITY_AUDIT.md` for all `<!-- AUDIT:STATUS=... -->` lines. Extract `FILE`, `LINES`, `STATUS` for each finding.

2. **Diff-filter** — run `git diff --name-only <audit-commit>..HEAD`. Only findings whose `FILE` appears in the diff need re-verification.

3. **Re-verify changed-file findings** — read the file at the flagged location, check fix status:
   - `STATUS=fixed COMMIT=<hash>` if fix is in place
   - `STATUS=not-fixed` if still vulnerable
   - `STATUS=partial` if partially addressed

4. **Skip unchanged-file findings** — keep current STATUS, don't re-read.

5. **Check for regressions** — scan added lines in the diff for new vulnerability patterns.

6. **Add Re-Audit section** to the report (structure defined in `code-security-audit` Phase 4).

---

## Mode 2: mark-fixed (`/reaudit mark-fixed <ID>`)

Lightweight state update. No file reads. Use after committing a fix.

1. Grep the report for `<!-- AUDIT:STATUS=...` line containing the given ID
2. If `STATUS=open` or `STATUS=not-fixed`:
   - Change to `STATUS=fixed COMMIT=<current HEAD hash>`
   - Report: "SSRF-1 marked as fixed (commit abc1234)"
3. If already `STATUS=fixed`: warn but allow updating the commit hash
4. If `STATUS=deferred`: warn — user should confirm the deferral reason no longer applies

Multiple IDs can be specified: `/reaudit mark-fixed SSRF-1 PATH-1 AUTH-1`

---

## Mode 3: mark-deferred (`/reaudit mark-deferred <ID>`)

For structural findings that won't be fixed soon (TLS, keychain, architectural changes).

1. Update annotation: `STATUS=deferred`
2. The finding stays in the report with its deferred status visible

---

## Mode 4: status (`/reaudit status`)

Quick fix-progress overview. No file reads.

1. Grep all `AUDIT:STATUS=` annotations
2. Count by status and severity
3. Output:

```
  Status      Count
  ─────────   ─────
  fixed       5
  open        1
  deferred    1
  ─────────   ─────
  Total       7     (71% fixed)
```

If there are `not-fixed` entries, list them explicitly with IDs and severity.

---

## Status Annotation Format Reference

See `code-security-audit/SKILL.md` Phase 3 and `code-security-audit/references/vulnerability-patterns.md` §18.

Quick reference:
```markdown
### SSRF-1 — tool_fetch_url navigates to unvalidated URL
<!-- AUDIT:STATUS=open SEVERITY=high FILE=your-project/src/module.py LINES=100-120 -->
```
