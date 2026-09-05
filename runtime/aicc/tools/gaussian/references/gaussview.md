# GaussView Notes for Gaussian Workflows

> Load this when: a Gaussian molecular model is built in GaussView, fragments must be assigned, or Gaussian output needs a quick visual inspection. For Multiwfn analysis, use `__NEBULAMAT_AICC_ROOT__/tools/multiwfn/SKILL.md`.

This file is intentionally narrow: GaussView is treated as a builder/inspector, not as the source of scientific method choices. Wavefunction analysis belongs in `__NEBULAMAT_AICC_ROOT__/tools/multiwfn/`; figure standards live in `__NEBULAMAT_AICC_ROOT__/knowledge/scientific-visualization.md`.

## Model-building rules

- Use GaussView for building, inspecting, assigning fragments, and quick visualization; do not rely on it to choose method, basis, solvent, or spin state.
- Save the model as `.gjf`, then manually inspect/edit the route section, charge/multiplicity, solvent, dispersion, and blank lines.
- Remove `geom=connectivity` and the connectivity block unless the job actually needs connectivity.
- Bond display in GaussView is heuristic. Gaussian calculations use coordinates; displayed bond orders are not evidence of bonding.
- Avoid paths with spaces or non-ASCII characters when moving jobs between Windows/Linux/HPC.

## Fragment setup

For counterpoise or fragment guesses, use GaussView's atom-group/fragment tools, then inspect the generated text:

```text
0 1  0 1  0 1
N(Fragment=1) ...
H(Fragment=1) ...
O(Fragment=2) ...
H(Fragment=2) ...
```

Fragment numbers for `counterpoise` and `guess=fragment` should start at 1 and be consecutive. Verify fragment charge/multiplicity pairs on the charge line.

## Checkpoint handoff

- Preserve `.log` and `.chk` for every important job.
- Convert binary checkpoint files before cross-platform visualization or Multiwfn analysis:

```bash
formchk job.chk job.fchk
```

- Use `__NEBULAMAT_AICC_ROOT__/tools/multiwfn/` for orbital/NTO/spin-density/charge/spectrum analyses. Gaussian/GaussView only prepares or inspects the files.

## Quick visualization limits

- GaussView MO isosurfaces are useful for inspection, but report-ready figures need recorded isovalue, color convention, orbital/state number, and input file provenance.
- Canonical MOs are often delocalized and may not map cleanly to textbook bonds. Use Multiwfn/NTO/spin-density/density-difference analysis when the claim requires interpretation.
