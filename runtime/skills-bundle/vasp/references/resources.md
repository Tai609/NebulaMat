# VASP Resources

> Load this when: a question isn't covered by the local references — then fetch/consult the linked source and consider distilling the answer back into the appropriate reference file.

- **VASP wiki** — https://www.vasp.at/wiki/ — the authoritative reference for every INCAR tag, with physics context. First stop for any tag question; the per-tag pages (e.g. ISMEAR, LDAUU, IBRION) include defaults and interactions between tags.
- **VASP manual / documentation portal** — https://www.vasp.at/documentation/ — release notes matter when behavior differs between versions (5.x vs 6.x symmetry errors, ML-FF features).
- **VASP forum** — https://www.vasp.at/forum/ — searchable history of error reports; good when an error string isn't in our errors.md.
- **VTST tools** — https://theory.cm.utexas.edu/vtsttools/ — climbing-image NEB, dimer method, and helper scripts. VTST requires a VASP build compiled with the VTST patches; record the site's VTST-enabled module/binary and script paths in the private cluster guide.
- **Bader analysis code** — https://theory.cm.utexas.edu/henkelman/code/bader/ — usage and the AECCAR workflow our charge-analysis setup targets.
- **LOBSTER / COHP** — bonding analysis from a VASP wavefunction is its own skill: see `__NEBULAMAT_AICC_ROOT__/tools/lobster` (operation) and `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md` (science); program at http://www.cohp.de/.
- **Materials Project docs** — https://docs.materialsproject.org/methodology/ — the source of the GGA+U values and parameter conventions cited in u-values-magmom.md; consult when matching MP-derived data.
- **pymatgen VASP IO** — https://pymatgen.org/pymatgen.io.vasp.html — programmatic input generation and output parsing beyond our scripts.
- **NIST-JANAF thermochemical tables** — https://janaf.nist.gov/ — gas-phase thermochemistry for chemical potentials and free-energy corrections; reconcile table conventions with DFT reference energies before use.
- **VASPsol** — https://github.com/henniggroup/VASPsol — original implicit solvation/electrolyte implementation for VASP; includes `LSOL`, `EB_K`, `LAMBDA_D_K`, and `FERMI_SHIFT` usage notes.
- **VASPsol++** — https://github.com/VASPsol/VASPsol/ — nonlinear/nonlocal implicit electrolyte model and constant-potential calculations with `ISOL=2` and `EFERMI_ref`.
- **Wulff construction background** — https://en.wikipedia.org/wiki/Wulff_construction — geometry relation between facet distance and surface energy; use computed facet energies as input, not as validation.

When adding a manual excerpt's knowledge here, paraphrase into the topical reference file with a link — do not commit copyrighted manual PDFs to the repo.
