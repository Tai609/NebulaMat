# Bibliography Expansion via WebFetch + WebSearch

## Why this exists

A research paper claims 200+ citations not for vanity but because related work, methodology context, and result comparisons should rest on the actual literature. There is no Python-side fetching: the entire bibliography is built by the orchestrating agent using the **WebSearch** and **WebFetch** tools, in one continuous pass before drafting begins. This reference is the protocol.

**Hard target:** 200 unique, real, properly-attributed entries before drafting Related Work. Aim for 250–300 as headroom for organic citation needs across all sections.

## The non-negotiable rule

> **Every BibTeX entry must originate from a URL the agent fetched in this session.** No entries from training-data memory. No "I know this paper exists" shortcuts. If it's not backed by a fetched URL, it doesn't go in the bib.

This prevents fabrication. AI memory is a poor source for academic citations: titles drift, authorship swaps, years are off by one. WebFetch returns the actual bytes of the page; that's what the entry is built from.

## Tools and when to use which

| Tool | Use when | Output |
|---|---|---|
| **WebSearch** | Discovering papers for a query angle (~5–15 candidate hits per call) | List of titles + URLs |
| **WebFetch** | Pulling full metadata from a discovered URL (arXiv abstract, OpenReview, conference page, journal site) | Page content; you parse out title/authors/year/venue |

Pattern: WebSearch first to find candidates, then WebFetch on the most promising URLs to extract the canonical metadata.

For arXiv specifically, two URL templates are reliable:
- `https://arxiv.org/abs/<id>` — abstract page (HTML, easy to parse)
- `http://export.arxiv.org/api/query?search_query=...&max_results=N` — Atom feed (XML)

OpenReview uses `https://openreview.net/forum?id=<id>`. NeurIPS proceedings: `https://papers.nips.cc/paper_files/paper/<year>/...`. Each is fetchable.

## Process

### 0. Choose a temporal profile before searching

Do not treat all fields as if they age at the same speed. Record one profile as
the first line of `.bib_progress.txt`:

| Profile | Use when | Required publication-year distribution |
|---|---|---|
| **Recency-led** | The request names a recent year/window or says latest, emerging, current, or state of the art | At least 70% inside the requested window; older canon is supporting context |
| **Fast-moving** | Default for AI4S, ML, LLM, computational biology, and similarly fast fields | At least 60% from the current calendar year and previous two years |
| **Balanced** | A mature field where recent work and established literature carry similar weight | At least 40% from the current year and previous two years |
| **Timeline-spanning** | Historical, theoretical, or evolution-focused paper | No ratio; span the canon through the newest relevant work |

In 2026 the default three-year window is 2024–2026. Compute it from the
system year; never hardcode it into reusable output. For fast-moving and
recency-led profiles after March, at least 5% of the bibliography must come
from the current year so “recent” cannot quietly mean “two years ago”.

These are **coverage gates, not search exclusion rules**. Keep seminal methods,
original datasets, primary definitions, and directly relevant older evidence.
Never delete a necessary source merely to improve the ratio.

### 1. Optionally seed from a prior lit-survey run

If the `literature-survey` skill has already produced a bib for the same topic (same slug), copy it as a starting point:

```bash
cp output/literature-survey/<slug>/latest/survey_paper/bibliography.bib "$RUN/bibliography.bib"
```

Otherwise start with an empty `$RUN/bibliography.bib`. Either way, you build the bib up to 200+ entries below before drafting begins.

### 2. Plan a query expansion

Decompose the topic into **15–25 angles**. Aim for diversity along these axes:

- **Foundational vs. recent**: include both seminal work and enough current
  work to satisfy the recorded temporal profile.
- **Method families**: every distinct architectural family or technique that has a name in the field.
- **Application domains**: each domain in which the topic is applied.
- **Adjacent / contrast**: rival paradigms (e.g., for "Transformer time-series forecasting": linear baselines, MLP-only, foundation models).
- **Empirical & benchmark**: dataset papers, benchmark studies, evaluation surveys.
- **Theoretical**: convergence, expressivity, identifiability.
- **Surveys**: both topic-specific and adjacent-area.

For each axis, write one or two natural-language queries.

For recency-led and fast-moving profiles, make most query angles date-aware:
use the explicit year/window, date-sorted arXiv/OpenReview feeds, and the newest
conference or journal proceedings. Relevance-ranked search alone over-selects
older, highly cited papers.

### 3. Per query: WebSearch → triage → WebFetch → extract

For each query in the plan:

1. **WebSearch** with the query string. The result is a list of links + titles + snippets.
2. **Triage** — for each candidate, decide whether to keep:
   - Keep peer-reviewed venue papers (NeurIPS / ICML / ICLR / AAAI / IJCAI / KDD / ACL etc.) and authoritative arXiv preprints.
   - Skip blog posts, marketing pages, vendor pages, Medium articles, lecture slides, GitHub READMEs (unless they accompany a peer-reviewed paper).
   - Deduplicate against entries already in `bibliography.bib` by normalized title.
3. **WebFetch** the abstract URL for each kept candidate to obtain canonical metadata. Parse out:
   - `title` — exactly as in the abstract page
   - `authors` — full name list, in order
   - `year` — publication year
   - `venue` — `booktitle` for proceedings, `journal` for journals, "arXiv preprint arXiv:<id>" for preprints
   - `arxiv_id` or `doi` — at least one stable identifier
4. **Append** the BibTeX entry to `output/paper-writer/<slug>/latest/paper/bibliography.bib` immediately (atomic Write/Edit), and add the query string to `output/paper-writer/<slug>/latest/paper/.bib_progress.txt`.

WebFetch is rate-limited by the agent environment; pace queries to avoid throttling. For arXiv specifically, prefer the export.arxiv.org Atom endpoint when bulk-loading 10+ papers from one query — one WebFetch returns multiple entries.

### 4. BibTeX entry format

```bibtex
@inproceedings{lastname2023key,
  title={Exact title from the source page},
  author={Lastname, Firstname and Other, Author},
  booktitle={Venue Name},
  year={2023},
  url={https://arxiv.org/abs/2305.12345},
}

@article{lastname2024arxiv,
  title={Exact title from the source page},
  author={Lastname, Firstname},
  journal={arXiv preprint arXiv:2401.12345},
  year={2024},
  url={https://arxiv.org/abs/2401.12345},
}
```

Always include `url=` so a reviewer can audit the entry. If the venue is a journal, use `@article` with `journal={...}`. If a conference, use `@inproceedings` with `booktitle={...}`. arXiv preprints are `@article` with `journal={arXiv preprint arXiv:<id>}`.

**bib_key convention:** `<firstauthorlastname><year><firstmeaningfulword>`, lowercase, alphanumeric only. Examples: `vaswani2017attention`, `nie2023patchtst`. Disambiguate collisions with a single suffix letter.

**Special characters in titles**: wrap acronyms with `{}` to preserve case — `{T}ransformers`, `{FED}former`. Escape `&`, `%`, `$`, `_`, `#` with `\&`, `\%`, etc.

### 5. Sync to `papers.json` (recommended)

Append a JSON record per BibTeX entry to `output/paper-writer/<slug>/latest/paper/papers.json` so the manifest stays consistent for downstream tools. Minimum fields: `title`, `authors`, `year`, `bib_key`, `url`.

### 6. Validate before drafting prose

Before you start rewriting Related Work, check:

```bash
cd output/paper-writer/<slug>/latest/paper
grep -c "^@" bibliography.bib    # should be ≥ 200

# AI4S default. The script derives 2024–2026 when run in 2026.
python3 check_bibliography_freshness.py bibliography.bib \
  --profile fast-moving

# For a request explicitly limited to 2026:
python3 check_bibliography_freshness.py bibliography.bib \
  --profile recency-led --start-year 2026 --end-year 2026
```

Then run a single `pdflatex + bibtex + pdflatex × 2` pass on the template `main.tex` with the new bib. If `main.bbl` doesn't list every key you intend to cite, the bib has a syntax problem. Fix before drafting prose.

### 7. As you draft, audit cite resolution

After every section rewrite, recompile and grep `main.log` for `Citation .* undefined`. Every undefined citation is either a typo in `\cite{}` or a missing bib entry. Fix immediately, do not let undefined citations accumulate.

## Anti-patterns (each is grounds for rejecting the bib)

- **Recalling from memory**: writing `@inproceedings{vaswani2017attention,...}` because you remember the paper exists. **No.** WebFetch the abstract page first; use the bytes you actually pulled.
- **Fabricating entries**: never invent a paper to fill a citation slot. If you can't find a real reference for a claim, weaken the claim.
- **Citing the same paper 30 times**: each `\cite{}` should advance the argument. Density is achieved by writing prose dense enough to need many distinct references, not by repeating one.
- **Citation dump in prose**: `\cite{a, b, c, d, e, f, g, h}` covering 8 references at once means you didn't read them. Group thematically and cite 2–3 per claim, with prose that distinguishes them.
- **Stopping at 50**: 50 unique entries is enough for a workshop poster, not a research paper. Push past 200.
- **Skipping `url=`**: the URL is the audit anchor. Without it the entry is an unverifiable assertion.

## Quick checklist

- [ ] Planned 15–25 query angles; recorded plan
- [ ] Recorded a temporal profile and passed `check_bibliography_freshness.py`
- [ ] Each entry backed by a URL the agent fetched in this session (not from memory)
- [ ] `grep -c "^@" bibliography.bib` ≥ 200
- [ ] Every entry has `title`, `author`, `year`, venue (`booktitle` or `journal`), and `url`
- [ ] `.bib_progress.txt` records the executed queries (one per line)
- [ ] First test compile shows zero "Citation undefined" warnings against the template
