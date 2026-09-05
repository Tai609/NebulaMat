#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["ovito"]
# ///
"""Render a structure or trajectory frame with OVITO.

Run with `uv run ovito_render.py ...` so the dependency above resolves into an
isolated, cached environment (no global install needed).

Model figures for a report use the relaxed final structure. For VASP relaxation
products, render CONTCAR rather than the input POSCAR unless POSCAR is explicitly a
copy of the final CONTCAR. They are an ORTHOGRAPHIC top + zoomed/cropped side
two-panel figure (never perspective). Render the subimages first, then assemble them
left-to-right as "(a) top" and "(b) side":
    uv run ovito_render.py CONTCAR top.png  --view top
    uv run ovito_render.py CONTCAR side.png --view side

Prefer BALL-AND-STICK for model figures (`--ball-stick`): clearer than filled
spheres for showing which atom is which and how they bond.

To show a per-atom quantity (e.g. Bader charge) on the structure, give the
particle-property name with --color-by; a colorbar legend is added:
    uv run ovito_render.py charges.xyz side.png --view side --color-by Charge --ball-stick
For a CHARGE map the default colormap is diverging **red-white-blue**
(red = positive, white = 0, blue = negative) with a symmetric range about 0, so
the sign is read directly. Label the decisive atoms with their value on the
image with --label-elems (element symbols, comma-separated):
    ... --color-by Charge --label-elems Fe,O
which draws e.g. "Fe +0.88" next to each labeled atom so the viewer sees which atom
is which and its charge. When two labeled atoms project to the same spot, only the
front one is labeled (the occluded label is dropped, not drawn as overlapping
garble) — pick a view where the decisive atoms are separated; the top+side pair
usually suffices.

For a charge-colored figure pass --paired-plain to ALSO write a companion render
of the SAME view with normal element colors (no ColorCoding, no colorbar). Assemble
the plain and charge renders as one "(a) plain" / "(b) charge" panel so a reader
can map the charge colors back to the actual atoms. The companion path is the
output with "_plain" before the extension (e.g. q_side.png -> q_side_plain.png);
the view, projection, ball-stick setting and --label-elems labels are kept:
    ... --color-by Charge --ball-stick --label-elems Fe,O --paired-plain
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

# named views -> orthographic standard cameras; iso/perspective are free cameras
_ORTHO_VIEWS = {"top", "bottom", "front", "back", "left", "right", "side"}

# Covalent radii (Cordero et al. 2008, Å) — a generic, element-agnostic basis for
# ball-and-stick radii and bond detection, so the tool works for any system rather
# than a hardcoded element table. Unlisted species fall back to _DEFAULT_COV.
_COVALENT_R = {
    "H": 0.31, "He": 0.28, "Li": 1.28, "Be": 0.96, "B": 0.84, "C": 0.76, "N": 0.71,
    "O": 0.66, "F": 0.57, "Ne": 0.58, "Na": 1.66, "Mg": 1.41, "Al": 1.21, "Si": 1.11,
    "P": 1.07, "S": 1.05, "Cl": 1.02, "Ar": 1.06, "K": 2.03, "Ca": 1.76, "Sc": 1.70,
    "Ti": 1.60, "V": 1.53, "Cr": 1.39, "Mn": 1.50, "Fe": 1.42, "Co": 1.38, "Ni": 1.24,
    "Cu": 1.32, "Zn": 1.22, "Ga": 1.22, "Ge": 1.20, "As": 1.19, "Se": 1.20, "Br": 1.20,
    "Kr": 1.16, "Rb": 2.20, "Sr": 1.95, "Y": 1.90, "Zr": 1.75, "Nb": 1.64, "Mo": 1.54,
    "Tc": 1.47, "Ru": 1.46, "Rh": 1.42, "Pd": 1.39, "Ag": 1.45, "Cd": 1.44, "In": 1.42,
    "Sn": 1.39, "Sb": 1.39, "Te": 1.38, "I": 1.39, "Xe": 1.40, "Cs": 2.44, "Ba": 2.15,
    "La": 2.07, "Ce": 2.04, "Pr": 2.03, "Nd": 2.01, "Pm": 1.99, "Sm": 1.98, "Eu": 1.98,
    "Gd": 1.96, "Tb": 1.94, "Dy": 1.92, "Ho": 1.92, "Er": 1.89, "Tm": 1.90, "Yb": 1.87,
    "Lu": 1.87, "Hf": 1.75, "Ta": 1.70, "W": 1.62, "Re": 1.51, "Os": 1.44, "Ir": 1.41,
    "Pt": 1.36, "Au": 1.36, "Hg": 1.32, "Tl": 1.45, "Pb": 1.46, "Bi": 1.48, "Th": 2.06,
    "U": 1.96, "Np": 1.90, "Pu": 1.87,
}
_DEFAULT_COV = 1.40   # fallback covalent radius (Å) for any species not listed above
_BOND_TOL = 1.20      # draw a bond when d < _BOND_TOL * (r_cov[a] + r_cov[b])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", help="Structure or trajectory file")
    parser.add_argument("output", help="Image output path, e.g. frame.png")
    parser.add_argument("--frame", type=int, default=0)
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--height", type=int, default=1200)
    parser.add_argument("--renderer", choices=["tachyon", "opengl"], default="tachyon")
    parser.add_argument("--view", default="front",
                        choices=sorted(_ORTHO_VIEWS | {"iso", "perspective"}),
                        help="camera view; top/side/front/... are orthographic (default front). "
                             "'side' = front (look along the surface, layers stacked vertically)")
    parser.add_argument("--projection", choices=["ortho", "perspective"], default="ortho",
                        help="default ortho; 'perspective' forces a perspective camera for any view")
    parser.add_argument("--color-by", default=None,
                        help="particle property to color atoms by (e.g. Charge); adds a colorbar")
    parser.add_argument("--color-range", nargs=2, type=float, metavar=("MIN", "MAX"),
                        help="fix the color scale (else symmetric-about-0 for charge, else auto)")
    parser.add_argument("--cmap", choices=["bwr", "viridis"], default=None,
                        help="colormap for --color-by; default bwr (red=+/blue=-) for a Charge map, "
                             "viridis otherwise")
    parser.add_argument("--ball-stick", action="store_true",
                        help="ball-and-stick (create bonds, shrink radii) instead of filled spheres")
    parser.add_argument("--bond-cutoff", type=float, default=None,
                        help="force a single uniform bond cutoff (A); default derives "
                             "per-pair cutoffs from covalent radii (any element)")
    parser.add_argument("--label-elems", default=None,
                        help="comma-separated element symbols to label on the image with their "
                             "--color-by value (e.g. Fe,O)")
    parser.add_argument("--paired-plain", action="store_true",
                        help="with --color-by, ALSO write a companion render of the same view with "
                             "normal element colors (no colorbar) for reference; filename has "
                             "'_plain' before the extension")
    args = parser.parse_args()

    try:
        from ovito.io import import_file
        from ovito.vis import (ColorLegendOverlay, OpenGLRenderer, TachyonRenderer,
                               Viewport, PythonViewportOverlay)
        from ovito.modifiers import ColorCodingModifier, CreateBondsModifier
    except Exception as exc:
        print(f"failed to import OVITO Python module: {exc}", file=sys.stderr)
        print("run via `uv run ovito_render.py ...`, install it in this interpreter, or use ovitos", file=sys.stderr)
        return 2

    input_path = Path(args.input).resolve()
    if not input_path.is_file():
        print(f"input file not found: {input_path}", file=sys.stderr)
        return 2

    pipeline = import_file(str(input_path), multiple_frames=True)
    data = pipeline.compute(args.frame)
    if data.particles is None or data.particles.count == 0:
        print("selected frame has no particles", file=sys.stderr)
        return 2

    # ball-and-stick: shrink type radii + create bonds. Radii and per-pair bond
    # cutoffs both derive from covalent radii, so this is element-agnostic; pass
    # --bond-cutoff to force a single uniform cutoff instead.
    if args.ball_stick:
        tpro = pipeline.source.data.particles_.particle_types_
        cov = lambda name: _COVALENT_R.get(name, _DEFAULT_COV)
        for t in tpro.types:
            mt = tpro.make_mutable(t)
            mt.radius = min(0.60, max(0.15, cov(mt.name) * 0.4))  # compressed for B&S look
        names = [t.name for t in tpro.types]
        if args.bond_cutoff is not None:
            bonds = CreateBondsModifier(mode=CreateBondsModifier.Mode.Uniform,
                                        cutoff=args.bond_cutoff)
        else:
            bonds = CreateBondsModifier(mode=CreateBondsModifier.Mode.Pairwise)
            for i, a in enumerate(names):
                for b in names[i:]:
                    bonds.set_pairwise_cutoff(a, b, _BOND_TOL * (cov(a) + cov(b)))
        bonds.vis.width = 0.16
        bonds.vis.use_particle_colors = True
        pipeline.modifiers.append(bonds)

    color_modifier = None
    if args.color_by:
        if args.color_by not in data.particles:
            print(f"property '{args.color_by}' not in the file; available: "
                  f"{list(data.particles.keys())}", file=sys.stderr)
            return 2
        is_charge = args.color_by.lower().startswith("charge")
        cmap = args.cmap or ("bwr" if is_charge else "viridis")
        grad = (ColorCodingModifier.BlueWhiteRed() if cmap == "bwr"
                else ColorCodingModifier.Viridis())
        color_modifier = ColorCodingModifier(property=args.color_by, gradient=grad)
        vals = [float(v) for v in data.particles[args.color_by]]
        if args.color_range:
            color_modifier.start_value, color_modifier.end_value = args.color_range
        elif cmap == "bwr":
            m = max(abs(min(vals)), abs(max(vals)))  # symmetric -> white at 0
            color_modifier.start_value, color_modifier.end_value = -m, m
        else:
            color_modifier.start_value, color_modifier.end_value = min(vals), max(vals)
        pipeline.modifiers.append(color_modifier)

    pipeline.add_to_scene()

    # label overlay (element + value) is reused for the colored and the plain render
    label_overlay = None
    if args.label_elems and args.color_by:
        import numpy as np
        elems = [e.strip() for e in args.label_elems.split(",") if e.strip()]
        tprop = data.particles.particle_types
        type_name = {t.id: t.name for t in tprop.types}
        names = [type_name[int(t)] for t in tprop]
        pos = np.array(data.particles.positions)
        vals = [float(v) for v in data.particles[args.color_by]]
        targets = [(i, names[i], vals[i]) for i in range(len(names)) if names[i] in elems]

        def _draw(ov_args):
            painter = ov_args.painter
            try:
                from PySide6 import QtGui, QtCore
            except Exception:
                from PyQt5 import QtGui, QtCore  # type: ignore
            font = painter.font(); font.setPointSizeF(16.0); font.setBold(True); painter.setFont(font)
            # Project every target; order nearest-camera-first (clip-space depth via the
            # OVITO 3.11+ view/proj matrices) so that when two labelled atoms project to the
            # same spot (one behind the other) the FRONT atom wins and the occluded label is
            # skipped rather than drawn on top of the other as garble.
            try:
                vt = np.asarray(ov_args.view_tm, dtype=float)            # 3x4 world->camera
                M = np.asarray(ov_args.proj_tm, dtype=float) @ np.vstack([vt, [0., 0., 0., 1.]])
            except Exception:
                M = None
            cand = []
            for i, nm, q in targets:
                xy = ov_args.project_point(tuple(pos[i]))
                if xy is None:
                    continue
                if M is not None:
                    clip = M @ np.array([pos[i][0], pos[i][1], pos[i][2], 1.0])
                    depth = float(clip[2] / clip[3]) if clip[3] else float(clip[2])
                else:
                    depth = 0.0
                cand.append((depth, float(xy[0]), float(xy[1]), f"{nm} {q:+.2f}"))
            cand.sort(key=lambda t: t[0])          # ascending clip-z = nearest camera first
            placed = []
            min_sep = 26.0                          # px; a label this close to a nearer one is dropped
            for _depth, x, y, txt in cand:
                if any((x - px) ** 2 + (y - py) ** 2 < min_sep ** 2 for px, py in placed):
                    continue
                placed.append((x, y))
                # white halo for legibility, then black text
                painter.setPen(QtGui.QPen(QtGui.QColor(255, 255, 255)))
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    painter.drawText(QtCore.QPointF(x + 8 + dx, y - 8 + dy), txt)
                painter.setPen(QtGui.QPen(QtGui.QColor(0, 0, 0)))
                painter.drawText(QtCore.QPointF(x + 8, y - 8), txt)

        label_overlay = PythonViewportOverlay(function=_draw)

    renderer = TachyonRenderer() if args.renderer == "tachyon" else OpenGLRenderer()
    proj = "perspective" if (args.view == "perspective" or args.projection == "perspective") else "ortho"

    def _render(out_path: str, with_legend: bool) -> None:
        # camera: orthographic standard view unless perspective is requested
        if args.view == "perspective" or args.projection == "perspective":
            viewport = Viewport(type=Viewport.Type.Perspective)
            viewport.camera_dir = (2, 1, -1)
        elif args.view == "iso":
            viewport = Viewport(type=Viewport.Type.Ortho)
            viewport.camera_dir = (2, 1, -1)
        else:
            vt = "front" if args.view == "side" else args.view
            viewport = Viewport(type=getattr(Viewport.Type, vt.capitalize()))
        viewport.zoom_all((args.width, args.height))

        if with_legend and color_modifier is not None:
            viewport.overlays.append(ColorLegendOverlay(
                modifier=color_modifier, title=args.color_by))
        if label_overlay is not None:
            viewport.overlays.append(label_overlay)

        viewport.render_image(
            filename=str(Path(out_path).resolve()),
            size=(args.width, args.height),
            frame=args.frame,
            renderer=renderer,
        )

    _render(args.output, with_legend=True)
    print(f"rendered {args.output} (view={args.view}, {proj}"
          + (f", colored by {args.color_by}" if args.color_by else "")
          + (", ball-stick" if args.ball_stick else "") + ")")

    # companion plain (element-colored) render of the same view for reference
    if args.paired_plain and color_modifier is not None:
        out = Path(args.output)
        plain_path = str(out.with_name(out.stem + "_plain" + out.suffix))
        # drop the color modifier so atoms revert to element colors; keep everything else
        pipeline.modifiers.remove(color_modifier)
        _render(plain_path, with_legend=False)
        print(f"rendered {plain_path} (view={args.view}, {proj}, plain element colors"
              + (", ball-stick" if args.ball_stick else "") + ")")

    return 0


if __name__ == "__main__":
    sys.exit(main())
