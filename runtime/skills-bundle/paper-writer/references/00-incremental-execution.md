# Incremental Execution — How Long Tasks Actually Get Done

## Why this exists

A research paper has ~200 references and 7 sections of dense prose. **None of this fits into a single LLM tool call.** WebSearch returns ~10 useful entries per query, not 200. A single message can write one solid section, not seven. If you treat the build as "do it all in one shot", you will hit context limits, fail mid-task, and have nothing to recover.

This reference defines the only execution mode that works: **incremental, file-persisted, resumable**. Every other reference (`01`–`06`) describes *what* to produce; this one describes *how* to produce it without losing work.

The pattern below is not optional. It is the only way the skill is feasible.

## The three invariants

### Invariant 1 — Filesystem is the source of truth, not the chat buffer

Every intermediate result is written to disk **immediately**, not held in the conversation. Specifically:

- Each new BibTeX entry → appended to `output/paper-writer/<slug>/latest/paper/bibliography.bib` the moment it's extracted from a WebSearch result, not after all queries finish.
- Each rewritten section → written to `output/paper-writer/<slug>/latest/paper/sections/<name>.tex` the moment it's drafted, not after all 7 are drafted.
- Each generated figure → committed to `output/paper-writer/<slug>/latest/paper/figures/fig_NN_<name>.pdf` and the matching script saved alongside. Assign `NN` only after planning narrative first-use order; it is a file-order aid, never a manually written caption number.

Why: if the conversation context fills, the agent crashes, or the user asks a sideways question, **the files survive**. Resumption reads the files and continues.

### Invariant 2 — Progress is observable via filesystem, not memory

You measure how far you are by counting files / `grep`-ing artefacts:

```bash
grep -c "^@" output/paper-writer/<slug>/latest/paper/bibliography.bib                         # bib entries so far
ls output/paper-writer/<slug>/latest/paper/figures/*.pdf | wc -l                              # figures so far
for f in output/paper-writer/<slug>/latest/paper/sections/*.tex; do
  echo "$(basename "$f"): $(wc -w < "$f") words"
done                                                                # per-section drafted size
```

If the count doesn't match the target, do another batch. Don't rely on remembering what you did.

### Invariant 3 — Each batch is small enough to succeed, atomic enough to retry

A "batch" is one WebSearch call + extraction, or one section's prose, or one figure's script + render. If it fails, you redo just that batch — not the whole step. If it succeeds, you write to disk and move on.

## Batch sizes that actually work

| Operation | Batch size per turn | Total batches | Where persistence happens |
|---|---|---|---|
| Bibliography expansion | 1 WebSearch query → ~5–15 new bib entries | 20–30 batches to reach 200+ | Append to `bibliography.bib` after each batch |
| Section drafting | 1 section per turn (or 2 short ones) | 7 batches total | Write each `sections/<name>.tex` immediately |
| Figure generation | 1 figure script per turn | 4–8 batches total | Save `figures/make_fig_NN_*.py` and run it |
| Compile + check | 1 compile cycle | After every section + at end | `main.log` + grep |

A turn that tries to do 5 sections in one go will produce shallow prose and probably truncate. A turn that tries to write `bibliography.bib` from one mega search will hit the WebSearch token cap.

## Bibliography expansion — incremental loop

```
read existing bibliography.bib
n_entries = grep -c "^@" bibliography.bib
target = 220                                # aim 10-20% above gate

query_plan = [...]                          # 15-25 angles from 01-bibliography-expansion.md
already_run = read_state(.bib_progress)     # set of query strings already executed
seen_titles = extract_seen_from_bib()       # normalized titles already present

for q in query_plan:
    if q in already_run: continue
    results = WebSearch(q)
    for r in extract_real_papers(results):
        norm = normalize_title(r.title)
        if norm in seen_titles: continue
        append_bibtex(r, output/paper-writer/<slug>/latest/paper/bibliography.bib)
        seen_titles.add(norm)
    append(.bib_progress, q)                # persist that this query was done
    n_entries = grep -c "^@" bibliography.bib
    if n_entries >= target: break
```

Concretely as a Claude Code workflow, this loop is **one WebSearch + one Bash append per turn** for ~20 turns:

1. Turn 1: WebSearch query #1, parse results, write 6 new entries to `bibliography.bib` via Edit/Write tool. Also append the query string to a tiny progress note (e.g., `output/paper-writer/<slug>/latest/paper/.bib_progress.txt`) so a future run knows to skip it.
2. Turn 2: count current bib entries, pick query #2, repeat.
3. … through query #20+, until count ≥ target.

If turn 7 fails (timeout, malformed results, anything), turn 8 reads the progress file, sees queries 1–6 are done, restarts from query #7. **No work is lost.**

## Section drafting — one section per turn

Order: intro → related → method → experiment → results → conclusion → abstract.

For each section:

1. Read `references/03-section-playbook.md` rules for that section (open it fresh — don't trust a cached recollection).
2. Read `output/paper-writer/<slug>/latest/paper/bibliography.bib` and pick 8–30 real keys relevant to this section.
3. Draft the section in one go (one section is 400–1200 words; a single LLM turn can comfortably produce that).
4. **Immediately** Write the result to `output/paper-writer/<slug>/latest/paper/sections/<name>.tex`.
5. Compile (`pdflatex` once + `bibtex` + `pdflatex` × 2). Check `main.log` for new undefined citations or LaTeX errors.
6. Fix any errors before moving to the next section.

If you're tempted to draft 3 sections in one turn — don't. Each gets shallower. One section per turn produces prose that is actually research-grade.

### The "abstract last" rule

Don't write abstract until everything else is done. The abstract claims a headline result; you only know what the result is after writing Results. Writing it last takes 5 minutes; writing it first wastes 30 minutes rewriting it.

## Figure generation — one figure per turn

For each figure (4–8 total):

1. Open `references/02-figures-publication-grade.md` for the family that fits this figure (TikZ vs. matplotlib vs. seaborn vs. multi-panel).
2. Decide: what does this figure *answer* in the paper? Write the answer down (you'll use it as caption).
3. Write the figure script as `output/paper-writer/<slug>/latest/paper/figures/make_fig_NN_<slug>.py` (or inline TikZ inside `sections/<name>.tex`).
4. Run the script: `cd output/paper-writer/<slug>/latest/paper/figures && python make_fig_NN_<slug>.py`.
5. Verify the PDF exists and is non-trivial: `test -s fig_NN_<slug>.pdf`.
6. Reference it from the appropriate section with a caption.
7. Recompile and check.

## Recovery — what to do when a session resumes mid-task

User comes back, says "continue the paper". You don't remember what's done. Don't assume — check the filesystem:

```bash
cd output/paper-writer/<slug>/latest/paper

# Where are we on bib?
grep -c "^@" bibliography.bib                              # current entry count
cat .bib_progress.txt 2>/dev/null | wc -l                  # queries executed

# Which sections are done?
for f in sections/*.tex; do
  words=$(wc -w < "$f")
  echo "$(basename "$f"): $words words"
done
# A section with > 200 words is probably drafted; < 50 is still a stub.

# Which figures exist?
ls figures/*.pdf 2>/dev/null

# Last good compile?
ls -la main.pdf
grep -c "Citation .* undefined" main.log
```

Decide which sub-step to resume. **Never** redo work that's already on disk; only fill in what's missing.

## Atomic write rule

When updating `bibliography.bib` or any other file, Write it whole rather than streaming partial content. The standard tools (Write, Edit) write atomically. Two failure modes that destroy progress and how to avoid them:

- **Half-written file**: an interrupted streaming write leaves a malformed file. → Always Write/Edit, never `python -c "open(...).write(...)"` mid-stream from Bash.
- **Concurrent writes**: two parallel WebSearch results being appended at once. → This skill is sequential; do not parallelize bib appends.

## Checkpoint files

Keep three small bookkeeping files in `output/paper-writer/<slug>/latest/paper/`:

- `.bib_progress.txt` — one line per executed WebSearch query string. Read on resume.
- `.section_progress.txt` — one line per drafted section name. Read on resume.
- `.figure_progress.txt` — one line per generated figure id. Read on resume.

These are tiny (< 1 KB total) and let any future turn instantly know what's done.

```bash
# Mark a query done after extracting + writing entries
echo "transformer time series Informer Autoformer" >> output/paper-writer/<slug>/latest/paper/.bib_progress.txt
```

## Sanity check before delivery

Before you tell the user "the paper is done", verify all three invariants held:

```bash
# Invariant 1 — files are the source of truth
ls -la output/paper-writer/<slug>/latest/paper/sections/                              # all 7 .tex files non-trivial?
ls -la output/paper-writer/<slug>/latest/paper/figures/*.pdf                          # 4+ figure PDFs present?
test -s output/paper-writer/<slug>/latest/paper/main.pdf                              # final PDF non-empty?

# Invariant 2 — observable progress matches target
grep -c "^@" output/paper-writer/<slug>/latest/paper/bibliography.bib                 # ≥ 200
total=0; for f in output/paper-writer/<slug>/latest/paper/sections/*.tex; do
  total=$((total + $(grep -o "\\\\cite{" "$f" | wc -l)))
done
echo "TOTAL cites: $total"                                 # ≥ 60

# Invariant 3 — each batch was atomic; checkpoints align with files
wc -l output/paper-writer/<slug>/latest/paper/.bib_progress.txt                       # roughly matches the # of queries you intended
```

If any of these surprise you, stop and reconcile before declaring done.

## Quick checklist

- [ ] Bibliography assembled in **20+ small WebSearch batches**, one query per turn, appended to `bibliography.bib` immediately.
- [ ] Sections written **one per turn** in the recommended order, each Write'd to disk before moving on.
- [ ] Figures generated **one per turn**, script saved alongside the PDF.
- [ ] Three checkpoint files maintained: `.bib_progress.txt`, `.section_progress.txt`, `.figure_progress.txt`.
- [ ] Resume strategy: `cd output/paper-writer/<slug>/latest/paper && grep -c "^@" bibliography.bib && for f in sections/*.tex; do wc -w < "$f"; done`.
- [ ] Compile + verify after each major artefact, not only at the end.
- [ ] Never tried to "do it all in one turn".
