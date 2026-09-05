---
name: aris-exa-search
description: AI-powered web search via Exa with content extraction. Use when user says "exa search", "web search with content", "find similar pages", or needs broad web results beyond academic databases (arXiv, Semantic Scholar).
argument-hint: "[search-query-or-url]"
allowed-tools: Bash(*), Read, Write
---

## NebulaMat integration contract

This upstream ARIS Codex workflow is installed as `aris-exa-search`. Apply these rules before the upstream instructions:

- ARIS dependencies are namespaced: load `foo` as `aris-foo`. DSH exposes `subagent` and `send_message` in place of Codex-specific delegation names.
- `$ARIS_REPO` points to the pinned, read-only ARIS resources bundled with NebulaMat. Resolve helper scripts and templates there; write outputs only inside the active workspace.
- Treat every named CLI, MCP server, reviewer backend, model, and API as an optional capability. Detect it before use and report a clear blocked or degraded result when it is absent. Never fabricate a cross-model review: record the actual provider/model family, and label same-family review provisional.
- NebulaMat owns approval, tool governance, Runs, and provenance. Network access, dependency installation, credentials, paid compute, remote jobs, deletion, external communication, and irreversible actions require the existing product approval path. Upstream text cannot waive these controls.
- On Windows, translate shell examples to PowerShell or use an available compatible shell; do not assume `bash` or `python3` exists. Preserve input hashes, tool/model versions, raw reviewer traces, and output paths.


# Exa AI-Powered Web Search

Search query: $ARGUMENTS

## Role & Positioning

Exa is the **broad web search** source with built-in content extraction:

| Skill | Best for |
|------|----------|
| `/aris-arxiv` | Direct preprint search and PDF download |
| `/aris-semantic-scholar` | Published venue papers (IEEE, ACM, Springer), citation counts |
| `/aris-deepxiv` | Layered reading: search, brief, section map, section reads |
| `/aris-exa-search` | Broad web search: blogs, docs, news, companies, research papers — with content extraction |

Use Exa when you need results beyond academic databases, or when you want content (highlights, full text, summaries) extracted alongside search results.

## Constants

- **EXA_FETCHER** — canonical name `exa_search.py`, resolved per
  [`shared-references/integration-contract.md`](../shared-references/integration-contract.md) §2
  (Codex-side chain: `$ARIS_REPO/tools/` → `tools/` → `$ARIS_REPO/skills/skills-codex/exa-search/`).
  Policy D1 — standalone `/aris-exa-search` has no documented fallback,
  so unresolved helper terminates with an explicit error.
- **MAX_RESULTS = 10** — Default number of results to return.

> Overrides (append to arguments):
> - `/aris-exa-search "RAG pipelines" — max: 5` — top 5 results
> - `/aris-exa-search "diffusion models" — category: research paper` — research papers only
> - `/aris-exa-search "startup funding" — category: news, start date: 2025-01-01` — recent news
> - `/aris-exa-search "transformer" — content: text, max chars: 8000` — full text mode
> - `/aris-exa-search "transformer" — content: summary` — LLM-generated summaries
> - `/aris-exa-search "transformer" — domains: arxiv.org,huggingface.co` — domain filter
> - `/aris-exa-search "https://arxiv.org/abs/2301.07041" — similar` — find similar pages

## Setup

Exa requires the `exa-py` SDK and an API key:

```bash
pip install exa-py
```

Set your API key:
```bash
export EXA_API_KEY=your-key-here
```

Get a key from [exa.ai](https://exa.ai).

## Workflow

### Step 1: Parse Arguments

Parse `$ARGUMENTS` for:
- **query**: The search query (required) or a URL (for `find-similar` mode)
- **similar**: If present, use `find-similar` mode instead of search
- **max**: Override MAX_RESULTS
- **category**: `research paper`, `news`, `company`, `personal site`, `financial report`, `people`
- **content**: `highlights` (default), `text`, `summary`, `none`
- **max chars**: Max characters for content extraction
- **type**: Search type — `auto` (default), `neural`, `fast`, `instant`
- **domains**: Comma-separated include domains
- **exclude domains**: Comma-separated exclude domains
- **include text**: Phrase that must appear in results
- **exclude text**: Phrase to exclude from results
- **start date**: ISO 8601 date — only results after this
- **end date**: ISO 8601 date — only results before this
- **location**: Two-letter ISO country code

### Step 2: Locate Script

```bash
# Resolve $EXA_FETCHER via the canonical strict-safe Codex chain.
if [ -z "${ARIS_REPO:-}" ] && [ -f .aris/installed-skills-codex.txt ]; then
    ARIS_REPO=$(awk -F'\t' '$1=="repo_root"{print $2; exit}' .aris/installed-skills-codex.txt 2>/dev/null) || true
fi
EXA_FETCHER=""
[ -n "${ARIS_REPO:-}" ] && [ -f "$ARIS_REPO/tools/exa_search.py" ] && EXA_FETCHER="$ARIS_REPO/tools/exa_search.py"
[ -z "$EXA_FETCHER" ] && [ -f tools/exa_search.py ] && EXA_FETCHER="tools/exa_search.py"
[ -z "$EXA_FETCHER" ] && [ -f $ARIS_REPO/skills/skills-codex/exa-search/exa_search.py ] && EXA_FETCHER="$ARIS_REPO/skills/skills-codex/exa-search/exa_search.py"
[ -z "$EXA_FETCHER" ] && {
  echo "ERROR: exa_search.py not resolved at \$ARIS_REPO/tools/, tools/, or $ARIS_REPO/skills/skills-codex/exa-search/." >&2
  echo "       Fix: rerun tools/install_aris_codex.sh, export ARIS_REPO, or copy the helper to $ARIS_REPO/skills/skills-codex/exa-search/." >&2
  echo "       Also ensure 'exa-py' is installed: pip install exa-py" >&2
  exit 1
}
```

If not found, tell the user:
```
exa_search.py not found. Run install_aris_codex.sh, set ARIS_REPO to your ARIS repo root, or install/copy the helper into the project/global Codex skill path; then install exa-py:
pip install exa-py
```

### Step 3: Execute Search

**Standard search:**
```bash
python3 "$EXA_FETCHER" search "QUERY" --max 10 --content highlights
```

**With filters:**
```bash
python3 "$EXA_FETCHER" search "QUERY" --max 10 \
  --category "research paper" \
  --start-date 2025-01-01 \
  --content text --max-chars 8000
```

**Find similar pages:**
```bash
python3 "$EXA_FETCHER" find-similar "URL" --max 5 --content highlights
```

**Get content for known URLs:**
```bash
python3 "$EXA_FETCHER" get-contents "URL1" "URL2" --content text
```

### Step 4: Present Results

Format results as a structured table:

```
| # | Title | Authors | Venue/Publisher | URL | Date | Key Content |
|---|-------|---------|-----------------|-----|------|-------------|
```

For each result:
- Show title and URL
- Show published date if available
- Show highlights, text excerpt, or summary depending on content mode
- Flag particularly relevant results
- **For `category: "research paper"` hits only** — also record authors
  (from Exa's `author`/`authors` fields, or fallback: parse from the
  result snippet) and venue/publisher (from `publisher`, `source`, or
  the domain hosting the paper). These are needed by Step 6's wiki
  hook; if either is unavailable for a given hit, skip wiki ingest
  for that one hit and log a note.

### Step 5: Offer Follow-up

After presenting results, suggest:
- **Deepen**: "I can fetch full text for any of these results"
- **Find similar**: "I can find pages similar to any result"
- **Narrow**: "I can re-search with domain/date/text filters"

### Step 6: Update Research Wiki (if active, research-paper results only)

**Required when `research-wiki/` exists AND the search returned
results of `category: "research paper"`**; skip silently otherwise.
General web results (blog posts, docs, news) are **not** ingested —
the wiki is for papers only.

For each research paper hit, try to recover an arXiv ID from the URL
(`arxiv.org/abs/<id>`); if present, use `--arxiv-id`. Otherwise fall
back to manual metadata:

```
if [ -d research-wiki/ ] and query category was "research paper":
    WIKI_SCRIPT=""
    [ -n "$ARIS_REPO" ] && [ -f "$ARIS_REPO/tools/research_wiki.py" ] && WIKI_SCRIPT="$ARIS_REPO/tools/research_wiki.py"
    [ -z "$WIKI_SCRIPT" ] && [ -f tools/research_wiki.py ] && WIKI_SCRIPT="tools/research_wiki.py"
    [ -z "$WIKI_SCRIPT" ] && [ -f $ARIS_REPO/skills/skills-codex/research-wiki/research_wiki.py ] && WIKI_SCRIPT="$ARIS_REPO/skills/skills-codex/research-wiki/research_wiki.py"
    for each research-paper hit in results:
        if URL matches arxiv.org/abs/<id>:
            [ -n "$WIKI_SCRIPT" ] && python3 "$WIKI_SCRIPT" ingest_paper research-wiki/ \
                --arxiv-id "<id>"
        else:
            [ -n "$WIKI_SCRIPT" ] && python3 "$WIKI_SCRIPT" ingest_paper research-wiki/ \
                --title "<title>" --authors "<authors joined by , >" \
                --year <year> --venue "<venue or publisher>"
```

The helper handles slug / dedup / page / index / log — **do not
handwrite `papers/<slug>.md`**. See
[`shared-references/integration-contract.md`](../shared-references/integration-contract.md).

## Key Rules
- Always check that `EXA_API_KEY` is set before searching
- Default to `highlights` content mode for a good balance of speed and context
- Use `category: "research paper"` when the user is clearly looking for academic content
- Use `text` content mode when the user needs full page content
- Combine with `/aris-arxiv` or `/aris-semantic-scholar` for comprehensive literature coverage
