---
name: security-fix-skill
description: |
  Guided security fix workflow.  Use when the user wants to fix security audit
  findings, remediate vulnerabilities, apply security patches, or work through
  a security audit report.  Triggers on "/security-fix", "fix security",
  "remediate", "apply audit fixes", "修安全漏洞", "修复审计问题", "安全修复",
  or when the user mentions a SECURITY_AUDIT.md file and wants to fix the
  findings.
---

## Security fix workflow

This skill guides the systematic remediation of security audit findings,
grouped by priority level (P1–P4).  The process was refined across 16
real-world findings in a Python web application project.

### Step 1: Load the audit report

Read the audit document (typically `docs/SECURITY_AUDIT.md`). Extract:
- Each finding's ID, severity, affected file, line number, and description
- The remediation code or instructions provided
- The priority rating (P1 = fix immediately, P4 = address when convenient)

Present a summary table to the user showing severity distribution and
file-level impact, then ask which priority level to start with.

### Step 2: Fix one priority level at a time

For each finding in the current priority:

1. **Read the affected code** at the specified file and line range
2. **Apply the remediation** from the audit doc — prefer minimal, targeted
   edits that don't change behavior
3. **Verify the fix** by re-reading the changed lines
4. **Track progress**: "3 of 5 P1 fixes applied"

### Step 3: Test after each priority level

After completing all fixes at a priority level:
```bash
pytest tests/ -x -q   # or the project's test command
```

If any tests fail, investigate before proceeding.  The most common failure
mode is monkeypatch targets changing when code moves between modules.

### Step 4: Commit the batch

Commit all fixes at the current priority level together:
```bash
git add -u
git commit -m "fix: security — <summary> (P<N> SSRF-1 PATH-1 AUTH-1)"
```

Use conventional commit format. Include the finding IDs in the commit message
body so they are traceable.  Push when requested by the user.

### Step 5: Mark-fixed and move to next priority

After committing each priority batch:
1. Run `/reaudit mark-fixed <ID>` for each finding in the batch. This updates
   the report's status annotations without re-reading files.
2. Repeat steps 2–5 for the next priority level.  Typical execution order:
   P1 (5 findings, ~15 min) → P2 (4 findings, ~10 min) → P3 (3 findings, ~10 min) → P4 (4 findings, ~10 min)

### Step 6: Final verification

After all priorities are committed and marked, verify the state:
1. Run `/reaudit status` to confirm all findings are `fixed` or `deferred`
2. If any findings remain `open` or `not-fixed`, ask the user how to handle
3. Optionally run a targeted `/reaudit` on the changed files only to double-check
   no regressions were introduced

### Common fix patterns

These patterns recurred across the audit and can be applied quickly:

**Path traversal** — resolve + is_relative_to guard (lstrip only blocks absolute paths, not `../`):
```python
file_path = (STATIC_DIR / path.lstrip("/")).resolve()
if not file_path.is_relative_to(STATIC_DIR.resolve()):
    return 404
```

**CORS over-permission** — remove `Access-Control-Allow-Origin: *`; add
token/cookie auth instead.

**Command injection** — replace `shell=True` with native APIs (`os.startfile`,
`webbrowser.open`) or pass data through environment variables instead of
string interpolation.

**XSS (innerHTML)** — replace with `textContent` for user-controlled data;
HTML-escape before `innerHTML` when formatting is needed.

**SSRF** — validate URLs against an allowlist of known hosts before making
outbound requests.

**Plaintext credentials** — strip sensitive env vars before spawning
subprocesses; add `os.chmod(path, 0o600)` on Unix after writing credential
files.

**Temp file cleanup** — wrap `tempfile.mkdtemp()` / `NamedTemporaryFile` with
`atexit.register()` for cleanup even on crash paths.

### Edge cases

- **Server-controlled crypto (e.g., PKCS1v15)**: can't change unilaterally —
  add a comment documenting the constraint
- **Structural fixes (TLS, keychain)**: acknowledge as deferred, document in
  the re-audit
- **Findings in files the user doesn't own**: flag as "out of scope" but
  document
- **Re-audit after fixes**: run `/reaudit status` to confirm all findings are
  resolved. The status annotations (`<!-- AUDIT:STATUS=... -->`) track fix state
  per finding, eliminating the need to manually update line numbers in the report.
