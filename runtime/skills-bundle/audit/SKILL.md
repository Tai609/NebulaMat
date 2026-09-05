---
name: audit
description: Use when the user types /audit. Shortcut for code-security-audit Phase 1-3 (explore → verify → report). Triggers ONLY on the exact slash command "/audit" — for natural language phrases like "security audit" or "安全审计", the code-security-audit skill handles those.
---

# /audit — Full Security Audit

Shortcut slash command. Immediately load and follow `code-security-audit` (Phase 1 through 3):

1. Launch 3 parallel Explore agents (secrets, injection, auth/crypto/deps)
2. Verify findings, filter false positives, assign severity
3. Write structured report to `docs/SECURITY_AUDIT.md`

Read `code-security-audit/SKILL.md` for the full workflow. Do not skip phases.
