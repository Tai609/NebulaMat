# Layout Discipline — Tables, Figures, Floats, Cross-references

## Why this exists

A first draft is usually layout-naive: tables are bare `\begin{tabular}` blocks, figures use `[h]`, and the author block has no disclosure footnote. These choices break in real journal/conference templates and look amateurish even where they don't break. This reference fixes them.

## Tables

### Always wrap in a `table` float

A bare `\begin{tabular}` in body text gets the wrong placement, no caption, no label, and breaks awkwardly across columns. Wrap every table:

```latex
\begin{table}[htbp]
  \centering
  \small                                  % font
  \setlength{\tabcolsep}{4pt}             % column padding
  \caption{Forecast MSE across four benchmarks. Numbers are simulated.}
  \label{tab:main}
  \begin{tabular}{l c c c c}
    \toprule
    Method & ETTm1 & Electricity & Traffic & Weather \\
    \midrule
    DLinear~\cite{zeng2023dlinear} & 0.382 & 0.166 & 0.434 & 0.241 \\
    PatchTST~\cite{nie2023patchtst} & 0.366 & 0.158 & 0.412 & 0.227 \\
    \midrule
    Ours & 0.354 & 0.149 & 0.402 & 0.220 \\
    \bottomrule
  \end{tabular}
\end{table}
```

Two things in this example are provenance-conditional, per `06-experiment-provenance.md` — get them from `results.json`, don't default to what looks best:

- **The caption's disclosure clause** ("Numbers are simulated.") — present whenever `results.json` has `"simulated": true`; drop it (optionally naming the real data source instead) only when the numbers are actually measured.
- **Bolding the winning row** — the template above leaves `Ours` unbolded because the default run mode is simulated, and a bolded win over comparisons you also made up asserts an empirical victory that didn't happen. Only bold when `results.json` is measured (`"simulated": false`) and `Ours` genuinely has the best number in that column.

### Float placement

- **Narrative ownership comes first.** Put the float source immediately after
  the first paragraph that introduces, explains, or interprets it. A mechanism
  figure usually belongs in Method, a dataset/setup table in Experiment, and a
  result plot where its finding is first discussed. These are examples, not
  fixed slots.
- **Preserve first-use order.** Order figure blocks by the prose's first
  `Figure~\ref{...}` references and table blocks by the first
  `Table~\ref{...}` references. Do not collect all floats at a section end.
- `[htbp]` — use for a compact artifact whose meaning depends on nearby prose.
- `[tbp]` — use for a larger artifact that may move to the top, bottom, or a
  float page without breaking the argument.
- `[p]` — use for a full-page or unusually tall artifact.
- `[!t]` is an occasional editorial choice, not a universal default.
- Avoid `[H]`; exact pinning creates white space and brittle pagination.
- This template is **single-column** `article`, so `table*`/`figure*` span nothing extra. For a wide table that overruns the text width, fit it by the ladder in "Font size standard" below — never by `\resizebox`. (Only switch to `table*` if you have actually moved this paper to a two-column class.)

LaTeX may move a float within these legal positions. Judge the rendered paper:
the artifact must remain near its first discussion, must not precede that
discussion, and must not form an unexplained cluster far later in the paper.
If a float crosses into an unrelated section after source order and size have
been corrected, insert `\FloatBarrier` at that semantic boundary. The template
loads `placeins`; use barriers sparingly, never after every float.

### Font size standard (uniform across the paper)

Tables must look like one paper, not a collage. Exactly two sizes are allowed:

- **Default: `\small`** — every table starts here.
- **Wide tables: `\footnotesize`** — only after the structural fitting steps
  below still leave a genuine overrun at `\small`.
- **Never** `\scriptsize`/`\tiny`, and **never wrap a `tabular` in `\resizebox`/`\scalebox`** — scaling picks an arbitrary effective font size per table, which is exactly how one table ends up huge and the next unreadably small.

Fit an over-wide table in this order:

1. Shorten or wrap headers; move units and details into the caption or notes.
2. Use `tabularx` for text columns and `siunitx`/right alignment for numbers.
3. Drop or merge low-value columns, transpose, or split into two tables; move
   secondary detail to an appendix.
4. Tighten `\tabcolsep`, but not below 3 pt.
5. Use `\footnotesize` only if the table still overruns at `\small`.

Never shrink type first. If the table still does not fit at `\footnotesize`,
redesign or split it.

### Style

- **Always use `booktabs`**: `\toprule`, `\midrule`, `\bottomrule`. Never `\hline | \hline`.
- **Don't use vertical rules** (`|` in column spec). Booktabs intentionally omits them.
- **Numbers right-aligned** when comparing magnitudes — column spec `r` or `S` (siunitx).
- **Bold the best per row** with `\textbf{}`. If your method is best in 4/5 columns, bold those 4; don't bold the loss.
- **Footnotes**: use `\multicolumn{N}{l}{\small Notes...}` row at the bottom rather than `\footnote{}` (which doesn't work inside floats).
- **Caption above OR below**: scientific convention is **above** for tables (`\caption{}` before `\begin{tabular}` or just after `\centering`), **below** for figures. The example above puts it above.

### Caption rule

A caption must let a reader who reads only the caption + table understand what's shown. "Results." is not a caption. Aim for 1–3 sentences:

> "MSE on long-horizon forecasting at $H{=}336$ (three-seed mean; lower is better). Bold marks the best per dataset. Numbers are simulated."

## Figures

### Float wrapper

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.95\linewidth]{figures/fig_02_horizon_sweep.pdf}
  \caption{MSE vs.\ forecast horizon on ETTm1. Curves cross around $H{=}192$, illustrating that...}
  \label{fig:horizon_sweep}
\end{figure}
```

### Width

- Single-column layout (current template): `\includegraphics[width=0.85\linewidth]{...}`; wrap TikZ in `\resizebox{\linewidth}{!}{…}`. Never a bare `\includegraphics{file}`.
- `figure*` buys no width here (single column) — only use it after genuinely switching to a two-column class.

### Path

`\includegraphics{figures/<basename>}` — never absolute. Save every figure inside `$RUN/figures/` (i.e., `output/paper-writer/<slug>/latest/paper/figures/`) so the basename resolves.

### Caption

Same standalone-readable rule as tables. Caption goes **below** the figure (after `\includegraphics`, before `\end{figure}`).

### Multi-panel

```latex
\begin{figure}[tbp]
  \centering
  \begin{subfigure}[t]{0.48\linewidth}
    \includegraphics[width=\linewidth]{figures/fig_a.pdf}
    \caption{ETTm1.}
    \label{fig:panel_a}
  \end{subfigure}
  \hfill
  \begin{subfigure}[t]{0.48\linewidth}
    \includegraphics[width=\linewidth]{figures/fig_b.pdf}
    \caption{Electricity.}
    \label{fig:panel_b}
  \end{subfigure}
  \caption{Per-dataset comparison. (a) ETTm1: ... (b) Electricity: ...}
  \label{fig:panel}
\end{figure}
```

The template already loads `subcaption`. Reference panels with `\ref{fig:panel_a}`.

## Cross-references

### Automatic numbering only

Use `\cite{key}`, `\caption` + `\label`, numbered equation environments, and
`\ref`. The template's `unsrtnat` bibliography style numbers references from
`[1]` by order of first citation. Figure, table, equation, section, and
algorithm counters independently start at 1 and advance in source order.

Never:

- type `[17]`, `Figure 4`, or `Table 2` as a substitute for `\cite`/`\ref`;
- put a number such as `Figure 1.` inside a caption;
- use `\tag{7}`, `\setcounter`, or `\addtocounter` to manufacture numbering;
- assume the order of entries in `bibliography.bib` determines citation numbers.

Place `\label` immediately after `\caption` so it captures the float's assigned
number.

### Every label must be referenced

If you `\label{eq:patch}`, refer to it later with `Eq.~\ref{eq:patch}`. Same for `\label{tab:...}`, `\label{fig:...}`, `\label{sec:...}`.

Search:

```bash
grep -oE '\\label\{[^}]+\}' output/paper-writer/<slug>/latest/paper/sections/*.tex | sort -u > /tmp/labels.txt
grep -oE '\\ref\{[^}]+\}' output/paper-writer/<slug>/latest/paper/sections/*.tex | sort -u > /tmp/refs.txt
diff /tmp/labels.txt /tmp/refs.txt
```

Anything in `labels.txt` not in `refs.txt` is a label nobody references. Either add a `\ref` or drop the label.

### Non-breaking spaces

Use `~` not a regular space:

- `Section~\ref{sec:related}`
- `Eq.~\ref{eq:patch}`
- `Table~\ref{tab:main}`
- `Figure~\ref{fig:horizon_sweep}` (or just `Fig.~\ref{...}`)

This prevents the number from floating to the next line away from "Section" / "Eq." / etc.

### Citation tilde

Same logic for citations:

```latex
Building on PatchTST~\cite{nie2023patchtst}, we ...
```

Not:

```latex
Building on PatchTST \cite{nie2023patchtst}, we ...
```

## Author and disclosure footnote

**Author:** the default template uses `\author{AI4S Agent}`. Keep this unless the user has provided a specific author block.

**Always-on disclosure:** every paper produced via this skill must carry a `\thanks` footnote on the author block that
(a) identifies the paper as generated by the AI4S Agent,
(b) recommends human review by a domain expert before any scientific publication or production use,
(c) when results are simulated, additionally flags that the numerical results are simulated.

**Do not** put `\input{simulated}` inside `\title{}` — it can break title formatting. Always attach disclosure to `\author{}` via `\thanks`.

### Real (or partially real) results — minimum disclosure

```latex
\author{AI4S Agent\thanks{This manuscript was generated by the AI4S Agent. \textbf{Human review by a domain expert is strongly recommended} before any scientific publication or production use.}}
```

### Simulated results — extended disclosure

```latex
\author{AI4S Agent\thanks{This manuscript was generated by the AI4S Agent. Numerical results in this version are \textbf{simulated} to demonstrate the paper-generation procedure; replacing them with measurements from the released code is the next step. \textbf{Human review by a domain expert is strongly recommended} before any scientific publication or production use.}}
```

### Why both clauses

- The "human review" clause is **always** present. AI-generated research artefacts can be confidently wrong; an expert in the loop is non-negotiable for any externally facing use.
- The "simulated" clause is added only when results were not measured (e.g., experiment-suite ran in simulation mode). Once real numbers are wired in, drop the simulated clause but keep the human-review clause.

### Optional: banner for high-visibility cases

If the simulated nature must be impossible to miss (e.g., the paper is being shared with non-technical readers), add a banner after `\maketitle` in addition to the `\thanks`:

```latex
\maketitle

\begin{center}
  \fbox{\parbox{0.95\linewidth}{\centering\small\textbf{Notice:} numerical results in this manuscript are simulated for demonstration purposes. Human review is strongly recommended.}}
\end{center}
```

Use the banner sparingly — the `\thanks` footnote is enough for normal cases.

## Common compile errors

### `Citation X undefined`

- The bib_key in `\cite{X}` does not appear in `bibliography.bib`. Check spelling.
- Or you forgot to run `bibtex main` between `pdflatex` passes.
- Compile sequence is: `pdflatex` → `bibtex` → `pdflatex` → `pdflatex` (three latex passes total).

### `Missing $ inserted`

- Math symbol used outside math mode. Wrap with `$...$`.
- Underscore in non-math text: escape with `\_` (e.g., `\textit{my\_var}`).

### `Overfull \hbox`

- A line is wider than the column. Caused by long unbreakable strings (URLs, long bib keys in a `\cite{}` group, equations).
- Fix by: breaking the line, using `\sloppy`, or shortening the offending text.

### `Float too large for page`

- A figure or table is larger than text height/width.
- Figures/TikZ: reduce `width=` or wrap in `\resizebox{\linewidth}{!}{…}`. Tables: use the font-size ladder above (`\footnotesize`, tighter `\tabcolsep`, fewer columns) — not `\resizebox`. `figure*`/`table*` don't help in this single-column template.

### `Underfull \hbox`

- Less serious; usually safe to ignore unless layout looks broken.

### LaTeX failed to compile but PDF exists

- pdflatex returns non-zero on undefined citations even though the PDF is generated.
- When debugging: if `pdflatex` prints an error but still emits `main.pdf`, **still fix the error**. Reviewers see warnings.

## Verification commands

After any compile:

```bash
cd output/paper-writer/<slug>/latest/paper
grep -E "Citation .* undefined" main.log    # must be empty
grep -E "Reference .* undefined" main.log   # must be empty
grep -E "Overfull|Underfull" main.log | head # should be near-empty
ls main.pdf                                  # must exist
pdfinfo main.pdf | grep Pages                # must be ≥ target
```

## Quick checklist

- [ ] Every table wrapped in a float with caption + label, using `booktabs`; placement chosen from narrative need
- [ ] Table fonts uniform: `\small` default, `\footnotesize` for wide ones; no `\resizebox`/`\scalebox` on any `tabular`
- [ ] Every figure wrapped in a float with caption + label; source follows its first discussion instead of a fixed section
- [ ] Citation and object numbering is automatic, starts at 1, and follows first appearance; no manual display numbers or counter resets
- [ ] Captions are standalone-readable (1–3 sentences, not "Results.")
- [ ] Cross-refs use non-breaking space (`~`)
- [ ] Best cell per row bolded; never bold by default
- [ ] No vertical rules in tables; no `\hline` inside `\toprule`/`\midrule`/`\bottomrule`
- [ ] Author = `AI4S Agent`; `\thanks` footnote present with always-on human-review clause; simulated clause added when applicable. Never embed `\input{simulated}` in `\title{}`.
- [ ] Final compile log: 0 undefined citations, 0 undefined references, ≤ a couple of overfull warnings
