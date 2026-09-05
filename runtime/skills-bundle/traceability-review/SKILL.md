---
name: traceability-review
description: Use when the user asks to review, verify, or audit a report, manuscript, or analysis in the workspace for traceability — resolving citations, flagging numbers with no source, and checking figures against the code that generated them. Emits a structured review block the app renders as reviewer findings. Verifies traceability, never "correctness".
---

# Traceability Review

Audit a workspace document (report, manuscript, or notebook) with three checks.
You verify **traceability** — that claims trace to sources, data, and code —
not truth. Never state or imply that the document is error-free.

## PDF manuscripts — extract first, never guess

If the document is a **PDF**, do not read the raw bytes or infer its contents.
Run the bundled extractor first — it pulls the text plus the concrete citation
identifiers and quantitative claims deterministically, so you audit real
identifiers, not ones recalled from memory:

```bash
python "$XDG_CONFIG_HOME/opencode/skills/traceability-review/pdf_extract.py" MANUSCRIPT.pdf
```

It prints JSON: `{backend, pages, chars, citations:{dois,arxiv,pmids},
claims:[{kind,text,context}], text}`. Use `citations` as the input to Check 1,
`claims` as the input to Check 2, and `text` to locate figure references for
Check 3. If it returns `{"error": …}` (no PDF backend installed), say so plainly
and fall back to whatever text you can read — do not fabricate identifiers.

## Check 1 · Citation audit

1. Extract every citation identifier from the document: DOI (`10.xxxx/…`),
   arXiv id, PMID, or title + year when no identifier is given.
2. Resolve each against a public registry (no API key needed):
   - DOI: `curl -s "https://api.crossref.org/works/<doi>"`
   - arXiv: `curl -s "http://export.arxiv.org/api/query?id_list=<id>"`
   - PMID: `curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<pmid>&retmode=json"`
3. Findings:
   - `error` — the identifier does not resolve (HTTP 404 / empty result).
   - `warn` — it resolves, but the registry's title/authors/year clearly
     disagree with how the document cites it.
   - `warn` — network unavailable: report "could not verify (offline)" rather
     than skipping silently.

## Check 2 · Untraceable numbers

1. List the document's quantitative claims: statistics, percentages, sample
   sizes, effect sizes, p-values, model scores.
2. For each, look for its source inside the workspace: a data file, a code or
   notebook output, or an execution log that produces that value.
3. Finding: `warn` for any number with no traceable source. Quote the exact
   sentence in the evidence.

## Check 3 · Figure ↔ code consistency

1. Read `.openscience/provenance.jsonl` in the workspace — one JSON record per
   line: `{path, version, ts, tool, content, …}`; `ts` is epoch seconds. It
   records every file version the agent wrote. The directory is hidden: read
   the file directly (`cat .openscience/provenance.jsonl`) instead of relying
   on `ls`. Fall back to file mtimes only when the file is truly absent.
2. For each figure the document references:
   - Latest record `ts` for the figure file (fall back to file mtime when the
     figure has no record).
   - Latest record `ts` of the script/notebook that generates it — match by
     scanning record `content` and workspace code for the figure's filename.
3. Findings:
   - `warn` — the generating code has a newer version than the figure:
     "figure may be stale — regenerate it from the current code".
   - `warn` — a referenced figure has no provenance record and no matching
     workspace file.

## Output contract

End the reply with exactly one fenced block (the app renders it as reviewer
cards; keep it as the LAST thing in the message):

```review
{"findings":[{"level":"error","check":"citation","title":"DOI does not resolve","evidence":"10.9999/fake.2026 → Crossref 404"}],"note":"Traceability review — verified what could be traced. Absence of findings is not a guarantee of correctness."}
```

- `level`: `error` | `warn` | `ok` · `check`: `citation` | `number` | `figure`.
- One finding per issue; `ok` findings are allowed for confirmed traceable
  items worth stating explicitly.
- Evidence: the exact identifier / quoted sentence / file paths, plus what you
  observed.
- The note must never claim the document has no errors.
