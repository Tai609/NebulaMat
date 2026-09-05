# Incremental Execution — How an Audit Actually Gets Done

## Why this exists

A real paper audit has dozens of small judgement calls: every panel, every numeric claim, every causal step. Trying to "do it all in one shot" produces a shallow checklist that misses the actual issues. The only execution mode that works is **incremental, file-persisted, resumable**.

## The three invariants

### Invariant 1 — Filesystem is the source of truth

Every finding is written to its file the moment it is identified. Findings live under `$RUN/findings/{image,numerical,logical}/<short-id>.md`. The report assembles from finding files, not from short-term memory. If the agent crashes or the session ends, the files survive.

### Invariant 2 — Progress is observable on disk

```bash
cd output/integrity-auditor/<slug>/latest

ls findings/image/ | wc -l          # image findings count
ls findings/numerical/ | wc -l      # numerical findings count
ls findings/logical/ | wc -l        # logical findings count
wc -w audit_report.md               # report length (0 until step 3.4)
test -f input_manifest.md && echo "manifest written"
test -f paper.txt && wc -l paper.txt   # extracted text size
ls panels/ | wc -l                  # panels extracted
```

If any track is empty after a full pass, add a `_clean.md` file in that track listing what was checked and why nothing was flagged. Empty directories silently are not acceptable — explicit "checked, nothing found" is.

### Invariant 3 — Each batch is small enough to succeed, atomic enough to retry

Batch granularity for this skill:

| Operation | Batch size per turn | Total batches | Persistence |
|---|---|---|---|
| Material gathering | Manifest + extract | 1 turn | `input_manifest.md`, `paper.txt`, `panels/` |
| Image panels review | 4–8 panels per turn | 3–8 turns | One `findings/image/<id>.md` per anomaly |
| Numerical extraction | 1 section / table per turn | 3–6 turns | One `findings/numerical/<id>.md` per mismatch |
| Logical chain analysis | 1 headline claim per turn | 2–5 turns | One `findings/logical/<id>.md` per gap |
| Grading + report | Report drafted section by section | 4–6 turns | `audit_report.md` |

A turn that tries to assess every figure at once produces shallow, generic notes. A turn that tries every numeric claim drops half of them. One concrete batch per turn is the rhythm.

## Finding ID convention

Use `<track>-<location>-<keyword>.md`. Examples:

- `image/fig2A-fig5C-overlap.md`
- `numerical/table1-n-mismatch.md`
- `logical/section3.2-no-rescue.md`

Stable IDs let the report cite by relative path: `findings/image/fig2A-fig5C-overlap.md`.

## Recovery — when a session resumes mid-audit

```bash
cd output/integrity-auditor/<slug>/latest

# Manifest done?
test -s input_manifest.md && echo "manifest OK"

# Extraction done?
test -s paper.txt && echo "text OK"
ls panels/ 2>/dev/null | wc -l

# Track progress
for t in image numerical logical; do
  echo "$t: $(ls findings/$t/ 2>/dev/null | wc -l) files"
done

# Report drafted?
test -s audit_report.md && wc -w audit_report.md
```

Resume the sub-step that is incomplete. Never redo work already on disk.

## Checkpoint files

Maintain four small bookkeeping files in the run dir:

- `.image_progress.txt` — one line per panel batch reviewed
- `.numerical_progress.txt` — one line per section / table audited
- `.logical_progress.txt` — one line per claim compressed and tested
- `.report_progress.txt` — one line per report section drafted

```bash
echo "panels p001-p008 reviewed" >> .image_progress.txt
echo "table-1 reconciled vs results.json summary.mlp" >> .numerical_progress.txt
echo "claim: A=hierarchy B=adapter C=robustness — checked rescue" >> .logical_progress.txt
echo "section: findings-summary drafted" >> .report_progress.txt
```

## Sanity check before delivery

```bash
test -s input_manifest.md
test -s paper.txt
ls panels/ | head -1 > /dev/null     # at least one panel extracted
for t in image numerical logical; do
  [ "$(ls findings/$t/ 2>/dev/null | wc -l)" -ge 1 ] || \
    echo "ERROR: track $t has no findings AND no _clean.md"
done
test -s audit_report.md
```

## Quick checklist

- [ ] Manifest written before any track starts
- [ ] Text + panels extracted before image / numerical tracks
- [ ] Image track produces per-panel-batch progress lines
- [ ] Numerical track persists per-section progress lines
- [ ] Logical track compresses each headline claim and persists outcome
- [ ] Empty tracks documented via `_clean.md`, not left empty
- [ ] Report drafted section by section, not in one turn
- [ ] Four checkpoint files maintained
- [ ] No work redone after resume
