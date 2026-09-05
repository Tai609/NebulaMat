# Section-by-Section Rewrite Playbook

## Why this exists

Step 3 of the skill is "rewrite each section into research prose". That instruction in one line is too thin: research prose is not just longer prose, it is structured prose with conventions readers expect. This reference gives a per-section playbook with required content, length, structure, citation density, and concrete cross-reference patterns.

## Universal rules

- Every section starts with `\section{Title}\label{sec:slug}`.
- Cross-references between sections use `Section~\ref{sec:slug}` (non-breaking space to avoid line breaks).
- Inline citations: `~\cite{key}` for textual flow, `\citep{key}` if using
  natbib parenthetical style. The template uses numeric citations and
  `unsrtnat`, so references begin at `[1]` and advance by first citation.
- Equations: `\begin{equation} ... \end{equation}` for numbered, `$...$` for inline. Reference with `Eq.~\ref{eq:slug}`.
- Tables and figures: see `04-layout-discipline.md`.
- One topic per paragraph. If a paragraph is doing two things, split it.
- Use first-person plural ("we") consistently. Avoid "the authors".
- Prefer specific over generic verbs: "we patch", "we decompose", "we ablate" — not "we use" or "we apply".

## Abstract — `sections/abstract.tex`

**Length:** 150–250 words. **Citations:** 0 by default. Keep the abstract
self-contained; cite there only when the target venue explicitly permits or
requires it.

**Structure (one paragraph):**
1. **Domain & motivation** (1 sentence): what the paper is about and why anyone should care.
2. **Status of the field** (1–2 sentences): what's been tried and where it landed, without turning the abstract into related work.
3. **Tension / unresolved question** (1 sentence): what remains debated or unsolved.
4. **Approach** (1–2 sentences): your contribution at a high level. Name the technical idea.
5. **Headline result** (1 sentence): the strongest concrete claim ("matches X on Y benchmarks while reducing compute by Z%").
6. **Disclosure** (if simulated): one sentence flagging that results are simulated and how to reproduce.

**Anti-patterns:**
- Starting with "In recent years…" — instant downgrade.
- No numbers in the headline result.
- Burying the contribution under generic background.
- Spillover into related work (the abstract is not a tour of the literature).

## Introduction — `sections/introduction.tex`

**Length:** 3–4 paragraphs (~600–900 words). **Citations:** 12–20.

**Structure:**

**Paragraph 1 — Problem frame.** Why is this problem important? Use 2–3 application motivations and 1 quantitative anchor (market size, scale, frequency). Cite classical/foundational references.

**Paragraph 2 — First wave of solutions.** The dominant approach when the field opened up. 4–6 citations grouped thematically, with prose that distinguishes them ("Informer~\cite{...} introduced ProbSparse attention; Autoformer~\cite{...} replaced attention with auto-correlation"; etc.).

**Paragraph 3 — Tension or shift.** The problem with the first wave or the new direction. Cite the rebuttal / follow-on work. This paragraph is where the paper's motivation crystallises.

**Paragraph 4 — Contributions and roadmap.** Three lettered or italicized contributions:

```latex
\emph{First}, we ...
\emph{Second}, we ...
\emph{Third}, we ...

The remainder of the paper is organized as follows. Section~\ref{sec:related}
reviews related work. Section~\ref{sec:method} develops ...
```

**Anti-patterns:**
- 5+ paragraphs that wander before reaching the contribution.
- No clear contribution list — readers should see "First / Second / Third" or numbered bullets.
- Promising experiments not delivered later.
- Citations that don't differentiate ("Many works have addressed this~\cite{a, b, c, d}").

## Related Work — `sections/related_work.tex`

**Length:** 3–5 themed `\paragraph{}` subsections (~700–1200 words). **Citations:** 30–60 here alone.

**Structure:** Each `\paragraph{Theme.}` covers one slice of the literature, ending with a sentence that locates your work within it.

```latex
\section{Related Work}
\label{sec:related}

\paragraph{Classical and recurrent baselines.}
[2–4 sentences with 4–8 citations. End by saying how your work relates.]

\paragraph{Efficient attention for long horizons.}
[Distinct sub-theme. 4–8 citations.]

\paragraph{Decomposition and frequency views.}
[Distinct sub-theme. 4–8 citations.]

\paragraph{Re-examining the role of attention.}
[The contrarian / counter-evidence thread.]

\paragraph{Universal and surveyed views.}
[Foundation models, surveys, taxonomies.]
```

**Themes to consider** (pick 3–5 that suit your topic):
- Classical / pre-deep-learning baselines
- The architectural family the paper extends
- Adjacent / rival paradigms (LSTM vs. Transformer; attention vs. linear)
- Application domain prior art
- Empirical / benchmark studies
- Foundation models / pre-train-and-adapt
- Theoretical analyses
- Surveys

**Anti-patterns:**
- Chronological dump ("In 2017, Vaswani… In 2018, Liu… In 2019…").
- Unstructured wall of `\cite{a,b,c,d,e,f,g}` — cite groups of 2–4 with prose that distinguishes them.
- Failing to position your work — every theme should end with "we follow / extend / depart from".
- Treating Related Work as bibliography vomit. The reader should learn the structure of the field, not just see who exists.

## Method — `sections/method.tex`

**Length:** 4–6 `\paragraph{}` subsections (~600–1200 words). **Citations:** 4–8. **Equations:** ≥ 2 numbered.

**Structure:**

**Paragraph — Problem setup.** Notation. Define inputs ($\mathbf{X}_{1:L} \in \mathbb{R}^{L \times C}$), outputs, the loss. Establish symbols you'll reuse.

**Paragraphs — Components.** One paragraph per component of the architecture, each ending with an equation or a precise specification. Examples (adapt to your topic):
- Tokenisation / encoding
- Core attention or alternative
- Decomposition / normalisation / regularisation
- Output head

**Paragraph — Training.** Optimizer, schedule, early-stopping criterion, hyperparameter search budget, hardware. Be specific enough that a reader could replicate.

**Paragraph — Complexity.** Time and memory in big-O for the operations introduced, with concrete numbers for typical settings.

**Equations:** at least 2, numbered. Examples:

```latex
\begin{equation}
  \mathbf{z}_n^{(c)} = \mathbf{W}_e\,\mathbf{X}_{nS:nS+P}^{(c)} + \mathbf{p}_n.
  \label{eq:patch}
\end{equation}
```

Reference them: "Eq.~\ref{eq:patch} defines the patch embedding."

**Symbol rule (mandatory):** immediately after every equation, define each symbol that has not been defined earlier in the paper — a "where ..." sentence: "where $\sigma$ is the sigmoid activation, $\mathbf{W}_1, \mathbf{W}_2$ are learned projections, and $\mathbf{b}_1, \mathbf{b}_2$ are biases." Each symbol is defined exactly once, at first use; later equations reuse it without re-explanation. Before finishing the section, scan every equation and check that no operator, variable, or index appears without a prior definition (including "obvious" ones like $\sigma$, $\odot$, $\Vert$).

**Anti-patterns:**
- Pure prose with no equations — for a methods paper, that's incomplete.
- Equations without reference — if you don't refer to it later, why was it numbered?
- An equation introducing symbols ($\sigma$, $\odot$, subscripts) that the surrounding prose never defines.
- Pseudocode dumped via `algorithm` without prose context.
- Hyperparameter list without justification ("we set $d=128$" with no rationale).
- Vague language: "we train using standard practice". Standard *what* practice? Specify.

## Experimental Setup — `sections/experiment.tex`

**Length:** 4 `\paragraph{}` subsections (~400–700 words). **Citations:** 5–10.

**Structure:**

**Paragraph — Datasets.** Each dataset: name, brief description, scale, train/val/test split. Cite the dataset paper if applicable.

**Paragraph — Baselines.** Group by family (linear, recurrent, vanilla Transformer, efficient Transformer, foundation model). Cite each. Briefly note any baseline you skipped and why.

**Paragraph — Metrics & protocol.** Metrics, seeds, hyperparameter selection budget (must match across all models for fair comparison), hardware, software stack. Cite related protocol-aware surveys if you're following a particular convention.

**Paragraph — Disclosure (if simulated).** Plain statement that the numbers in the next section are simulated, the specific code path used to generate them, and that production runs must replace them.

Place dataset summaries, protocol tables, or setup diagrams here when this is
where the prose first needs them. Do not postpone them to Results merely to
match a template.

**Anti-patterns:**
- Skipping seeds / variance ("we report a single run").
- Selectively reporting baselines without justification.
- Unfair budgets (your method gets 100 trials of HPO, baselines get 10).
- Missing hardware spec — readers should be able to estimate compute.

## Results — `sections/results.tex`

**Length:** main comparison + ablation + visual + analysis (~700–1200 words). **Citations:** 5–10.

**Structure:**

**Paragraph — What this section answers.** 2–3 questions you'll answer. Tells the reader what to look for.

**Subsection / paragraph — Main comparison.** Compare all relevant baselines
and datasets. A table is usually effective, but place its float immediately
after the paragraph that first interprets it and choose placement per
`04-layout-discipline.md`. Summarise what is interesting (top performer, where
the gap is largest, surprises). 5–8 sentences.

**Subsection / paragraph — Ablation.** Use a smaller table or plot when the
evidence supports a component analysis. Prose explains which component carries
the weight. 4–6 sentences.

**Subsection / paragraph — Visual / qualitative.** When useful, use a figure
that shows what prose or a table cannot (per-horizon trend, scaling, attention
map, error breakdown). Reference with `\ref{fig:...}`.

**Subsection / paragraph — Caveats / when not to use.** Honest paragraph noting where the method does *not* help (small data, weak periodicity, etc.). This builds trust.

Figures and tables are paper-level evidence, not section quotas. Results often
owns quantitative comparisons, but each artifact belongs wherever it is first
interpreted. Use `booktabs`, captions, labels, and automatic numbering.

**Anti-patterns:**
- "Our method is better." — without saying by how much, on what, against whom.
- Tables without captions or with one-line captions ("Results"). Caption should stand alone.
- Bolding the wrong cells (always **bold the best per row**, not your method by default).
- Hiding the cases where your method loses.

## Conclusion — `sections/conclusion.tex`

**Length:** 2–3 paragraphs (~250–450 words). **Citations:** 4–8.

**Structure:**

**Paragraph — Summary.** What you did, in one paragraph, in different words from the abstract.

**Paragraph — Future work.** 2–3 concrete threads. Each should name the open question and one approach. Cite the relevant work each thread builds on.

**Paragraph — Limitations / honest scope.** What this paper does *not* claim. Which audience or regime it doesn't help. Reviewers respect this; absence of it raises suspicion.

**Anti-patterns:**
- Re-stating the abstract verbatim.
- Vague future work ("future work will explore extensions").
- Never admitting limitations.
- Restating contributions as a bullet list (you already had them in §1).

## Cross-section discipline

When the introduction promises a structure, deliver it:

- Introduction §1.4 says "Section~\ref{sec:related} reviews related work" → the rest of the paper must satisfy it.
- Method introduces $\hat{\mathbf{X}}_{L+1:L+H}$ → Results table column headers should match the same notation.
- Experiment names datasets → Results refers to them by the same names.
- Equations defined in Method are referenced from Results / Conclusion if the analysis depends on them.

A paper that breaks these promises feels disjointed even if every section is individually fine.

## Quick checklist

- [ ] Each section has `\section{}\label{sec:...}` and is referenced from at least one other section.
- [ ] Abstract: one self-contained paragraph with no citations unless the target venue explicitly requires them; headline result with numbers.
- [ ] Introduction: 12–20 cites; 3–4 paragraphs; explicit "First / Second / Third" contributions.
- [ ] Related Work: 30–60 cites; themed `\paragraph{}`; each theme positions the paper.
- [ ] Method: 4–8 cites; ≥ 2 numbered equations; explicit complexity statement.
- [ ] Experiment: 5–10 cites; datasets / baselines / protocol / disclosure.
- [ ] Results: 5–10 cites; interprets the available comparison, ablation, or qualitative evidence without fixed artifact quotas; includes a caveat paragraph.
- [ ] Conclusion: 4–8 cites; summary / future / limitations.
- [ ] Notation consistent across sections.
- [ ] First-person plural ("we") throughout.
