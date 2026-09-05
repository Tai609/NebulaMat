# Layout Discipline — Tables, Figures, Floats, Cross-references

## Why this exists

A first draft is usually layout-naive: tables are bare `\begin{tabular}` blocks, figures use `[h]`, and the author block has no disclosure footnote. These choices break in journal/conference templates and look amateurish even where they don't break.

## Tables

### Always wrap in a `table` float

A bare `\begin{tabular}` in body text gets wrong placement, no caption, no label, and may break across pages. Always wrap:

```latex
\begin{table}[htbp]
  \centering
  \small
  \setlength{\tabcolsep}{4pt}
  \caption{Comparison of Transformer-based time-series forecasters across capability dimensions. \checkmark = supported; \cmark[half] = partial; blank = not supported.}
  \label{tab:capability}
  \begin{tabular}{l c c c c c c}
    \toprule
    Method & Long horizon & Multivariate & Probabilistic & Zero-shot & Efficient & Interp. \\
    \midrule
    DLinear~\cite{zeng2023dlinear}              & \checkmark & --         & --         & --         & \checkmark & --         \\
    Informer~\cite{zhou2021informer}            & \checkmark & \checkmark & --         & --         & \checkmark & --         \\
    Autoformer~\cite{wu2021autoformer}          & \checkmark & \checkmark & --         & --         & \checkmark & --         \\
    PatchTST~\cite{nie2023patchtst}             & \checkmark & \checkmark & --         & --         & \checkmark & --         \\
    iTransformer~\cite{liu2024itransformer}     & \checkmark & \checkmark & --         & --         & \checkmark & --         \\
    Moirai~\cite{woo2024moirai}                 & \checkmark & \checkmark & \checkmark & \checkmark & --         & --         \\
    \bottomrule
  \end{tabular}
\end{table}
```

### Float placement

- **Narrative ownership comes first.** Put the float source immediately after
  the first paragraph that introduces or interprets it. A taxonomy can belong
  in Background or Methods; a trend plot can belong in Introduction,
  Discussion, or elsewhere. The claim decides, not the figure family.
- **Preserve first-use order.** Order figure blocks by the prose's first
  `Figure~\ref{...}` references and table blocks by the first
  `Table~\ref{...}` references. Do not collect all floats at a section end.
- `[htbp]` — use for a compact artifact that should remain near its discussion.
- `[tbp]` — use for a larger artifact that may move to the top, bottom, or a
  float page without breaking the argument.
- `[p]` — use for a full-page or unusually tall artifact.
- `[!t]` is an occasional editorial choice, not a universal default.
- Avoid `[H]`; exact pinning produces brittle pagination.
- For a wide method-comparison table that overruns the text width, **do not**
  reach for `table*` (no second column to span here). Use the structural fitting
  order below.

LaTeX may move a float within these legal positions. Inspect the rendered
survey: an artifact must remain near its first discussion, must not precede
that discussion, and must not form an unexplained cluster far later.
If a float crosses into an unrelated section after source order and size have
been corrected, insert `\FloatBarrier` at that semantic boundary. The template
loads `placeins`; use barriers sparingly, never after every float.

### Font size standard (uniform across the paper)

Exactly two table font sizes are allowed: **`\small` (default)** and
**`\footnotesize` (wide tables only)**. Never `\scriptsize`/`\tiny`, and
**never wrap a `tabular` in `\resizebox`/`\scalebox`** — scaling picks an
arbitrary effective font size per table.

Fit an over-wide table in this order:

1. Shorten or wrap headers; move units and details into the caption or notes.
2. Use `tabularx` for text columns and aligned numeric columns.
3. Drop or merge low-value columns, transpose, or split into two tables; move
   secondary detail to an appendix.
4. Tighten `\tabcolsep`, but not below 3 pt.
5. Use `\footnotesize` only if the table still overruns at `\small`.

Never shrink type first. If the table still does not fit at `\footnotesize`,
redesign or split it.

### Style

- **Always use `booktabs`**: `\toprule`, `\midrule`, `\bottomrule`. Never `\hline`.
- **No vertical rules** (`|` in column spec).
- **Numbers right-aligned** when comparing magnitudes.
- **Bold the cell that wins per row** if applicable. For survey capability tables, prefer `\checkmark` / `--` / partial markers over numerical scores.
- **Caption above** the tabular (scientific convention for tables).

### Caption rule

Captions must let a reader who reads only the caption + table understand what's shown. "Comparison." is not a caption; aim for 1–3 sentences naming the axis of comparison and the legend.

## Figures

### Float wrapper

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.95\linewidth]{figures/fig_02_timeline.pdf}
  \caption{Chronology of representative works on Transformer-based time-series forecasting. Lanes correspond to the taxonomy branches in Fig~\ref{fig:taxonomy}.}
  \label{fig:timeline}
\end{figure}
```

### Width

- This template is **single-column** `article` → there is no second column to span. `figure*` behaves exactly like `figure` here, so it buys no width. Don't use it to "make room".
- Includes: `width=0.85\linewidth` to `width=\linewidth` — never a bare `\includegraphics{file}`.
- TikZ figures (taxonomy, timeline, architecture): wrap in `\resizebox{\linewidth}{!}{…}` so they fit the column whatever their natural size (see `02-survey-figures.md` § *Fitting & overflow*). If shrinking makes a tree unreadable, fold it into sub-figures rather than spilling past the margin.

### Path

`\includegraphics{figures/<basename>}` — never absolute paths.

### Caption

Same standalone-readable rule as tables. Caption goes **below** the figure.

### Multi-panel

Use `\begin{subfigure}` (the `subcaption` package is already loaded). For surveys, sub-figures are common when comparing canonical architectures across a family.

## Cross-references

### Automatic numbering only

Use `\cite{key}`, `\caption` + `\label`, numbered equation environments, and
`\ref`. The template's `unsrtnat` bibliography style numbers references from
`[1]` by order of first citation. Figure, table, equation, and section counters
independently start at 1 and advance in source order.

Never type citation or object numbers manually, put `Figure 1.` inside a
caption, use `\tag{7}`/`\setcounter`/`\addtocounter` to manufacture numbering,
or infer citation numbers from `bibliography.bib` order. Place `\label`
immediately after `\caption`.

### Every label must be referenced

If you `\label{eq:x}`, refer to it later with `Eq.~\ref{eq:x}`. Same for `\label{tab:...}`, `\label{fig:...}`, `\label{sec:...}`.

```bash
grep -oE '\\label\{[^}]+\}' sections/*.tex | sort -u > /tmp/labels.txt
grep -oE '\\ref\{[^}]+\}'   sections/*.tex | sort -u > /tmp/refs.txt
diff <(comm -23 /tmp/labels.txt /tmp/refs.txt) <(echo)
```

### Non-breaking spaces

Use `~` not regular space:
- `Section~\ref{sec:methods}`
- `Table~\ref{tab:capability}`
- `Figure~\ref{fig:taxonomy}` (or `Fig.~\ref{...}`)
- `\cite{key}` is preceded by `~`: "as shown in PatchTST~\cite{nie2023patchtst}"

## Author and disclosure footnote

**Author:** the default template uses `\author{AI4S Agent}`. Keep this unless the user has provided a specific author block.

**Disclosure:** every survey produced by this skill must carry a `\thanks` footnote on the author block recommending human review. Surveys do not present numerical experimental results, so the simulated clause from `paper-writer`'s template is **not** included.

```latex
\author{AI4S Agent\thanks{This survey was generated by the AI4S Agent. \textbf{Human review by a domain expert is strongly recommended} before any scientific publication or production use.}}
```

Do **not** put `\input{simulated}` inside `\title{}`.

## Common compile errors

### `Citation X undefined`

- bib_key in `\cite{X}` does not appear in `bibliography.bib`. Check spelling.
- Forgot to run `bibtex main` between `pdflatex` passes. Compile sequence: `pdflatex` → `bibtex` → `pdflatex` → `pdflatex`.

### `Missing $ inserted`

- Math symbol used outside math mode. Wrap with `$...$`.
- Underscore in non-math text: escape with `\_`.

### `Overfull \hbox`

- A line is wider than the column. Caused by long unbreakable strings (URLs, long bib-key clusters, equations).
- Fix by breaking the line, using `\sloppy`, or shortening.

### Float too large for page

- Figures/TikZ: reduce `width=` or wrap in `\resizebox{\linewidth}{!}{…}`. Tables: use the font-size ladder above (`\footnotesize`, tighter `\tabcolsep`, fewer columns) — not `\resizebox`. `figure*`/`table*` do not help in this single-column template.

## Verification commands

After any compile:

```bash
cd output/literature-survey/<slug>/survey_paper
grep -E "Citation .* undefined" main.log    # must be empty
grep -E "Reference .* undefined" main.log   # must be empty
grep -E "Overfull|Underfull" main.log | head # should be near-empty
ls main.pdf                                  # must exist
pdfinfo main.pdf | grep Pages                # must be ≥ target
```

## Quick checklist

- [ ] Every table wrapped in a float with caption + label, using `booktabs`; placement follows its first discussion; fonts uniform (`\small` default, `\footnotesize` wide); no `\resizebox`/`\scalebox` on any `tabular`, no `table*`
- [ ] Every figure wrapped in a float with caption + label; source follows its first discussion; TikZ in `\resizebox{\linewidth}{!}{…}`, includes with `width=…\linewidth`
- [ ] Citation and object numbering is automatic, starts at 1, and follows first appearance; no manual display numbers or counter resets
- [ ] Captions are standalone-readable (1–3 sentences)
- [ ] Cross-refs use non-breaking space (`~`)
- [ ] No vertical rules in tables; no `\hline` inside `\toprule`/`\midrule`/`\bottomrule`
- [ ] Author = `AI4S Agent`; `\thanks` footnote present with human-review clause
- [ ] No simulated clause in the `\thanks` (surveys don't claim numerical results)
- [ ] Final compile log: 0 undefined citations, 0 undefined references, 0 overfull boxes (remediate, don't tolerate)
