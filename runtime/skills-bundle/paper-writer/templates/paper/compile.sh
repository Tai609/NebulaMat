#!/bin/bash
set -e

# This script is meant to be run from within the paper output directory
# where main.tex, bibliography.bib, and sections/ already exist.

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
