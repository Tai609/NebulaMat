# report examples

## `manifest.json` — a peer-review-response section

A minimal, self-contained report manifest for one reviewer comment: quoted comment + method line, a **relative-energy** results table (E_ads referenced to gas-phase CO — no total energies), a **top + zoomed-side orthographic** `(a)`/`(b)` model panel, and a same-view **plain + Bader-charge-colored** `(a)`/`(b)` panel.

Build it:

```bash
uv run ../scripts/build_report.py manifest.json -o response.docx
```

The figure paths (`figs/pt4_top_side_panel.png`, `figs/pt4_charge_panel.png`) are placeholders — render real subimages from the relaxed final structure (`CONTCAR` for VASP relaxations, not the initial `POSCAR`) with `__NEBULAMAT_AICC_ROOT__/tools/ovito` (`--view top`/`--view side`, `--projection ortho`, `--color-by` charge), assemble them left-to-right into labeled `(a)`/`(b)` panels with top view on the left and side view on the right, crop or zoom side views to avoid empty vacuum, and drop the panel images next to the manifest. If a figure file is missing the builder still produces the docx, inserts a `[missing figure: ...]` marker, and warns on stderr.

What this example demonstrates (the readiness rules in `../references/validation.md`):
- relative energies with a stated reference state, never bare total energies;
- a charge claim shown *on the structure* (color + colorbar), not as a lone number;
- orthographic top-left + zoomed-side-right model panel from the relaxed final structure;
- same-view plain + Bader-charge-colored panel.
