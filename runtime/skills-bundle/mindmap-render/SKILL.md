---
name: mindmap-render
description: Generate beautiful, high-resolution mindmaps from Markdown unordered lists. Outputs interactive HTML, HD PNG, and PDF with colorful branch themes.
---

## When to use this skill

Use this skill when the user asks to:
- Create a mindmap from a topic or data.
- Convert a Markdown outline into a visual mindmap image or PDF.
- Generate a colorful, presentation-quality mindmap with auto-export to PNG/PDF.
- Build a structured outline (unordered list) and then render it as a mindmap.

## Prerequisites

Assume the runtime environment already has Python 3.10+, Playwright, and Chromium installed (they are provisioned in the container). **Do not proactively run `pip install` or `playwright install`** — just run the render script directly. Only if the first run fails with a clear missing-dependency error (ImportError, missing-browser error, etc.), then repair the environment:

```bash
pip install -r scripts/requirements.txt
playwright install chromium
```

and retry. Never install speculatively before a failure is observed.

## Workflow

### Step 1 — Determine input source

Ask the user (or infer from context):
- **Topic**: What is the central theme?
- **Data source**: Do they already have a Markdown file, or should you research and write one?
- **Source fidelity vs synthesis** — a spectrum, not a binary. The more specifically the request points to a **named existing artifact** (a particular book's table of contents (ToC), a particular course's syllabus, a specific spec or documentation structure, a numbered chapter list), the more you should **reproduce the source's real structure verbatim** — preserve original labels and numbering, follow the source's natural depth, and add NO fabricated descriptions. The more the request is a **broad topic** with no single canonical source, the more the structural targets below apply. Most requests sit somewhere on this spectrum; judge and lean accordingly.
- **Theme**: `air` (light blue glow + white cards, default), `editorial` (warm paper + jewel-tone branches), `midnight` (deep black + neon accents), or `zen` (soft misty background + muted pastels).
- **Language**: 
  - If the user explicitly specifies a language (e.g. "in English", "in Japanese"), use that language for all node text (labels + layer-5 descriptions).
  - Otherwise, match the language of the user's request; default to English when the request language is unclear.
  - Do not translate proper nouns, model names, or established technical terms — preserve them inline.

**Default structural targets — for synthesis work only.** These do NOT apply when you are faithfully reproducing a named source (in that case, follow the source's actual shape). They also yield to any numbers the user gives explicitly.
- **1 root** + **6–10 top-level branches** (default aim: ~9).
- **Maximum depth = 5 layers** (root → branch → subtopic → item → leaf-with-description). Layer 5 is reserved for the **important, information-dense** nodes — it is **not** a mandatory floor for every path.
- **Layer-5 leaves (when present) MUST carry a substantive description** — around **200 Chinese characters** (or ~150 English words if the mindmap is in English), roughly 2–4 sentences — that explains mechanism, why it matters, quantitative detail, or a concrete example. A one-line label is not enough at layer 5; if you cannot write ~200 Chinese characters of real content, the node does not belong at layer 5.
- Intermediate nodes (layers 2–4) stay concise (1–10 words) and may themselves be terminal leaves when that is the right level of detail.
- **Asymmetry is required, not a flaw.** Branches should be weighted by importance and information value, *not* padded for visual symmetry:
  - Pillar branches (where the real substance lives) should go deep and wide, with many children and rich layer-5 descriptions.
  - Supporting / well-known branches can stop at layer 2 or 3. Do not expand common knowledge the target reader already owns, and do not invent filler children just to match sibling counts.
  - When deciding "expand or stop," ask: *Would a knowledgeable reader learn something here?* If no, prune.
- The hierarchy is intentionally irregular. In Step 2c, report the shape honestly rather than forcing every branch to layer 5.

If the user gives different numbers, use theirs; otherwise treat the defaults above as **guidance with judgment** — breadth/depth targets are firm, but per-branch expansion is deliberately uneven.

### Step 2a — User provided a Markdown file

If the user already has a `.md` file, note its path and proceed to Step 3.

### Step 2b — Generate the Markdown outline yourself

**CRITICAL: If the user has NOT provided a `.md` file, you MUST perform web research BEFORE writing the outline.** Do not rely solely on internal knowledge.

1. **Research** (mandatory): Use `WebSearch` to find authoritative, high-quality sources:
   - Official book table of contents (publisher's catalog, Douban Books listing).
   - Wikipedia structured sections.
   - Academic course syllabi or reputable blog series.
   - Official documentation / white-paper outlines.
   - Recent industry reports, survey papers, or conference proceedings (e.g. NeurIPS, ICML, JPMorgan Quantitative Research).

   **Fail loudly if the authoritative source cannot be found.** When the user names a specific artifact (a particular book, edition, course, spec) and repeated searches do not surface its real ToC / syllabus / structure, **STOP** and tell the user: *"I couldn't find the authoritative structure of [X]. Please paste the ToC, confirm the edition/title, or allow me to produce a synthesized overview instead."* **Never invent chapter/section structure to fill the gap.** This is the single most important rule of this step.

2. **Write the outline** — choose the mode based on Step 1's fidelity-vs-synthesis judgment:

   **a) Faithful reproduction** (user pointed to a specific named artifact and you located its real structure): copy the ToC/outline verbatim into a single-root bullet list. Preserve original labels, chapter numbering, and natural depth. Do **not** add layer-5 descriptions, do **not** force 6–10 top-level branches, do **not** pad to 5 layers — follow whatever shape the source actually has. The only transformations allowed are: wrapping everything under one root node, and cleaning trivial typography (e.g. converting full-width numbers consistently).

   **b) Synthesis** (broad topic, multi-source): distill the research into a single-root unordered-list Markdown file following the Step-1 structural targets.
   - Use standard `- ` bullet lists; nesting = depth.
   - **One** top-level bullet = the root (layer 1).
   - Layers 2–4 (branch / subtopic / item): concise labels, **1–10 words each**. A layer-2/3/4 node can be a terminal leaf when no deeper breakdown adds value.
   - Layer 5 (when used): **a substantive description, ~200 Chinese characters** (or ~150 English words for English mindmaps), covering mechanism + why it matters + concrete detail (numbers, names, example). Only create a layer-5 node when you have real content of that density; never pad.
   - **Weight by importance.** Give the pillar branches many children and deep layer-5 content; let well-known or low-information branches stay shallow. Target reader: an informed practitioner — skip what they already know, dwell on what is surprising, recent, or load-bearing.
   - Irregular depth is expected. A tree with 3 deep pillar branches and 6 shallow supporting ones is healthier than 9 uniformly-expanded branches full of filler.

3. **Save the file**:
   - Save to `mindmap-output/<topic>.md` (or the current project directory).
   - Show the user the saved path and the first ~30 lines of the outline for confirmation.

### Step 2c — Self-check before rendering

**If you wrote a faithful reproduction (Step 2b-a)**, skip the full audit. Just verify two things and report one line each: (1) the outline's labels and numbering match the source, (2) you did not inject any fabricated descriptions or extra layers. Then proceed to Step 3.

**If you wrote a synthesis (Step 2b-b)**, do not skip. After saving the outline and before running the render script, verify against the structural target. Output a short audit block to the user:

```
Structure audit:
- Top-level branches: <N>   (target 6–10)
- Max depth reached:  <D>   (ceiling 5)
- Pillar branches (reach layer 5 with substantive content): <X>
- Shallow branches (stop at layer 2–3 by design): <Y>
- Layer-5 leaves with ≥~200 Chinese characters description: <A> / <total layer-5 leaves>
- Shape note: <one sentence justifying which branches go deep and which stay shallow, and why>
```

**Red flags** — rework the outline before rendering if any apply:
- Layer-5 leaves that are one-line labels or under ~100 Chinese characters → either enrich them to ~200 Chinese characters of real content, or demote the node to layer 4.
- Every branch reaches the same depth with similar child counts → you are padding for symmetry; prune the weakest branches back.
- A branch exists only to list common knowledge the target reader already owns → cut it or collapse it.
- Pillar branches are shallower than supporting branches → rebalance so information density follows importance.

### Step 3 — Render the mindmap

Run the rendering script:

```bash
python scripts/generate_mindmap.py \
  --md <path-to-md> \
  --output-dir ./mindmap-output \
  --title "<Topic Title>" \
  --theme <air|editorial|midnight|zen> \
  --scale 2
```

**Arguments**:
- `--md` *(required)*: Path to the Markdown file.
- `--output-dir`: Where to place the results. Default is `./mindmap-output`.
- `--title`: Used for the HTML `<title>` and the output base file name.
- `--theme`: `air` (designer-style airy blue glow + white rounded cards + soft pastel branch accents), `editorial` (magazine-style warm paper background + jewel-tone branches + dark serif text), `midnight` (pitch-dark background + neon accents + crisp light text), or `zen` (soft misty background + muted Morandi pastels + gentle serif text).
- `--scale`: Upscale factor for the exported image (default `2`). `1` = compact (~2–3 MB), `2` = crisp readable (~3–5 MB), `3`+ = poster size. Larger numbers produce physically larger, more readable text.

**Example** (default shape from Step 1: ~9 branches, 5 layers, leaf descriptions):
```bash
python scripts/generate_mindmap.py \
  --md mindmap-output/large-test.md \
  --output-dir ./mindmap-output \
  --title "Artificial Intelligence Panorama" \
  --theme air \
  --scale 3
```

### Step 4 — Deliver results

Report the three generated files to the user:
1. `{title}.html` — interactive mindmap (open in browser to zoom/pan/collapse). **Live rendering**: after starting an HTTP server in the same directory (e.g. `python -m http.server`) and accessing it through a browser, edit the `.md` file and refresh the page to see the update; opening it directly as a local file uses the embedded content, behaving the same as before.
2. `{title}.png` — high-resolution full-page image (suitable for slides, social media, docs).
3. `{title}.pdf` — vector-like PDF export with print background.

## Important notes

- **Color system — "rainbow branches" with in-family shading.** Each top-level branch owns one color family (hue); its descendants use the same hue with depth-based variation (deeper layers → slightly lighter + less saturated on light themes; slightly dimmer + less saturated on dark themes). You do not need to configure this — it is applied automatically by the render script based on the theme palette.
- **Do not pass raw paragraphs** as the Markdown input. The renderer works best with bullet-list outlines. If the source text is prose, convert it into a hierarchical bullet list first.
- The script automatically strips YAML frontmatter from the Markdown file so markmap can focus on the outline.
- If the mindmap is very large, Playwright will resize the viewport to fit the entire diagram; `full_page=True` guarantees the PNG captures everything without clipping.
- **Never skip research** when the user only gives a topic. The mindmap's quality depends on accurate, up-to-date, well-sourced hierarchies.
- When researching, prefer sources that already have a clear hierarchy (ToCs, syllabi, wiki sections) so the resulting mindmap is accurate and useful.
