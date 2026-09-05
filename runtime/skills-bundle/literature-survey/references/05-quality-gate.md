# Survey Quality Gate — Self-Check Before Delivery

## Why this exists

Even a thorough first pass produces a survey with one or two issues — citations that don't resolve, a figure that's too small, a section caption that's a fragment. This checklist runs **after** drafting and recompiling, **before** telling the user "it's done". If any item fails, return to the relevant reference.

The gate is bright-line. Do not soften the targets to ship.

## Hard gates (must pass)

### G1 · PDF compiles cleanly

```bash
cd output/literature-survey/<slug>/survey_paper
rm -f main.aux main.bbl main.blg main.out main.toc main.lof main.lot
pdflatex -interaction=nonstopmode main.tex >/dev/null 2>&1
bibtex main >/dev/null 2>&1
pdflatex -interaction=nonstopmode main.tex >/dev/null 2>&1
pdflatex -interaction=nonstopmode main.tex >/dev/null 2>&1

test -s main.pdf || echo "FAIL: main.pdf missing or empty"
echo "undefined cites: $(grep -c 'Citation .* undefined' main.log) (must be 0)"
echo "undefined refs:  $(grep -c 'Reference .* undefined' main.log) (must be 0)"

# Overfull boxes = content spilling past the margin (the "elements run off the
# page / overlap" complaint). List the worst offenders with how far they overrun:
grep 'Overfull \\hbox' main.log | grep -oE '\([0-9.]+pt too wide\)' | sort -t'(' -k2 -rn | head
echo "overfull boxes:  $(grep -c 'Overfull \\hbox' main.log) (target 0)"
```

**Overfull is a remediation trigger, not a tolerated warning** (unattended runs have no human to eyeball the PDF). Any overfull box > ~2pt means something visibly crosses the margin — fix it, don't ship it:

- **Figure/table overrun** → it isn't wrapped per `02`/`04`. Wrap TikZ in `\resizebox{\linewidth}{!}{…}`; add `width=\linewidth` to the include; shrink/`tabularx` the table. This alone clears almost all overfull boxes.
- **A long unbreakable token** (URL, code, long math) → `\sloppy`, `\url{}`, or manual break.
- Recompile and re-grep until the count is 0 (a stray ≤ 1–2pt box from microtype is acceptable; anything larger is not).

### G1.2 · Citation and counter order

The template must keep `\bibliographystyle{unsrtnat}`. This numbers references
from `[1]` in order of first citation; the physical order of entries in
`bibliography.bib` is irrelevant. Never write citation numbers or object
numbers into prose/captions, and never reset counters to manufacture an order.

After the clean build above, verify the generated bibliography:

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

Figure, table, equation, and section numbers are independent LaTeX sequences.
Each starts at 1 and advances in source order.

### G1.5 · Final-size visual integrity

A successful compile does not prove that a figure or table is readable. Rasterize
the final survey, not only standalone source figures:

```bash
check_dir=$(mktemp -d)
pdftoppm -r 200 -png main.pdf "$check_dir/page"
```

Inspect every page containing a figure or table. This gate fails if:

- figure text is below 7 pt at final size, or labels, ticks, legends,
  annotations, panel letters, or data marks overlap or are clipped;
- a table crosses a margin, clips content, or uses body text below 8 pt;
- expected data, labels, or heatmap annotations are missing;
- a final figure is Mermaid, PlantUML, a generic flowchart/mind-map,
  diagram-editor screenshot, or notebook/UI screenshot.
- a figure or table appears before its first discussion, far after the argument
  it supports, in a contradictory order, or in an unexplained end-of-section
  cluster.

Regenerate the artifact and repeat this gate. Zero overfull boxes and automatic
layout calls are not substitutes for inspecting the final page.

### G2 · Bibliography size

```bash
grep -c "^@" bibliography.bib    # must be ≥ 60 (100+ recommended)
```

No fabricated entries:

```bash
# Every entry should have a url= field that the agent fetched in this session
grep -c "url = {" bibliography.bib   # should be close to total entry count
```

If many entries lack `url=`, you may have leaked memory-sourced entries; audit them.

### G2.5 · No orphan bib entries

A bib that contains entries never `\cite{}`-d in the prose is **padding**.
The common failure mode is reaching G2's count by appending famous papers
from adjacent fields (LLM, vision, foundational deep learning, …) that
the survey never uses. This gate detects orphans; **detection is not
termination — it triggers remediation**.

```bash
# every key listed in bibliography.bib must appear in at least one \cite,
# \citep, \citet, etc. in main.tex or sections/*.tex
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
   papers you researched but skipped writing about. Go back to
   `03-survey-section-playbook.md` and add each to the appropriate
   section with a one-to-three-sentence treatment. A survey *is* the
   argument that every cited paper deserves citation. Re-run the gate.
2. **Prune + lower scope.** If after honest effort you cannot extend prose
   to cover the orphans, lower the target toward the 60 floor (100+ recommended)
   and prune the bib to entries you actually cite. Update the abstract
   to reflect the narrower scope. Re-run the gate.
3. **Prune + honest shortfall report.** If even the focused target
   cannot be honestly reached, prune to the cited entries and add a
   note to the introduction / abstract: "Scope limited to N entries
   due to limited on-topic literature; expanded coverage left to
   future work." Then re-run the gate. Never quietly pad — but a
   smaller, honest bib is acceptable output.

Only after `orphan_count == 0` may you proceed past this gate.

### G2.6 · Temporal coverage matches the stated intent

Run the deterministic checker copied with the survey template. Select the same
profile recorded in `.bib_progress.txt`:

```bash
# AI4S / ML / LLM default: in 2026, at least 60% must be from 2024–2026.
python3 check_bibliography_freshness.py bibliography.bib \
  --profile fast-moving

# A survey explicitly limited to 2026: at least 70% from that window.
python3 check_bibliography_freshness.py bibliography.bib \
  --profile recency-led --start-year 2026 --end-year 2026
```

Other valid profiles are:

- **Balanced:** at least 40% in the current three calendar years.
- **Timeline-spanning:** no ratio; cover the canon through the newest relevant
  work.

The script derives the year at runtime, rejects missing/future years, prints a
histogram, and after March requires at least 5% current-year references for
fast-moving/recency-led work.

This is a coverage gate, not an arbitrary date exclusion. Preserve seminal and
directly relevant older work. If the selected profile fails, search recent
proceedings, date-sorted feeds, and current journal issues by every topic angle.
Change to a slower profile only when the field warrants it and record the reason.

### G3 · Page count

```bash
pdfinfo main.pdf | grep Pages    # must be ≥ 6 (8+ recommended)
```

A survey under 5 pages is a digest, not a survey. Re-scope or expand.

### G4 · Cite count across sections

```bash
total=0
for f in sections/*.tex; do
  c=$(grep -o "\\\\cite{" "$f" | wc -l)
  total=$((total + c))
done
echo "TOTAL \\cite{} markers: $total"   # must be ≥ 60
```

Per-section minimums:

| Section | Min `\cite{` count |
|---|---|
| abstract | 0 (default; follow the target venue if it requires otherwise) |
| introduction | 10 |
| background | 6 |
| methods | 25 |
| discussion | 6 |
| conclusion | 3 |
| related_work | 5 |

Methods carries most of the load — that is correct for a survey.

### G5 · Topic-specific figures present

```bash
grep -rh "begin{figure" sections/ | wc -l    # target 6–10; never pad
```

Each figure must expose evidence, structure, or mechanism specific to the topic.
Taxonomy, timeline, coverage matrix, architecture, trend, and citation-network
figures are optional families, not required slots. If fewer than six justified
figures exist, report the shortfall rather than manufacturing filler.

### G5.5 · Publication-native sources; no template leakage

The figures must be designed for this survey, not copied from the playbook's worked examples (a real run once shipped time-series leaves — `Informer`, `PatchTST` — inside an LLM survey).

```bash
# Generic diagram DSLs/editors must not supply final paper figures:
grep -rEi '```mermaid|@startuml|plantuml|\.mmd|\.puml|\.drawio' \
  sections/ figures/ *.tex 2>/dev/null   # expect empty
# Sample/example tokens that must NOT appear unless the topic genuinely is time-series:
grep -rIE "Informer|Autoformer|FEDformer|PatchTST|iTransformer|Moirai|TimeGPT|Time-Series Forecasting" \
  sections/ figures/ *.tex 2>/dev/null | grep -v "%"   # expect empty for non-TS topics
# Figures should be sans-serif (Nature), not the default serif:
grep -rn 'font.family.*serif' figures/*.py 2>/dev/null   # expect empty (use the sans Nature preamble)
# Taxonomies must be forest-based (auto-spaced), not hand-tuned overlapping trees:
grep -rn 'sibling distance' sections/*.tex 2>/dev/null    # expect empty
```

If any fires: redraw the offending figure for *this* topic with the Nature language in `02` (sans-serif, Wong palette, despined, panel labels, finding-first caption). This is a remediation trigger — fix and re-run, don't ship a leaked or generic-looking figure.

### G6 · Comparison table present

```bash
grep -rh "begin{table" sections/ | wc -l    # must be ≥ 1
```

A survey should have at least one method-comparison table. Use the single-column
table rules in `04-layout-discipline.md`; do not use `table*` as a width fix.

### G7 · Disclosure footnote correct

The `\author{}` block in `main.tex` carries a `\thanks` footnote with the always-on human-review clause:

```bash
grep -E "Human review|human review" main.tex      # must match
```

Surveys do **not** include the simulated clause:

```bash
grep -i "simulated" main.tex sections/abstract.tex   # should be empty
```

If your survey somehow ended up with the simulated clause, remove it — surveys don't carry numerical experiments to simulate.

### G8 · Cross-reference integrity

```bash
grep -ohE '\\label\{[^}]+\}' sections/*.tex | sed 's/.*\\label{//;s/}.*//' | sort -u > /tmp/labels
grep -ohE '\\ref\{[^}]+\}'   sections/*.tex | sed 's/.*\\ref{//;s/}.*//'    | sort -u > /tmp/refs
diff <(comm -23 /tmp/labels /tmp/refs) <(echo)    # labels with no ref → bad
diff <(comm -13 /tmp/labels /tmp/refs) <(echo)    # refs with no label → bad
```

## Soft gates (should pass)

### S1 · Notation consistency

Skim all sections for the same concept under different symbols. Pick one and globally replace.

### S2 · Caption quality

Read each caption alone (cover the figure/table). If it doesn't convey what's shown, lengthen.

### S3 · Anti-pattern sweep

```bash
# Marketing prose
grep -E "comprehensive overview|extensive review|cutting-edge|state-of-the-art" sections/*.tex | head
# These are not always wrong, but if they're frequent the prose is fluffy.

grep -E "the authors|This paper presents|This survey provides" sections/*.tex   # should be empty / minimal

# Citation dumps (≥ 6 keys in one \cite{})
grep -oE '\\cite\{[^}]+\}' sections/*.tex | awk -F, '{print NF}' | sort -nr | head -3
# top number should be ≤ 5
```

### S4 · Prior surveys actually cited

```bash
# Open Related Work; check it cites at least 5 prior surveys by name
wc -l sections/related_work.tex
```

A survey that does not engage with prior surveys is rude (and incomplete).

## Final report format

When all gates pass:

```
Survey ready: output/literature-survey/<slug>/survey_paper/main.pdf

Stats:
  Pages:        9
  Bibliography: 112 entries (all url-backed)
  \cite{} total: 78 across 7 sections
  Figures:      8 (1 taxonomy, 1 timeline, 1 coverage matrix, 3 architecture, 2 trend)
  Tables:       2 (capability comparison, paradigm summary)
  Compile:      0 undefined citations, 0 undefined refs, 0 overfull boxes
  Coverage:     fast-moving; 72/112 (64.3%) from 2024–2026

Quality gate: PASSED (G1–G8 hard incl. G1.5 visual integrity and G2.6 temporal coverage, S1–S4 soft).
```

If you cannot pass G1–G4 without compromising honesty, **say so explicitly**:

> "Bibliography stalled at 52 entries — could not find more high-quality citations on this niche topic via WebFetch. Page count 5. The survey is delivery-quality at this scope; raising to 100 cites would require padding with low-relevance entries that hurt readability."

That's a legitimate stop. Fabricating entries to clear the gate is not.

## Quick checklist

- [ ] G1 compile clean; 0 overfull boxes (remediate, don't tolerate)
- [ ] G1.2 citations begin at 1 and follow first citation; all object numbering is automatic with no counter resets or numbers inside captions
- [ ] G1.5 final survey rasterized; figure text ≥ 7 pt, table text ≥ 8 pt, no overlap/clipping/margin overflow, no generic diagram-tool output
- [ ] G2 bibliography ≥ 60 (100+ recommended); every entry has `url=`
- [ ] G2.6 temporal profile recorded and `check_bibliography_freshness.py` passes
- [ ] G3 PDF ≥ 6 pages
- [ ] G4 `\cite{}` total ≥ 60; per-section minimums hit
- [ ] G5 every figure is topic-specific and justified; no mandatory trio or count filler
- [ ] Every figure/table follows first-discussion order and remains near the prose it supports; no fixed section or placement quota
- [ ] G6 ≥ 1 comparison table
- [ ] G7 `\thanks` carries human-review clause; no simulated clause
- [ ] G8 every label is referenced
- [ ] S1–S4 soft gates reviewed
- [ ] Honest report — don't pad to clear gates
