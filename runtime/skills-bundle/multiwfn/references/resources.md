# Multiwfn Resources

> Load this when: local Multiwfn notes are insufficient and you need the manual, official examples, Sobereva tutorials, or visualization/toolchain references.

## Official / primary

- **Multiwfn homepage and downloads** — http://sobereva.com/multiwfn/ — use the executable and manual version that match each other.
- **Multiwfn manual** — use the version shipped with the installed executable; menu numbers and capabilities can differ across releases.
- **Multiwfn examples bundled with the distribution** — use these first when validating a menu path or output format.

## Sobereva tutorial index

- **Sobereva article index** — http://sobereva.com/list.html — use HTTP if HTTPS fails. Search terms: Multiwfn, wavefunction analysis, NTO, hole-electron analysis, NCI, IRI, ELF, LOL, AIM, Laplacian, ESP, charge analysis, spin density, UV, ECD, VMD, cube, fchk, wfn.
- **Gaussian fchk/wfn conversion** — http://sobereva.com/55 — use when deciding whether `.fchk`, `.wfn`, or `.wfx` is the correct input.
- **Cube files** — http://sobereva.com/125 — use for cube format, orbital/density/ESP grids, and VMD handoff.
- **Multiwfn polarizability / hyperpolarizability analysis** — http://sobereva.com/231 — use when Gaussian property output needs Multiwfn post-processing.
- **Gaussian/GaussView ESP plots** — http://sobereva.com/253 — useful for quick comparison with Multiwfn-generated ESP surfaces.
- **VMD force/vector and vibration visualization from Gaussian** — http://sobereva.com/567 and http://sobereva.com/568 — use when cube/vector rendering leaves Multiwfn and enters VMD.

## Related toolchain

- **VMD** — https://www.ks.uiuc.edu/Research/vmd/ — render cube isosurfaces, density differences, ESP-mapped surfaces, vectors, and animations.
- **Gaussian utilities** — `formchk`, `cubegen`, `cubman` — generate or manipulate inputs for Multiwfn; see `__NEBULAMAT_AICC_ROOT__/tools/gaussian/references/properties-utilities.md`.
- **cclib** — https://cclib.github.io/ — useful parser library when a script needs structured excited-state/orbital data before Multiwfn plotting.

## Repo policy

Do not commit external manuals, large cube files, binary checkpoints, screenshots, or bulky VMD render outputs. Distill stable local workflows into `references/running.md` or `references/orbital-charge-spectra.md`; keep large artifacts outside the repo and record their provenance.
