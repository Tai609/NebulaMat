# Quality Gate — Self-Check Before Delivery

## Why this exists

Even a thorough first pass produces a paper with one or two issues — citations that don't resolve, a figure that's too small, a table caption that's a fragment. This reference is the checklist you run **after** drafting and recompiling, **before** telling the user "it's done". If any item fails, return to the relevant reference and fix.

The gate is bright-line. Do not soften the targets to ship.

## Hard gates (must pass)

### G1 · PDF compiles cleanly

```bash
cd output/paper-writer/<slug>/latest/paper
rm -f main.aux main.bbl main.blg main.out main.toc main.lof main.lot
pdflatex -interaction=nonstopmode main.tex >/dev/null 2>&1
bibtex main >/dev/null 2>&1
pdflatex -interaction=nonstopmode main.tex >/dev/null 2>&1
pdflatex -interaction=nonstopmode main.tex >/dev/null 2>&1

# Must have output and be non-trivial
test -s main.pdf || echo "FAIL: main.pdf missing or empty"

# Zero undefined citations
grep -c "Citation .* undefined" main.log    # must be 0

# Zero undefined references (\ref resolution)
grep -c "Reference .* undefined" main.log   # must be 0

# Overfull boxes = content crossing the margin. List the worst, then drive to 0.
grep "Overfull \\\\hbox" main.log | grep -oE '\([0-9.]+pt too wide\)' | sort -t'(' -k2 -rn | head
grep -c "Overfull \\\\hbox" main.log        # target 0 (a stray ≤2pt microtype box is fine)
```

If any of these fail, fix the underlying issue, recompile, recheck. Overfull is a **remediation loop, not a tolerated warning** (unattended runs have no human to spot the spill): a figure/table overrun means it wasn't wrapped per `02`/`04` — wrap TikZ in `\resizebox{\linewidth}{!}{…}`, add `width=\linewidth` to includes, shrink/`tabularx` the table; a long unbreakable token needs `\sloppy`/`\url{}`/a manual break. Recompile until the count is 0.

### G1.2 · Citation and counter order

The template must keep `\bibliographystyle{unsrtnat}`. This numbers references
from `[1]` in order of first citation; the physical order of entries in
`bibliography.bib` is irrelevant. Never write citation numbers or object
numbers into prose/captions, and never reset counters to make the output look
right.

After the clean build above, verify that the generated bibliography follows
the citation order recorded by LaTeX:

```bash
python3 - <<'PY'
from pathlib import Path
import re

first_cited = []
seen_keys = set()
seen_aux = set()

def walk_aux(path):
    path = Path(path)
    if path in seen_aux or not path.is_file():
        return
    seen_aux.add(path)
    for line in path.read_text(errors="replace").splitlines():
        for group in re.findall(r"\\citation\{([^}]*)\}", line):
            for key in (part.strip() for part in group.split(",")):
                if key == "*":
                    raise SystemExit("FAIL: \\nocite{*} defeats first-citation numbering")
                if key and key not in seen_keys:
                    seen_keys.add(key)
                    first_cited.append(key)
        for child in re.findall(r"\\@input\{([^}]+\.aux)\}", line):
            walk_aux(path.parent / child)

walk_aux("main.aux")
bbl = Path("main.bbl").read_text(errors="replace")
bibitems = re.findall(r"\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}", bbl)
if not first_cited or bibitems != first_cited:
    raise SystemExit(
        "FAIL: bibliography is not numbered by first citation\n"
        f"first citations: {first_cited[:10]}\n"
        f"bibitems:        {bibitems[:10]}"
    )
print(f"OK: {len(bibitems)} references numbered from 1 by first citation")
PY

grep -REn '\\(setcounter|addtocounter)\{(figure|table|equation|section|algorithm|enumiv)\}|\\tag\{[0-9]+\}|\\caption\{.*(Figure|Table|Fig\.|Tab\.)[[:space:]]*[0-9]+' \
  main.tex sections/ 2>/dev/null
# must be empty
```

Figure, table, equation, section, and algorithm numbers are separate LaTeX
sequences. Each starts at 1 and advances in source order; it is correct for
Figure 1 and Table 1 to coexist.

### G1.5 · Final-size visual integrity

A successful compile does not prove that a figure or table is readable. Rasterize
the final paper, not the standalone source files:

```bash
check_dir=$(mktemp -d)
pdftoppm -r 200 -png main.pdf "$check_dir/page"
```

Inspect every page containing a figure or table. This gate fails if:

- figure text is below 7 pt at final size, or labels, ticks, legends,
  annotations, panel letters, watermarks, or data marks overlap or are clipped;
- a table crosses a margin, clips content, or uses body text below 8 pt;
- a data series, row, panel, or heatmap annotation expected from the source is
  missing;
- a final paper figure is Mermaid, PlantUML, a generic flowchart/mind-map,
  diagram-editor screenshot, or notebook/UI screenshot.
- a figure or table appears before its first discussion, far after the argument
  it supports, in a contradictory order, or in an unexplained end-of-section
  cluster.

Regenerate the artifact and repeat this gate. `tight_layout`,
`constrained_layout`, `bbox_inches="tight"`, and zero overfull boxes are useful
signals, not substitutes for inspecting the final page.

### G2 · Bibliography size

```bash
grep -c "^@" bibliography.bib    # must be ≥ 200
```

If under 200, return to `01-bibliography-expansion.md` and run more WebSearch queries.

No `unknown` keys in the bib:

```bash
grep -E "^@.+\{unknown" bibliography.bib   # must be empty
```

### G2.5 · No orphan bib entries

A bib that contains entries never `\cite{}`-d in the prose is **padding**.
Common failure mode is reaching G2's count by appending famous papers from
adjacent fields (LLM, vision, foundational deep learning, …) that the
paper never uses. This gate detects orphans; **detection is not
termination — it triggers remediation**.

```bash
# every key in bibliography.bib must appear in at least one \cite, \citep,
# \citet, etc. in main.tex or sections/*.tex
bib_keys=$(grep -oE '^@[a-z]+\{[^,]+,' bibliography.bib \
           | sed -E 's/^@[a-z]+\{//; s/,$//' | sort -u)
cite_keys=$(grep -hoE '\\cite[a-z]*\{[^}]+\}' main.tex sections/*.tex 2>/dev/null \
            | grep -oE '\{[^}]+\}' | tr ',' '\n' | tr -d '{} \n' \
            | sort -u | sed '/^$/d')
orphans=$(comm -23 <(echo "$bib_keys") <(echo "$cite_keys"))
orphan_count=$(echo "$orphans" | grep -c .)
echo "orphan bib entries: $orphan_count (must be 0)"
test "$orphan_count" -eq 0 || {
  echo "ACTION REQUIRED · $orphan_count orphans (first 10):"
  echo "$orphans" | head -10
}
```

**This is a remediation trigger, not a task-failure signal.** If
`orphan_count > 0`, DO NOT exit the step or report failure. Loop on
remediation until orphans reach 0, in this priority order:

1. **Cite them in prose** (preferred). Most orphans are real on-topic
   papers you researched but skipped writing about. Extend Related Work
   and Methods to discuss each. Use `03-section-playbook.md` for
   citation-density targets per section. Re-run the gate.
2. **Prune + lower scope.** If after honest effort you cannot extend the
   prose to cover the orphans, re-classify as a workshop paper (≥ 60
   cites; see G3 note) and prune the bib to entries you actually cite.
   Update the abstract to match. Re-run the gate.
3. **Prune + honest shortfall report.** If even the workshop target
   cannot be honestly reached, prune to the cited entries and add a
   sentence to the abstract / introduction noting the literature scope.
   Then re-run the gate. Never quietly pad with famous but off-topic
   papers — a smaller honest bib is acceptable output.

Only after `orphan_count == 0` may you proceed past this gate.

### G2.6 · Temporal coverage matches field velocity

Run the deterministic checker copied with the paper template. Select the same
profile recorded in `.bib_progress.txt`:

```bash
# AI4S / ML / LLM default: in 2026, at least 60% must be from 2024–2026.
python3 check_bibliography_freshness.py bibliography.bib \
  --profile fast-moving

# A paper explicitly about work from 2026: at least 70% from that window.
python3 check_bibliography_freshness.py bibliography.bib \
  --profile recency-led --start-year 2026 --end-year 2026
```

Other valid profiles are `balanced` (at least 40% in the current three calendar
years) and `timeline-spanning` (no ratio). The script derives the current year
at runtime, rejects missing/future years, prints a histogram, and after March
requires at least 5% current-year references for fast-moving/recency-led work.

This gate measures coverage; it does not authorize excluding seminal or
directly relevant older work. If it fails, search recent proceedings,
date-sorted feeds, and current journal issues by each topic angle. If a
slow-moving field genuinely cannot meet the selected profile, change to
`balanced` or `timeline-spanning` only with a written reason in
`.bib_progress.txt`.

### G3 · Page count

```bash
pdfinfo main.pdf | grep Pages    # must be ≥ 8 for a research paper
```

For survey-length: ≥ 12. For workshop-length: ≥ 4 (relax G2 to 60 in this case; document the exception).

### G4 · Cite count across sections

```bash
total=0
for f in sections/*.tex; do
  c=$(grep -o "\\\\cite{" "$f" | wc -l)
  total=$((total + c))
done
echo "TOTAL \\cite{}: $total"     # must be ≥ 60
```

Distribution check (`grep -o` per section file): no section should have zero citations except possibly Method (which can be 4–8). Aim:

| Section | Min `\cite{` count |
|---|---|
| abstract | 0 (default; follow the target venue if it requires otherwise) |
| introduction | 12 |
| related_work | 30 |
| method | 4 |
| experiment | 5 |
| results | 5 |
| conclusion | 4 |

### G5 · Evidence coverage and placement

```bash
grep -rh "begin{figure" sections/ | wc -l
grep -rh "begin{table" sections/ | wc -l
```

Use the justified 4–8 figure target from `02`; never add an artifact only to
clear a section quota. A paper making quantitative claims must show the
supporting comparison in at least one figure or table. Place each artifact
immediately after the paragraph that first introduces or interprets it:
mechanism evidence may belong in Method, setup summaries in Experiment,
comparisons in Results, and context figures elsewhere. Check the rendered
order, not merely the section counts.

### G6 · Numbered equations in Method

```bash
grep -c "begin{equation" sections/method.tex    # must be ≥ 2
```

### G7 · Disclosure footnote present and correct

The `\author{}` block in `main.tex` must carry a `\thanks` footnote with:
- **Always:** "Human review by a domain expert is strongly recommended" (or equivalent wording)
- **When results are simulated:** also explicitly flags the numerical results as simulated

```bash
grep -E "Human review|human review" main.tex      # must match (always-on clause)
```

If `experiment-suite` was run in simulation mode (its `results.json` has `"simulated": true`), additionally:

```bash
grep -i "simulated" main.tex                      # must match
grep -i "simulated" sections/abstract.tex sections/experiment.tex   # must appear in ≥ 1
```

The simulated marker should appear in at least two surfaces (title `\thanks` plus prose) so readers cannot miss it.

If results are real (user supplied data): the simulated clause must be **absent** from the `\thanks` footnote — drop it once real numbers are wired in. The human-review clause stays.

### G8 · Cross-reference integrity

```bash
grep -oE '\\label\{[^}]+\}' sections/*.tex | sed 's/.*\\label{//;s/}.*//' | sort -u > /tmp/labels
grep -oE '\\ref\{[^}]+\}'   sections/*.tex | sed 's/.*\\ref{//;s/}.*//'    | sort -u > /tmp/refs
diff <(comm -23 /tmp/labels /tmp/refs) <(echo)    # labels with no ref → bad
diff <(comm -13 /tmp/labels /tmp/refs) <(echo)    # refs with no label → bad
```

Tolerance: every figure/table/equation `\label{}` must be `\ref{}`-ed at least once. Sections labeled `sec:*` may not all be referenced — that's okay if they're at least mentioned by name.

## Soft gates (should pass)

### S1 · Notation consistency

Skim all sections looking for the same concept under different symbols. E.g., $L$ vs. $T$ for sequence length, $H$ vs. $\tau$ for horizon. Pick one and globally replace.

### S2 · Caption quality

Read each caption alone (cover the figure/table). Does it convey what's shown? If not, lengthen.

### S3 · Anti-pattern sweep

```bash
# First-person mistakes
grep -E "the authors|This paper presents" sections/*.tex   # should be empty

# Vacuous transitions
grep -E "In recent years|It is well known" sections/*.tex   # should be empty

# Citation dumps (≥ 6 keys in one \cite{})
grep -oE '\\cite\{[^}]+\}' sections/*.tex | awk -F, '{print NF}' | sort -nr | head -3
# top number should be ≤ 5
```

### S4 · Honest limitations

Open `sections/conclusion.tex` and verify a limitations paragraph exists. A conclusion without limitations is weaker than one with them.

## Final report format

When all gates pass, deliver to the user:

```
Paper ready: output/paper-writer/<slug>/latest/paper/main.pdf

Stats:
  Pages:        12
  Bibliography: 247 entries
  Freshness:    fast-moving; 158/247 (64.0%) from 2024–2026
  \cite{} total: 142 across 7 sections
  Figures:      5 (1 architecture, 3 quantitative, 1 heatmap)
  Tables:       3 (main comparison, ablation, dataset stats)
  Simulated:    yes — marker visible in title \thanks and abstract
  Compile:      0 undefined citations, 0 undefined refs, 1 overfull (line 245, minor)

Quality gate: PASSED (G1–G8 hard incl. G1.5 final-size visual integrity, S1–S4 soft).
```

If you can't pass G1–G4 without compromising honesty, **say so explicitly** instead of shipping a weaker paper:

> "Bibliography stalled at 156 entries — could not find more high-quality citations on this niche topic via WebSearch. Page count 9. The paper is delivery-quality at this scope; raising to 200 cites would require padding with low-relevance entries that hurt readability."

That's a legitimate stop. Fabricating entries to clear the gate is not.

## Quick checklist

- [ ] G1 compile clean (0 undefined citations / refs)
- [ ] G1.2 citations begin at 1 and follow first citation; all object numbering is automatic with no counter resets or numbers inside captions
- [ ] G1.5 final paper rasterized; figure text ≥ 7 pt, table text ≥ 8 pt, no overlap/clipping/margin overflow, no generic diagram-tool output
- [ ] G2 bibliography ≥ 200 real entries; no `unknown` keys
- [ ] G2.6 temporal profile recorded and `check_bibliography_freshness.py` passes
- [ ] G3 PDF ≥ 8 pages
- [ ] G4 total `\cite{}` ≥ 60 across all sections; per-section minimums hit
- [ ] G5 artifacts are justified, follow first-discussion order, and are placed near the prose they support; no fixed section quota
- [ ] G6 method.tex has ≥ 2 numbered equations
- [ ] G7 disclosure footnote: human-review clause always present; simulated clause present iff results are simulated
- [ ] G8 every figure/table/equation label is referenced
- [ ] S1–S4 soft gates reviewed
- [ ] Honest report to user — don't pad to clear gates
