#!/usr/bin/env python3
"""Open Science — PDF text + claim extractor for the traceability reviewer (P0-4).

The reviewer audits *traceability*: citations that resolve, numbers with a
source, figures consistent with code. For a PDF manuscript it first needs the
text and the concrete identifiers/claims — this extracts them deterministically
so the reviewer never guesses a DOI or a statistic from the model's memory.

Tries several PDF backends (whichever is installed) and degrades to a clear
message if none is: PyMuPDF (`fitz`) → `pypdf` → `PyPDF2` → `pdfminer.six`.

Usage:
    python pdf_extract.py MANUSCRIPT.pdf [--max-chars N]
Output: one JSON object on stdout — {backend, pages, chars, citations, claims, text}.
"""
from __future__ import annotations

import json
import re
import sys


def extract_text(path: str) -> tuple[str, str, int]:
    """Return (full_text, backend_name, page_count) using the first backend
    that imports. Raises RuntimeError if none is available."""
    # PyMuPDF — best layout fidelity.
    try:
        import fitz  # type: ignore

        doc = fitz.open(path)
        text = "\n".join(page.get_text() for page in doc)
        return text, "pymupdf", doc.page_count
    except ImportError:
        pass
    except Exception as e:  # corrupt/protected PDF
        raise RuntimeError(f"pymupdf failed: {e}") from e

    for modname, attr in (("pypdf", "PdfReader"), ("PyPDF2", "PdfReader")):
        try:
            mod = __import__(modname)
            reader = getattr(mod, attr)(path)
            pages = reader.pages
            text = "\n".join((p.extract_text() or "") for p in pages)
            return text, modname.lower(), len(pages)
        except ImportError:
            continue
        except Exception as e:
            raise RuntimeError(f"{modname} failed: {e}") from e

    try:
        from pdfminer.high_level import extract_text as pm_extract  # type: ignore

        text = pm_extract(path)
        return text, "pdfminer", text.count("\f") + 1
    except ImportError:
        pass
    except Exception as e:
        raise RuntimeError(f"pdfminer failed: {e}") from e

    raise RuntimeError(
        "no PDF backend installed — install one of: pymupdf, pypdf, PyPDF2, pdfminer.six"
    )


# --------------------------------------------------------------------------- #
# Citation identifiers + quantitative claims (deterministic regexes)
# --------------------------------------------------------------------------- #

_DOI = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+")
_ARXIV = re.compile(r"arXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)", re.IGNORECASE)
_ARXIV_OLD = re.compile(r"\b([a-z-]+(?:\.[A-Z]{2})?/\d{7})\b")
_PMID = re.compile(r"PMID:?\s*(\d{1,9})", re.IGNORECASE)

_CLAIM_PATTERNS = [
    ("p_value", re.compile(r"\bp\s*[<=>]\s*0?\.\d+", re.IGNORECASE)),
    ("percent", re.compile(r"\b\d+(?:\.\d+)?\s?%")),
    ("sample_size", re.compile(r"\bn\s*=\s*\d+", re.IGNORECASE)),
    ("ci", re.compile(r"\b\d+\s?%\s*(?:CI|confidence interval)", re.IGNORECASE)),
]


def _clean_doi(d: str) -> str:
    return d.rstrip(".,;)]}")


def _context(text: str, start: int, end: int, width: int = 60) -> str:
    a = max(0, start - width)
    b = min(len(text), end + width)
    return re.sub(r"\s+", " ", text[a:b]).strip()


def find_citations(text: str) -> dict:
    dois = sorted({_clean_doi(m.group(0)) for m in _DOI.finditer(text)})
    arxiv = sorted(
        {m.group(1) for m in _ARXIV.finditer(text)}
        | {m.group(1) for m in _ARXIV_OLD.finditer(text)}
    )
    pmids = sorted({m.group(1) for m in _PMID.finditer(text)})
    return {"dois": dois, "arxiv": arxiv, "pmids": pmids}


def find_claims(text: str, cap: int = 100) -> list[dict]:
    out: list[dict] = []
    seen: set[tuple[str, int]] = set()
    for kind, pat in _CLAIM_PATTERNS:
        for m in pat.finditer(text):
            key = (kind, m.start())
            if key in seen:
                continue
            seen.add(key)
            out.append({"kind": kind, "text": m.group(0).strip(), "context": _context(text, m.start(), m.end())})
            if len(out) >= cap:
                return out
    return out


def run(path: str, max_chars: int) -> dict:
    try:
        text, backend, pages = extract_text(path)
    except RuntimeError as e:
        return {"error": str(e)}
    return {
        "backend": backend,
        "pages": pages,
        "chars": len(text),
        "citations": find_citations(text),
        "claims": find_claims(text),
        "text": text if len(text) <= max_chars else text[:max_chars] + "\n…[truncated]",
    }


def main(argv: list[str]) -> int:
    args = argv[1:]
    max_chars = 20000
    if "--max-chars" in args:
        i = args.index("--max-chars")
        try:
            max_chars = int(args[i + 1])
            del args[i : i + 2]
        except (ValueError, IndexError):
            print(json.dumps({"error": "--max-chars needs an integer"}))
            return 2
    if not args:
        print(json.dumps({"error": "usage: pdf_extract.py MANUSCRIPT.pdf [--max-chars N]"}))
        return 2
    print(json.dumps(run(args[0], max_chars), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
