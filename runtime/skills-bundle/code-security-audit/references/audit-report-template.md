# Code Security Audit — Report Templates

> 被 `SKILL.md`（code-security-audit）引用。Phase 3 用「审计报告模板」；增量重审（Phase 4）用「Re-Audit 段模板」。按需取用，不必整段背下来。

## 审计报告模板（Phase 3 使用）

```
# [Project Name] Security Audit Report

**Date:** [date]
**Audit commit:** [git rev-parse HEAD]
**Scope:** [what was reviewed]
**Methodology:** Three parallel reviews covering (1) secrets & credentials,
  (2) input validation & injection, (3) authentication, cryptography & dependencies

## Executive Summary
One paragraph: total findings by severity, most critical issues, overall risk posture.

## Risk Distribution
Table: | Severity | Count | Finding IDs |

## Critical Findings
One subsection per finding:

### SSRF-1 — [title]
<!-- AUDIT:STATUS=open SEVERITY=critical FILE=path/to/file.py LINES=123-145 -->

- **Finding:** title
- **Severity:** Critical
- **File:** path (line numbers)
- **Description:** what and why it matters
- **Vulnerable code:** fenced code block
- **Remediation:** concrete fix with corrected code

## High Findings
[Same format with category-prefixed IDs]

## Medium Findings
[Same format with category-prefixed IDs]

## Low Findings
[Same format with category-prefixed IDs]

## Cross-Cutting Recommendations
Themes spanning multiple findings.

## Remediation Priority Matrix
Table: | ID | Finding | Effort | Impact | Priority (P1-P4) |

## Appendix
Commit hash, verification guidance per finding.
```

## Re-Audit 段模板（Phase 4 使用，加在报告顶部）

```
## Re-Audit ([date])

**Diff range:** <audit-commit>..<current-commit>
**Files changed:** N

### Status Summary
Table: | Status | Count |
       | fixed | N |
       | not-fixed | N |
       | partial | N |
       | deferred | N |
       | unchanged | N |

### Fixed (N of total)
Table: | ID | Finding | Fix Verified At |

### Not Fixed (N of total)
Table: | ID | Finding | Status/reason |

### Partially Fixed (N of total)
Table: | ID | Finding | What's done vs. remaining |

### New Findings
Any issues introduced by the fixes.

### Verdict
One paragraph summary.
```