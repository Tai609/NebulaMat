# GROMACS Resources

> Load this when: local references do not cover an option, version change, force field, analysis command, or exact error string.

Prefer the documentation for the installed GROMACS version. The `/current/` links resolve to the latest release; use the version selector for reproductions.

## Official documentation

- Main manual: https://manual.gromacs.org/current/
- System preparation: https://manual.gromacs.org/current/user-guide/system-preparation.html
- `.mdp` options: https://manual.gromacs.org/current/user-guide/mdp-options.html
- Command-line reference: https://manual.gromacs.org/current/user-guide/cmdline.html
- Topology file formats: https://manual.gromacs.org/current/reference-manual/topologies/topology-file-formats.html
- Force fields in GROMACS: https://manual.gromacs.org/current/user-guide/force-fields.html
- Analysis reference: https://manual.gromacs.org/current/reference-manual/analysis/analysis.html
- Managing long simulations/checkpoints: https://manual.gromacs.org/current/user-guide/managing-simulations.html
- Runtime errors: https://manual.gromacs.org/current/user-guide/run-time-errors.html
- Performance guidance: https://manual.gromacs.org/current/user-guide/mdrun-performance.html
- Release notes: https://manual.gromacs.org/current/release-notes/index.html

Version-sensitive command pages used by this skill:

- `gmx grompp`: https://manual.gromacs.org/current/onlinehelp/gmx-grompp.html
- `gmx mdrun`: https://manual.gromacs.org/current/onlinehelp/gmx-mdrun.html
- `gmx hbond`: https://manual.gromacs.org/current/onlinehelp/gmx-hbond.html
- `gmx hbond-legacy`: https://manual.gromacs.org/current/onlinehelp/gmx-hbond-legacy.html
- `gmx dssp`: https://manual.gromacs.org/current/onlinehelp/gmx-dssp.html

Installed-command help is authoritative:

```bash
gmx --version
gmx help <command>
gmx <command> -h
gmx <command> -h -hidden
```

## Support and training

- GROMACS user forum: https://gromacs.bioexcel.eu/
- GROMACS source and issue tracker: https://gitlab.com/gromacs/gromacs
- BioExcel GROMACS training: https://tutorials.gromacs.org/

When asking for help, provide exact version, full command, fatal/warning text, minimal `.mdp`, topology include chain, and whether the issue survives a small reproducible system. Do not paste licensed force-field files or confidential structures.

## Force fields and parameterization

Use the primary force-field distribution/documentation and original parameter papers for the selected family. Record version/date/source and water/ion compatibility. File-format support does not imply scientific compatibility.

Entry points:

- Short how-to index: https://manual.gromacs.org/current/how-to/index.html
- Adding a residue/topology: https://manual.gromacs.org/current/how-to/topology.html

## Enhanced sampling and interoperability

- Pull code / PMF: https://manual.gromacs.org/current/reference-manual/special/pulling.html
- AWH: https://manual.gromacs.org/current/reference-manual/special/awh.html
- PLUMED integration: https://manual.gromacs.org/current/reference-manual/special/plumed.html
- gmxapi: https://manual.gromacs.org/current/gmxapi/index.html

Use the external package's own versioned manual for package-specific inputs and cite both GROMACS and the external method/software.

## VMD

- VMD home/manual: https://www.ks.uiuc.edu/Research/vmd/
- VMD atom-selection language: https://www.ks.uiuc.edu/Research/vmd/current/ug/node89.html

VMD distance selections are normally in angstrom; GROMACS native lengths are nm.
