# Gaussian Resources

> Load this when: a question is not covered by the local references. Consult the linked source, then distill the answer back into the relevant topical file instead of adding a loose note.

## Official / authoritative

- **Gaussian keyword reference** — https://gaussian.com/keywords/ — authoritative syntax and options for `Opt`, `Freq`, `SCF`, `IRC`, `SCRF`, `TD`, `Gen/GenECP`, `Counterpoise`, `Pop`, `NMR`, `Polar`, etc.
- **Gaussian 16 documentation / capabilities** — https://gaussian.com/gaussian16/ — version capabilities, release notes, parallel/GPU notes, utility programs.
- **Gaussian citation page** — https://gaussian.com/citation/ — cite the exact revision used; also cite method papers when the calculation type requires it.
- **Gaussian utilities** — `formchk`, `chkchk`, `cubegen`, `cubman`, `freqchk`, `newzmat`; see local `properties-utilities.md` before using them.
- **Basis Set Exchange** — https://www.basissetexchange.org/ — source for custom `Gen`/`GenECP` basis and ECP blocks. Record basis source/version when pasted.

## Sobereva practitioner references

- **Sobereva article index** — http://sobereva.com/list.html — use HTTP if HTTPS fails. Search by Gaussian, G16, G09, GaussView, SCF, basis set, ECP, functional, DFT-D, dispersion, solvent, TS, IRC, TDDFT, and Multiwfn.
- **Overused Gaussian keywords** — http://sobereva.com/331 — use for route minimalism: avoid boilerplate `sp`, `scf=tight`, `scf=maxcyc`, `freq=noraman`, arbitrary `IOp`, and habitual `nosymm`.
- **SCF convergence** — http://sobereva.com/61 and http://sobereva.com/625 — use when `SCF` failure is not explained by local `scf-stability.md` / `errors.md`.
- **Gaussian energy reading** — http://sobereva.com/488 — use when extracting post-HF, double-hybrid, TDDFT, or thermochemical energies.
- **Optimization/frequency/imaginary modes** — http://sobereva.com/278, http://sobereva.com/387, http://sobereva.com/106 — use for small imaginary modes, same-level Opt/Freq discipline, and frequency-mode interpretation.
- **TS/IRC/scans** — http://sobereva.com/460, http://sobereva.com/400, http://sobereva.com/44, http://sobereva.com/474, http://sobereva.com/571 — use for TS guesses, QST2/QST3 caveats, IRC and downhill-path issues.
- **Basis/ECP/BSSE** — http://sobereva.com/336, http://sobereva.com/60, http://sobereva.com/373, http://sobereva.com/46, http://sobereva.com/381 — use for basis selection, mixed basis, ECP pairing, and counterpoise caveats.
- **DFT functional / dispersion / solvent** — http://sobereva.com/272, http://sobereva.com/210, http://sobereva.com/413, http://sobereva.com/327, http://sobereva.com/550, http://sobereva.com/344 — use for functional choice, DFT-D, SMD/PCM, and custom functional pitfalls.
- **TDDFT / spectra** — http://sobereva.com/314, http://sobereva.com/348, http://sobereva.com/659, http://sobereva.com/411 — use for excited-state workflows, large state counts, fchk size, and spin-orbit coupling handoff.
- **Formats / visualization** — http://sobereva.com/55, http://sobereva.com/125, http://sobereva.com/253, http://sobereva.com/567, http://sobereva.com/568, http://sobereva.com/289 — use for fchk/wfn/cube, GaussView, VMD, and coordinate/orientation issues.

## Community / tooling

- **Joaquín Barroso's blog** — https://joaquinbarroso.com/ — community catalogue of Gaussian error terminations and fixes; useful when an exact link/error is not in local `errors.md`.
- **CCL archives** — http://www.ccl.net/ — practitioner Q&A across Gaussian versions; use when official docs and local references are insufficient.
- **cclib** — https://cclib.github.io/ — parser library if local scripts need orbital, spectra, or excited-state data not yet extracted.

## Repo policy

Do not commit external manuals, full tutorial articles, licensed documentation, large `.chk`/`.cube`/`.wfx` files, or generated images. Distill repeated workflows into the appropriate local topical reference and cite/link the external source.
