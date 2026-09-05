# Integrity-Auditor Quality Gate — Self-Check Before Delivery

## Why this exists

This checklist runs **after** the three tracks and the report have been assembled, **before** declaring the audit complete. If any gate fails, return to the relevant reference.

The gate is bright-line. Do not soften the targets to ship.

## Hard gates (must pass)

### G1 · Input manifest written

```bash
test -s input_manifest.md
```

Must list: paper PDF path, supplements considered, source-data tables considered, slug-linked artefacts considered (if any), tools available (poppler-utils version, `forensics_tools/` scripts).

### G2 · Materials extracted

```bash
test -s paper.txt
[ "$(ls panels/ 2>/dev/null | wc -l)" -ge 1 ]
```

Text extraction must have run, panels must have been pulled. If the PDF has no embedded images, record that fact in the manifest.

### G3 · Each track produced output

```bash
for t in image numerical logical; do
  [ "$(ls findings/$t/ 2>/dev/null | wc -l)" -ge 1 ] || \
    { echo "ERROR: track $t empty"; exit 1; }
done
```

Each track has at least one file. If there were genuinely no findings, a `_clean.md` (track was applicable, swept, found nothing) or `_inapplicable.md` (track tools do not apply to this paper class — e.g., biology image-forensics on a pure-ML schematic-figure paper) must exist. An empty directory fails the gate. A `_clean.md` placeholder for a track that wasn't actually run also fails the gate — use `_inapplicable.md` honestly instead. See `SKILL.md` "Important rules" for the semantic distinction.

### G4 · Every finding follows the reviewable format

```bash
for f in findings/*/*.md; do
  # Findings (not _clean.md) must have all required fields.
  basename "$f" | grep -qE "^_(clean|inapplicable)\.md$" && continue
  grep -q "^- Paper:" "$f" || { echo "missing Paper: $f"; exit 1; }
  grep -q "^- " "$f" | head -1 > /dev/null  # sanity
  grep -qiE "^## (What was observed|Gap observed)" "$f" || { echo "missing observation: $f"; exit 1; }
  grep -qiE "^## (Requested raw data|Recomputation|What additional evidence)" "$f" || \
    { echo "missing remediation: $f"; exit 1; }
  grep -qE "^## Level " "$f" || { echo "missing level: $f"; exit 1; }
done
```

Every finding has paper id, observation, remediation pointer, and a level. Missing any field fails the gate.

### G5 · Report assembled from findings

```bash
test -s audit_report.md && [ $(wc -w < audit_report.md) -ge 600 ]
grep -E "^## " audit_report.md | head
```

Must contain the sections from `templates/audit_report.md`: input summary, methodology summary, findings by track, severity headline, requested raw data, recommended next steps, limitations.

### G6 · Every report citation resolves

```bash
for f in $(grep -oE "findings/[a-z]+/[a-zA-Z0-9._-]+\.md" audit_report.md | sort -u); do
  test -f "$f" || { echo "broken citation: $f"; exit 1; }
done
```

Findings cited by the report exist on disk. No phantom citations.

### G7 · Severity headline matches max finding level

```bash
# Max level across all findings (each finding states "**Level N**" in its grading section,
# skipping _clean.md / _claims.md which are not graded findings):
MAX_LEVEL=$(grep -hoE "\*\*Level [1-4]\*\*" findings/*/*.md 2>/dev/null | \
  grep -oE "Level [1-4]" | sort -u | tail -1)
# Headline in report:
HEADLINE=$(grep -E "Severity headline:" audit_report.md | grep -oE "Level [1-4]" | head -1)
[ "$MAX_LEVEL" = "$HEADLINE" ] || { echo "headline mismatch: $MAX_LEVEL vs $HEADLINE"; exit 1; }
```

The report's headline severity equals the maximum level among findings. No averaging, no vote counting.

### G8 · No verdicts

```bash
grep -iE "fraudulent|fabricated|intentional|misconduct (was|is) committed" audit_report.md findings/*/*.md | head
```

The output of this grep should be empty (matches inside narrowly-quoted reference material, like Level 4 description text in the report, are allowed if they describe what "consistent with manipulation" means; outright verdicts are not).

### G9 · Slug audits cross-checked

If the input was a slug:

```bash
# For a local paper-writer slug audit:
test -s "../../../output/experiment-suite/$SLUG/latest/results.json" && \
  grep -q "results.json" input_manifest.md
test -s "../../../output/experiment-suite/$SLUG/latest/data_contract.md" && \
  grep -q "data_contract.md" input_manifest.md
test -s "../../../output/paper-writer/$SLUG/latest/paper/bibliography.bib" && \
  grep -q "bibliography.bib" input_manifest.md
```

The manifest must show that the paper-writer-side artefacts were consulted. A slug audit that ignored `results.json` cannot claim to have done numerical cross-check.

## Soft gates (should pass)

### S1 · Findings clustered for reproducibility issues

Multiple missing antibody catalogue numbers or hyperparameters should be a single cluster finding, not N separate ones.

### S2 · Each Level 3 / Level 4 finding names specific raw data

```bash
for f in findings/*/*.md; do
  basename "$f" | grep -qE "^_(clean|inapplicable)\.md$" && continue
  level=$(grep -oE "^## Level [1-4]" "$f" | grep -oE "[1-4]")
  if [ "$level" -ge 3 ] 2>/dev/null; then
    grep -qE "^- |^[0-9]+\. " "$f" || echo "WARN: $f at level $level lacks explicit raw-data list"
  fi
done
```

### S3 · Image findings include transformation parameters

If an image finding describes a dup after transformation, the transformation parameters (flip axis, rotation degrees, crop box) should be named.

### S4 · Numerical findings include recomputation arithmetic

For every numerical finding, the actual formula and inputs are recorded, not just a "doesn't match" claim.

### S5 · Honest scope statement

`audit_report.md` should explicitly list what was **not** audited (e.g., "source data unavailable; recomputation limited to internal consistency", "no access to authors' archived raw blots"). The auditor's confidence in absence-of-finding is bounded by what was inspectable.

## Final report format

When all gates pass:

```
Integrity audit ready: output/integrity-auditor/<slug>/latest/

Stats:
  Input mode:    slug | doi | pdf
  Paper:         <title or DOI>
  Manifest:      <N> artefacts consulted
  Panels:        <N> extracted
  Findings:      image=<N> numerical=<N> logical=<N>
  Severity:      Level X (max across findings)
  Clean tracks:  <list, if any track produced _clean.md>
  Raw data requested: <count of Level ≥ 2 findings with explicit requests>

Quality gate: PASSED (G1–G9 hard, S1–S5 soft).
```

If any hard gate cannot honestly be cleared:

> "Numerical track has zero findings and no `_clean.md` because the source data tables were not available and the paper's headline numbers could not be cross-checked. Recording this in the manifest and audit report rather than fabricating a `_clean.md`."

That is a legitimate deviation. Fabricating a `_clean.md` to pass G3 is not.

## Quick checklist

- [ ] G1 input_manifest.md written
- [ ] G2 paper.txt + panels/ extracted
- [ ] G3 every track has ≥ 1 file (finding or _clean.md or _inapplicable.md)
- [ ] G4 every finding has Paper / observation / remediation / Level
- [ ] G5 audit_report.md ≥ 600 words, all template sections
- [ ] G6 every cited finding file exists
- [ ] G7 headline severity = max finding level
- [ ] G8 no verdict language
- [ ] G9 (slug only) paper-writer-side artefacts shown in manifest
- [ ] S1–S5 soft gates reviewed
- [ ] Honest scope statement — what was not audited is named
