# LAMMPS Resources

> Load this when: a question isn't covered by the local references — consult the linked source, then distill the answer back into the topical file.

- **LAMMPS manual** — https://docs.lammps.org/ — per-command pages are authoritative (every fix/pair_style/compute documents its units and restrictions); the "Howto" section covers common setups (slabs, walls, restarts).
- **MatSci forum (LAMMPS category)** — https://matsci.org/c/lammps/ — the official support channel; searchable for error strings.
- **NIST Interatomic Potentials Repository** — https://www.ctcms.nist.gov/potentials/ — curated EAM/MEAM/Tersoff... potentials with provenance and fitted-property documentation.
- **OpenKIM** — https://openkim.org/ — potentials with standardized verification tests; the KIM API works directly as a LAMMPS pair style.
- **LAMMPS GitHub** — https://github.com/lammps/lammps — for build issues and recent bug fixes.
- **DeePMD-kit LAMMPS docs** — https://docs.deepmodeling.com/projects/deepmd/ — `pair_style deepmd` usage and model-deviation output.
- **MACE docs** — https://mace-docs.readthedocs.io/ — LAMMPS interface (`mace_create_lammps_model`) and foundation models.

Force-field/potential files: record name, version, source URL, and fitted scope in the run's provenance; do not commit licensed parameter files.
