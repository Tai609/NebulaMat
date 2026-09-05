---
name: code-security-audit
description: Use when the user wants to audit a codebase for security vulnerabilities, perform a security review, do penetration testing, run a 代码审计 or 安全审查, check for security issues, or verify that security fixes have been applied. Triggers on phrases like "audit this repo", "security review", "find vulnerabilities", "安全审计", "代码审计", "再审计", "verify fixes", "安全扫描".
---

# Code Security Audit

## Overview

Systematic security audit of any codebase using parallel domain exploration. Launch independent review agents across three security domains simultaneously, then synthesize findings into a structured audit report with severity ratings and concrete remediation steps.

**Core principle:** Coverage through parallelization. Three focused agents catch more than one broad agent — each domain has different grep patterns, different mental models, and different blind spots.

## 场景判定（先定深度，再走流程）

| 场景 | 触发 | 深度 | 产出 | 流程 |
|------|------|:--:|------|------|
| 快速风险扫描 | "/audit quick" / "快扫一眼" | L1 | 一页风险概览（不看全文） | Phase 1 单 agent + 摘要，跳过 Self-Check |
| **全面审计（默认）** | "audit this repo" / "安全审计" / "/audit" | L2-L3 | 完整 SECURITY_AUDIT.md | Phase 1-3 全流程 |
| 增量重审 | "/reaudit" / "检查修复" | 变更文件 | 重审段 + 状态更新 | Phase 4 |
| 单 PR / 单文件 | "review this PR" / "看下这个改动" | — | 代码评审 | 委托 code-review，不进安全审计 |
| 快速修复 | "/security-fix" / "修漏洞" | — | 按 P1-P4 批量修复 | security-fix-skill |

> 默认是**全面审计**。用户要求"快扫/quick"才降级 L1；"修漏洞/再审计"分别走 security-fix / reaudit。场景不清时按全面审计走，深度宁高勿低。

## Slash Commands

| Command | Action |
|---------|--------|
| `/audit` | Full security audit — explore → verify → report (Phase 1–3) |
| `/reaudit` | Verify previous audit fixes were applied (Phase 4) |
| `/reaudit mark-fixed <ID>` | Lightweight: mark a finding as fixed (update status annotation only, no file read) |
| `/reaudit mark-deferred <ID>` | Mark a finding as structurally deferred |
| `/reaudit status` | Show current fix progress (count by status from annotations) |
| `/code-security-audit` | Same as `/audit` (canonical name) |

## When to Use

Trigger when the user asks to:
- Audit a repository or codebase for security issues
- Perform a security review or vulnerability assessment
- Check if security fixes were properly applied (re-audit)
- Find vulnerabilities before a release or deployment

Do NOT use for:
- Reviewing a single PR diff (use `/security-review` or manual review)
- Checking one specific function for bugs (use systematic-debugging)
- General code review for style/architecture (use `/code-review`)

## Audit Workflow

### Pre-Flight — REQUIRED BEFORE Step 0

BEFORE launching any agent or reading any code, complete these checks. This gate is **unconditional** — do not first decide whether the task "needs" it.

1. **Read `references/vulnerability-patterns.md`** — MUST finish before Phase 1. This is a required read, not a reference to skim later.
2. **Run `git rev-parse HEAD`** — store the audit commit hash for the report header.
3. **Identify the project language/framework** — run `ls *.py *.js *.ts *.go *.rs *.java 2>/dev/null` to probe. Customize agent grep patterns accordingly. If no code files found, ask the user what language the project uses.
4. **Check for prior report** — if `docs/SECURITY_AUDIT.md` exists, read the `**Audit commit:**` field. This feeds Step 0.

Any check skipped = audit validity compromised. If you must skip a check, state which one and why BEFORE proceeding.

### Step 0 — Scope Discovery

Before launching Phase 1, determine the review scope:

1. **Check for a previous audit report** at `docs/SECURITY_AUDIT.md`. If it exists, read the `**Audit commit:** <hash>` field.

2. **If a previous audit exists**, run:
   ```bash
   git diff --name-only <last-audit-commit>..HEAD
   ```
   These are the **changed files** since the last audit. Inject them into each Phase 1 agent prompt as:
   ```
   **Priority files (changed since last audit):** <list of paths>
   Focus 70% of attention on these files; cover the rest at normal depth.
   ```

3. **If this is the first audit** (no previous report), skip this step. All files get equal attention.

### Phase 1 — Parallel Exploration

Launch **3 Explore agents simultaneously** (single message, parallel tool calls). Each agent covers one security domain.

**Agent A: Secrets & Credentials**
Prompt template:
```
Explore the codebase at <path> for security issues related to secrets, credentials, and sensitive data handling:
1. Hardcoded API keys, tokens, passwords in source files
2. .env files, config files that might contain secrets
3. How credentials are stored, accessed, and written
4. Any logging or error messages that might leak sensitive data
5. Check .gitignore — are sensitive file patterns properly excluded?
6. Check git history for accidentally committed secrets
For each finding, assign a stable category prefix:
  SECRET (leaked keys/tokens), DEP (file permissions/temp files)
Report findings with specific file paths, line numbers, and code snippets.

**Confidence annotation — REQUIRED on every finding:**
- CONFIDENCE=high: exploit confirmed by code trace to user input
- CONFIDENCE=medium: pattern matches but reachability unclear from grep alone
- CONFIDENCE=low: suspicious pattern, likely requires context to confirm

CONFIDENCE=low findings MUST still be reported — never suppress them. That filtering decision belongs to Phase 2, not Phase 1.
```

**Agent B: Input Validation & Injection**
Prompt template:
```
Explore the codebase at <path> for security issues related to input validation, injection, and unsafe data handling:
1. Command injection: shell=True, os.system, subprocess with user input in command strings
2. SQL injection if database queries exist
3. Path traversal: user input used in file paths without validation
4. Insecure deserialization: pickle, yaml.load, marshal
5. XSS: innerHTML, document.write, unsanitized user data in HTML context
6. SSRF: user-controlled URLs in HTTP clients without allowlist validation
7. Unsafe eval/exec usage
8. Template injection (SSTI)
For each finding, assign a stable category prefix:
  SSRF (SSRF), PATH (path traversal), CMD (command injection),
  XSS (cross-site scripting), CODE (eval/exec)
Report findings with specific file paths, line numbers, and code snippets.

**Confidence annotation — REQUIRED on every finding:**
- CONFIDENCE=high: exploit confirmed by code trace to user input
- CONFIDENCE=medium: pattern matches but reachability unclear from grep alone
- CONFIDENCE=low: suspicious pattern, likely requires context to confirm

CONFIDENCE=low findings MUST still be reported — never suppress them. That filtering decision belongs to Phase 2, not Phase 1.
```

**Agent C: Auth, Cryptography & Dependencies**
Prompt template:
```
Explore the codebase at <path> for security issues related to:
1. Authentication and authorization: missing auth checks, weak auth mechanisms
2. Cryptography: weak algorithms (MD5, SHA1, DES), hardcoded keys, improper TLS
3. Session management: insecure cookies, missing HttpOnly/Secure/SameSite
4. CSRF protections on state-changing endpoints
5. Dependency security — check ALL of the following:
   a. Unpinned versions, missing lockfile
   b. Run the appropriate command for the project's ecosystem:
      - Python: pip check (detects version conflicts), safety check (known CVEs)
      - Node: npm audit, npx check-for-known-vulnerabilities
      - Rust: cargo audit
      - Go: govulncheck ./...
      - Java: mvn dependency-check:check
   c. If a previous audit report exists, diff the dependency file:
      git diff <last-audit-commit>..HEAD -- requirements.txt package.json pyproject.toml Cargo.toml go.mod pom.xml
   d. Flag new dependencies added since last audit — these need extra scrutiny
6. File permissions: credential files with weak permissions
7. Temp file handling: predictable names, missing cleanup
For each finding, assign a stable category prefix:
  AUTH (missing/weak auth), CRYPTO (weak crypto/TLS),
  DEP (dependencies/file-perms/temp-files)
Report findings with specific file paths, line numbers, and code snippets.

**Confidence annotation — REQUIRED on every finding:**
- CONFIDENCE=high: exploit confirmed by code trace to user input
- CONFIDENCE=medium: pattern matches but reachability unclear from grep alone
- CONFIDENCE=low: suspicious pattern, likely requires context to confirm

CONFIDENCE=low findings MUST still be reported — never suppress them. That filtering decision belongs to Phase 2, not Phase 1.
```

**Category-Prefixed IDs are stable** — they don't shift when new findings are added across audits. Use the prefix table in the report template (Phase 3).

**Customize the prompts** based on the codebase language and framework. Add language-specific patterns (e.g., for Python add `os.popen`, for JS add `eval`, for Go add `text/template` without escaping).

**Fallback: if parallel agents fail.** After launching Phase 1 agents, check how many returned valid findings:
- **3 or 2 valid reports** → proceed normally to Phase 2.
- **1 or 0 valid reports** → parallel launch failed. Immediately launch a **single comprehensive Agent** covering all three domains:

```
Explore the codebase at <path> for ALL security issues across three domains:

Domain A — Secrets & Credentials:
  Hardcoded keys, .env files, credential storage, logging leaks, .gitignore gaps, git history

Domain B — Input Validation & Injection:
  Command injection, SQL injection, path traversal, deserialization, XSS, SSRF, eval/exec

Domain C — Auth, Cryptography & Dependencies:
  Auth checks, weak crypto, session management, CSRF, dependency security, file permissions

For each finding, assign a category prefix (SECRET/DEP, SSRF/PATH/CMD/XSS/CODE, AUTH/CRYPTO/DEP).
Report findings with specific file paths, line numbers, and code snippets.

**Confidence annotation — REQUIRED on every finding.**
Same scale: high/medium/low. Low-confidence findings must still be reported.
```

The comprehensive agent's report replaces the missing parallel reports. Proceed to Phase 2 with whatever results are available.

### Phase 2 — Deep-Dive Verification

After receiving all three agent reports:

1. **Read the flagged files** yourself. Agents provide summaries but you must verify each finding is real.
2. **Filter false positives**. Not everything an agent flags is exploitable. Check context: is user input actually reachable? Is the vulnerable function guarded?
3. **Deduplicate overlapping findings**. Agents A, B, and C may flag the same issue independently. Merge findings that:
   - Share the same file AND lines are within 15 of each other → same root cause
   - Share the same vulnerability category AND same file → likely the same issue
   - Keep the most detailed description; note both agent sources in the merged entry
4. **Run the Finding Self-Check** on every finding BEFORE it enters the report. A finding that fails ANY of these checks is NOT a finding — it is a note or a false positive:

   | # | Check | Fail Action |
   |---|-------|-------------|
   | 1 | Can I trace user input to this code without auth? | No → downgrade severity by 1 level |
   | 2 | Is there a compensating guard within 20 lines? | Yes → document the guard; this is NOT a finding |
   | 3 | Was this confirmed by a DIFFERENT grep/search than the one that found it? | No → mark UNCONFIRMED; do NOT assign above Low |
   | 4 | Can this code path execute in production? | No → informational only; NOT a finding |
   | 5 | Is this a code-quality opinion disguised as a security finding? ("use const", "extract function") | Yes → discard; NOT a finding |

   **Self-Check examples — concrete cases:**

   ```
   CORRECT kill (check 2): Agent flags "subprocess.run(cmd, shell=True)" at line 42.
   Guard at line 38: cmd = shlex.quote(user_input). Check 2 finds the guard → NOT a finding.

   CORRECT downgrade (check 3): Agent flags "pickle.load(open(f))" in a test file.
   Grep found it; no second method confirmed. Check 3 fails → UNCONFIRMED, ceiling = Low.

   CORRECT discard (check 5): "var should be const" → NOT a security finding. Discard.

   WRONG kill: Agent flags "open(user_file)" as path traversal. The agent didn't
   read the allowlist validation 5 lines above. Check 2 SHOULD have caught this.
   ```

4.5 **Adversarial verification（跨模型，可选但推荐）** — 单模型自审会漏掉"过度自信"。把合并后的 findings 写到临时文件，调 `review.py`（ARIS 对抗范式，不同模型）攻击它：

   ```bash
   review /tmp/findings_draft.md "security audit findings — 哪些 fail 5 点 Self-Check？哪些 Critical/High 只有单方法检出？哪些是误报？"
   ```

   review.py 假设 findings 有严重问题并强攻——它的 strongest_objection（单一最强拒绝理由）+ other_weaknesses（次要弱点）当复核清单逐条回查：被它批倒且无反驳依据的 finding 重新验证；它无法推翻的才保留。**这是 30-40% 误报瓶颈的自动化解法**（替代"全靠人工读代码判断"）。

5. **Assign severity** to each confirmed (and deduplicated) finding:

| Severity | Criteria | MANDATORY ACTION |
|----------|----------|------------------|
| **Critical** | Remote + unauthenticated → secret access OR arbitrary code execution | **BLOCKER**: Must be confirmed by 2 independent methods. Do not proceed to next finding until a verified exploit path is documented. |
| **High** | Authenticated privilege escalation, injection with confirmed data impact | Must include reproduction steps. Single-method detection → downgrade to Medium. |
| **Medium** | Information disclosure, missing hardening, defense-in-depth gaps | Must note whether compensating controls exist within the codebase. |
| **Low** | Best-practice violations with minimal direct risk | Aggregate into one section. Do NOT spend more than 2 minutes verifying per finding. |

NON-NEGOTIABLE: If a finding cannot meet its severity tier's mandatory action, it MUST be downgraded to the next tier where the action is achievable.

5. **Assign a stable category-prefixed ID** to each finding using this table:

| Prefix | Category | Typical patterns |
|--------|----------|------------------|
| `SSRF` | SSRF / URL injection | Unsanitized URL in HTTP client, Playwright navigation |
| `PATH` | Path traversal | `../` in file paths, missing `is_relative_to` |
| `AUTH` | Missing/weak authentication | Unguarded endpoint, missing auth check |
| `CMD` | Command injection | `shell=True`, `os.system`, MATLAB -batch |
| `XSS` | Cross-site scripting | `innerHTML`, unsanitized HTML output |
| `SECRET` | Secrets/credentials leak | Hardcoded keys, tokens in logs/URL |
| `CRYPTO` | Weak cryptography | MD5/SHA1, `verify=False`, hardcoded keys |
| `DEP` | Dependencies / files / config | Unpinned deps, missing lockfile, temp files, file perms |
| `STATE` | Shared mutable state | Global state without isolation |

Number sequentially within each prefix: `SSRF-1`, `SSRF-2`, `PATH-1`, etc.

### Meta-Cognition Trap — watch for these internal signals

During Phase 2 verification, if you find yourself thinking any of the following, STOP. These are rationalization signals, not valid verification:

- **"This is probably fine in practice"** → That IS the signal to escalate, not dismiss. Probabilities are not verification. Trace the dataflow before closing.
- **"User input will never reach this code"** → Assumption-based dismissal is the #1 source of false negatives. Verify with a concrete code path, not intuition.
- **"The fix is obvious, no need to document it"** → Every finding MUST include concrete remediation code. No exceptions. An undocumented fix is not a fix.
- **"This is just how the framework works"** → Frameworks have CVEs too. Flag it; let the report reader decide.

These are NOT valid reasons to close a finding. When you catch yourself using them, reopen the finding for deeper review.

### Phase 3 — Report Compilation

Write the audit report to an agreed location. Use the exact report template in `references/audit-report-template.md` (report section).

**Status annotation format** (the `<!-- AUDIT:... -->` line after each finding title):

```
<!-- AUDIT:STATUS=<status> SEVERITY=<severity> FILE=<path> LINES=<start>-<end> [COMMIT=<hash>] -->
```

| Field | Required | Values |
|-------|----------|--------|
| `STATUS` | Yes | `open` → `fixed` → `deferred` → `not-fixed` → `partial` |
| `SEVERITY` | Yes | `critical` / `high` / `medium` / `low` |
| `FILE` | Yes | Relative path from repo root |
| `LINES` | Yes | Line range (e.g., `123-145`) |
| `COMMIT` | On fix | Hash of the commit that resolved this finding |

This annotation enables lightweight `mark-fixed` (just edit this line) and diff-based incremental re-audit (compare `FILE` + `LINES` against `git diff`).

### Phase 4 — Re-Audit (When Fixes Are Applied)

When the user says fixes are applied and wants verification, run an **incremental** re-audit:

1. **Parse status annotations** — scan the report for all `<!-- AUDIT:STATUS=... -->` lines. Extract `FILE`, `LINES`, and current `STATUS` for each finding.

2. **Diff-filter to changed files only**:
   ```bash
   git diff --name-only <audit-commit>..HEAD
   ```
   Compare against each finding's `FILE` field. Only findings whose files changed are candidates for re-verification.

3. **For each changed-file finding** — first validate that `FILE` resolves within the project root, then read the flagged location and check if the fix is applied:
   - **Fixed**: Vulnerability pattern removed or guard added → update `STATUS=fixed COMMIT=<hash>`
   - **Not Fixed**: Original vulnerable code still present → update `STATUS=not-fixed`
   - **Partially Fixed**: Some but not all addressed → update `STATUS=partial`
   - **Deferred**: Structural/architectural issue acknowledged → keep `STATUS=deferred`

4. **For unchanged-file findings** — skip read, keep current STATUS. Add `NOTE=unchanged` if desired.

5. **Check for regressions** — did the diff introduce any new vulnerability patterns? Quick scan of added lines for common patterns (shell=True, innerHTML, requests.get with user input, etc.).

6. **Update the report** — add a Re-Audit section at the top:

6. **Update the report** — add a Re-Audit section at the top using the template in `references/audit-report-template.md` (re-audit section).

**Also update the in-line annotations** — when a finding is verified as fixed, change its `<!-- AUDIT:STATUS=... -->` line from `STATUS=open` to `STATUS=fixed COMMIT=<hash>`.

## Vulnerable Patterns Reference

Grep patterns and remediation templates per category live in `references/vulnerability-patterns.md` — read it BEFORE Phase 2 (Pre-Flight requires it).

## Do NOT — Negative Heuristics

These actions are FORBIDDEN during an audit. They are the most common ways audits silently degrade:

- **Do NOT skip the Pre-Flight checks** even on a "quick scan." The gate is unconditional.
- **Do NOT accept an agent finding without reading the flagged code yourself.** Agents summarize; you verify.
- **Do NOT assign Critical or High severity from a single grep match.** Must be confirmed by a different method.
- **Do NOT suppress a finding because confidence is low.** That decision belongs to Phase 2, not Phase 1.
- **Do NOT close a finding because "it's probably fine."** See Meta-Cognition Trap.
- **Do NOT write the audit report before completing Phase 2 verification.** Phase 3 only after Phase 2.
- **Do NOT skip status annotations on findings.** Without `<!-- AUDIT:STATUS=... -->`, mark-fixed and incremental re-audit break.
- **Do NOT use sequential IDs (N1, N2...).** Use category-prefixed IDs (SSRF-1, PATH-1).

## Critical Reminders — read before every audit phase

These rules are NON-NEGOTIABLE and take precedence over all other considerations:

1. **Gate before code**: Pre-Flight checks are unconditional. Never touch a file before they complete.
2. **Verify before reporting**: Every finding passes the 5-point Self-Check. Fail any check → not a finding.
3. **Two methods for severity**: Critical/High cannot rest on a single grep hit. Independent confirmation or downgrade.
4. **Rationalization = escalation**: "probably fine" / "won't reach this code" / "obvious fix" → STOP and re-verify.
5. **Confidence is reported, not filtered**: Low-confidence findings enter Phase 2. Phase 2 decides, not Phase 1.
6. **Stable IDs always**: Category-prefixed, sequential within prefix. Never shift existing IDs in re-audits.

## After the Audit

- **Report location:** Place the report at `docs/SECURITY_AUDIT.md` by default. Add it to `.gitignore` so it stays local.
- **Follow-up:** Offer to fix the highest-priority findings (P1 items).
- **Pattern collection:** After the audit, review `references/vulnerability-patterns.md`. Add any new patterns you discovered. This is how the skill evolves.

## 自进化日志

每次审计实践吸收的模式记录于此，skill 随之进化：

| 日期 | 学习来源 | 吸收的模式 |
|------|---------|-----------|
| 2026-06-14 | v1.0 初始 | 4 阶段审计 + 17 类漏洞模式 + 3 并行 agent |
| 2026-06-18 | v1.1 | 状态注解 + 稳定前缀 ID + 增量重审 + Phase 2 去重 |
| 2026-06-19 | 3 轮真实审计反馈 | 并行失败→单 agent 兜底；误报 30-40%→confidence 标注；Edit 摩擦→脚本化；增量没真跑过；新代码自动发现；依赖变更检查 |
| 2026-06-21 | v1.3 | FABLE-5 风格重写：Pre-Flight Gate、Confidence、Self-Check、Meta-Cognition Trap |
| 2026-08-12 | 对齐科研骨架新范式 | 场景判定表（快速/全面/增量/单 PR 四路分流）；review.py 跨模型对抗验证进 Phase 2；security-audit-tools.py 脚本化状态追踪 |
| 2026-08-12 | demo-caregiver-training 首审 | 小代码库（1474 行）直读全量等效并行探索；**review.py 对抗实际抓出 3 个问题**（PROMPT-1 严重度低估→升 High、AUTH/STATE 威胁模型自相矛盾、SECRET-1 是噪音→移建议区）——跨模型对抗验证价值实证；威胁模型必须先声明（本地 vs 暴露）再定级 |

| 2026-08-24 | P0 瘦身 | 报告模板（report + re-audit）外移 references/audit-report-template.md；Quick Reference 压缩为指针、Common Mistakes 并入 Do NOT（SKILL.md 466→约 300 行） |
