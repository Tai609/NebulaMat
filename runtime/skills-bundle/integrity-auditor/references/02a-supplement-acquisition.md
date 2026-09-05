# Supplement and Figure Acquisition — Don't Stop at the Paywall

## Why this exists

A surprising number of "paywalled" journal articles are paywalled **only on the article body**. The publisher's CDN serves the supplementary tables, source data, and high-resolution figure images on open endpoints with no authentication. If the auditor stops at the paywall on the main PDF, the audit will under-deliver dramatically. This reference documents the recovery routes.

Empirical case study: `10.1038/s41586-024-08248-5` (Wang Ping, Nature, 2025). Article PDF gated. **All 14 supplementary Excel source-data tables, 3 supplementary PDFs, 5 high-resolution main-figure PNGs, and the Author Correction PDF** were downloadable without login. The +0.3 column anomaly in Fig.4c was re-derived from `MOESM7_ESM.xlsx` directly, exactly as a whistle-blower would have done.

## Nature / Springer Nature endpoints

For a Nature article with DOI `10.NNNN/<jcode>-<year>-<aid>-<suffix>`:

```
# Article landing page (often returns HTML with full abstract + figure captions even when PDF is gated)
https://www.nature.com/articles/<jcode>-<year>-<aid>-<suffix>

# High-resolution main figures (no auth)
https://media.springernature.com/full/springer-static/image/art%3A10.<NNNN>%2F<jcode>-<year>-<aid>-<suffix>/MediaObjects/<jcode_clean>_<year>_<aid_clean>_Fig<N>_HTML.png

# Supplementary files (no auth)
https://static-content.springer.com/esm/art%3A10.<NNNN>%2F<jcode>-<year>-<aid>-<suffix>/MediaObjects/<jcode_clean>_<year>_<aid_clean>_MOESM<N>_ESM.<ext>
```

For the Wang Ping case (`10.1038/s41586-024-08248-5`), the path slug is `41586_2024_8248`. Supplements numbered `MOESM1..MOESM17`; main figures numbered `Fig1..Fig5`. Extensions are typically `.pdf`, `.xlsx`, or `.docx`.

**The simplest way to discover these URLs** is to download the article HTML once and grep:

```bash
curl -sL -A "Mozilla/5.0" "https://www.nature.com/articles/<DOI-suffix>" -o page.html
grep -oE 'https?://[^"]*(MOESM|Fig[0-9]_HTML)\.(?:pdf|xlsx|docx|png)' page.html | sort -u
```

The HTML reliably exposes both the figure CDN paths and the supplementary file paths inline in `<a href>` and `<img src>` attributes, even when the parent article body is gated.

## Author Correction PDFs

Corrections are very often open access even when the parent article is not. Always try:

```bash
curl -sL -A "Mozilla/5.0" "https://www.nature.com/articles/<correction-DOI-suffix>.pdf" -o correction.pdf
file correction.pdf   # must be "PDF document", not HTML
```

If the correction comes down as a real PDF, extract its text. Its prose enumerates which figures the authors themselves admit to needing fixed — directly comparable against the broader investigation finding for `correction-vs-concern-scope` checks (see `references/03-logical-evidence.md` Check 5).

### CRITICAL: the correction's own supplementary often contains pre-correction originals

**Always fetch the correction's supplementary**, separately from the correction PDF itself. Nature corrections that replace figures typically attach an "original Fig.* / original Extended Data Fig.*" PDF as supplementary. This is by far the highest-value artefact for an integrity audit: it contains the **pre-correction** images that the publisher's CDN otherwise overwrote with the corrected versions.

```bash
# Fetch the correction's landing HTML
curl -sL -A "Mozilla/5.0" "https://www.nature.com/articles/<correction-DOI-suffix>" -o correction_page.html
# Grep for the correction's own MOESM supplementary URLs (different DOI prefix from the parent article)
grep -oE 'https?://static-content\.springer\.com/esm/art%3A10\.[0-9]+%2F[^"]+MOESM[0-9]+_ESM\.[a-z]+' correction_page.html | sort -u
# Download each
```

The correction's supplementary is independent of the parent article's MOESMs — these go through a separate DOI namespace (e.g., parent article `10.1038/s41586-024-08248-5` has supplementary numbered `41586_2024_8248_MOESM*`, while its correction `10.1038/s41586-025-09409-w` has its own `41586_2025_9409_MOESM*`).

Empirical baseline (Wang Ping 2025 Nature): the parent article's main figures, served by the CDN, are post-correction. The pre-correction originals are exclusively in the **correction's** `MOESM1_ESM.pdf` (a 5-page PDF labelled "Original Fig. 2, Extended Data Figs. 7, 10"). Without this file, the skill's image-track tools have nothing to bite on. **With this file**, `channel_check.py` independently reproduced the DAPI/Merge label-swap finding the authors had admitted — see `output/integrity-auditor/wang-ping-hdac6-valine-10-1038-s41586-024-08248-5/latest/findings/image/fig2f-original-dapi-merge-swap.md`.

## Other publishers (rough guide)

| Publisher | Article HTML | Open supplementary path |
|---|---|---|
| Springer Nature (Nature family, Sci Reports, BMC, …) | landing HTML usually open | `static-content.springer.com/esm/...` |
| Cell Press (Cell, Cell Reports, …) | landing HTML usually open | linked from page; `els-jbs-prod-cdn.jbs.elsevierhealth.com/...` |
| Elsevier | landing HTML usually open | linked; typically `ars.els-cdn.com/...` |
| Wiley | landing HTML usually open | linked; `agupubs.onlinelibrary.wiley.com/.../suppinfo`; CDN under `onlinelibrary.wiley.com` |
| Oxford UP | landing HTML usually open | `academic.oup.com/.../suppl_data` |
| eLife / PLOS / open-access journals | full article PDF and supplements all open | direct from journal site |
| bioRxiv / medRxiv | preprint PDF and supplements all open | `biorxiv.org/content/.../v<N>.full.pdf`; supplements adjacent |

In all cases, the right pattern is: fetch the landing HTML; grep for `supp`, `MEDIA`, `MOESM`, `mmc`, `pdf`, `xlsx`, `Fig*_HTML` strings; collect every distinct CDN URL exposed; try downloading each.

## What this means for the skill's Step 2

In `SKILL.md` Step 2 ("Gather materials"), the agent should attempt acquisition in this order:

1. **Try the article HTML first**, even before the PDF — `pdftotext` is not the only path to text.
2. **From the HTML, harvest CDN URLs** for figures and supplements; download every one.
3. **Try the Author Correction PDF independently** of the main PDF.
4. **Try the article PDF last**; if gated, the manifest should explicitly say so, and the audit proceeds with whatever was acquired.

A `_paywall_blocked.md` is justified only when **all four** of the above routes return nothing useful. The Wang Ping case demonstrated that the article PDF being gated says nothing about whether the audit can proceed — it routinely can.

## What this means for `references/05-quality-gate.md` G2

G2 ("materials extracted") should accept any of:

- `paper.txt` from a downloaded article PDF, or
- `paper.html` from the article landing page (the abstract, all figure captions, and the supplementary URL list are present), or
- `correction.txt` from the Author Correction PDF, or
- ≥ 1 source-data XLSX in `supplementary/`, or
- ≥ 1 high-resolution figure PNG in `figures_hires/`.

If none of those exist, the audit cannot proceed; write `_paywall_blocked.md` per track. If at least one exists, the audit produces real findings on whatever the acquisition path delivered.

## Anti-patterns

- ✗ Stopping at "Nature redirects to `idp.nature.com`" and concluding the audit is impossible.
- ✗ Not checking the article HTML for CDN links to supplementary files.
- ✗ Assuming "paywalled article" means "paywalled supplementary" — these are often independent.
- ✗ Treating the Author Correction PDF as paywalled without trying to download it.
- ✗ Storing the article HTML in a `panels/` directory (it's text, not pixels) — use `paper.html` and treat it like `paper.txt` for grep.
