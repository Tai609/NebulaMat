#!/bin/bash
set -e

# Run this script from the generated survey directory containing main.tex,
# bibliography.bib, and sections/.

echo "Removing stale LaTeX/BibTeX state..."
rm -f main.aux main.bbl main.blg main.out main.toc main.lof main.lot

echo "First pdflatex run..."
pdflatex -interaction=nonstopmode main.tex

echo "Running bibtex..."
if [ -f bibliography.bib ]; then
    bibtex main
fi

echo "Second pdflatex run..."
pdflatex -interaction=nonstopmode main.tex

echo "Final pdflatex run..."
pdflatex -interaction=nonstopmode main.tex

echo "Compilation complete. PDF: main.pdf"
