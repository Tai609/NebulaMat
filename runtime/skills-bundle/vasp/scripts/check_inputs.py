#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# ///
"""VASP preflight: validate POSCAR/INCAR/KPOINTS/POTCAR consistency.

Usage: check_inputs.py [--strict-performance] [RUNDIR]

Checks (stdlib only, no pymatgen needed):
  - POSCAR parses; species line present; atom counts sane
  - POTCAR species (TITEL) match POSCAR species in order
  - MAGMOM length == total atoms; LDAUL/LDAUU/LDAUJ length == n species
  - KPOINTS exists or KSPACING set; ENCUT explicit; KSPACING/KPOINTS sanity warnings
  - slab-like cells warn unless ISYM=0, to avoid symmetry-constrained surfaces
  - ISMEAR=-5 not combined with NSW>0
  - CPU-like production relax/static jobs use local default NPAR=4 or warn
  - GPU/OpenACC jobs do not carry CPU NPAR/NCORE by default
Exit code 0 = pass (warnings allowed), 1 = hard failure. With
--strict-performance, performance warnings also fail preflight.
"""
import math
import os
import re
import sys

errors, warnings = [], []
performance_warnings = []


def expand_counts(tokens):
    """Expand INCAR 'N*value' shorthand into a flat list."""
    out = []
    for t in tokens:
        if "*" in t:
            n, v = t.split("*", 1)
            out.extend([v] * int(n))
        else:
            out.append(t)
    return out


def parse_incar(path):
    tags = {}
    if not os.path.isfile(path):
        return tags
    for line in open(path):
        line = line.split("#")[0].split("!")[0].strip()
        if "=" in line:
            k, v = line.split("=", 1)
            tags[k.strip().upper()] = v.strip()
    return tags


def warn(msg, *, performance=False):
    warnings.append(msg)
    if performance:
        performance_warnings.append(msg)


def first_float(value):
    try:
        return float(value.split()[0])
    except (IndexError, ValueError):
        return None


def first_int(value):
    try:
        return int(float(value.split()[0]))
    except (IndexError, ValueError):
        return None


def job_looks_gpu(d):
    """Best-effort detection from local job scripts; absence is not proof of CPU."""
    try:
        names = os.listdir(d)
    except OSError:
        return False
    candidates = []
    for name in names:
        lower = name.lower()
        if lower.endswith((".sh", ".slurm", ".pbs")) or lower.startswith(("sub", "job", "run")):
            candidates.append(os.path.join(d, name))
    needles = ("--gres=gpu", "--gpus", "gpu", "openacc", "vasp_gpu")
    for path in candidates:
        try:
            text = open(path, errors="ignore").read(200000).lower()
        except OSError:
            continue
        if any(needle in text for needle in needles):
            return True
    return False


def parse_kpoints_mesh(path):
    """Return an automatic KPOINTS mesh when the file uses Gamma/Monkhorst mode."""
    try:
        lines = [line.strip() for line in open(path) if line.strip()]
    except OSError:
        return None
    if len(lines) < 4:
        return {"mode": "unknown", "mesh": None}
    try:
        npoints = int(float(lines[1].split()[0]))
    except (IndexError, ValueError):
        return {"mode": "unknown", "mesh": None}
    if npoints != 0:
        return {"mode": "explicit", "mesh": None}
    mode_token = lines[2].split()[0].lower() if lines[2].split() else ""
    if mode_token.startswith("g"):
        mode = "gamma"
    elif mode_token.startswith("m"):
        mode = "monkhorst"
    else:
        return {"mode": mode_token or "automatic", "mesh": None}
    try:
        mesh = tuple(int(float(x)) for x in lines[3].split()[:3])
    except ValueError:
        return {"mode": mode, "mesh": None}
    if len(mesh) != 3:
        return {"mode": mode, "mesh": None}
    return {"mode": mode, "mesh": mesh}


def main():
    args = sys.argv[1:]
    strict_performance = False
    if "--strict-performance" in args:
        strict_performance = True
        args.remove("--strict-performance")
    if any(a.startswith("-") for a in args):
        raise SystemExit("usage: check_inputs.py [--strict-performance] [RUNDIR]")
    d = args[0] if args else "."
    f = lambda name: os.path.join(d, name)

    # --- POSCAR ---
    species, natoms, lengths, vacuum_gaps, max_vacuum = [], 0, None, None, None
    if not os.path.isfile(f("POSCAR")):
        errors.append("POSCAR missing")
    else:
        lines = open(f("POSCAR")).read().splitlines()
        try:
            toks6 = lines[5].split()
            if all(re.fullmatch(r"[A-Z][a-z]?", t) for t in toks6):
                species = toks6
                counts = [int(x) for x in lines[6].split()]
            else:  # VASP4 format, no species line
                counts = [int(x) for x in toks6]
                warn("POSCAR has no species line (VASP4 format) - "
                     "species order cannot be checked against POTCAR")
            natoms = sum(counts)
            if species and len(species) != len(counts):
                errors.append(f"POSCAR species ({len(species)}) vs counts ({len(counts)}) mismatch")
            # largest per-axis vacuum gap (A) for the ISIF=3-on-slab guard; Direct coords only
            try:
                scale = float(lines[1].split()[0])
                lengths = [sum(float(x) ** 2 for x in lines[i].split()[:3]) ** 0.5 * scale
                           for i in (2, 3, 4)]
                ci = 6 if species else 5            # line holding the counts
                mi = ci + 1                          # next line: 'Selective dynamics' or the coord mode
                if lines[mi].strip()[:1] in ("S", "s"):
                    mi += 1
                if lines[mi].strip()[:1] in ("D", "d"):   # Direct fractional coords only (conservative)
                    fr = [[float(x) for x in lines[mi + 1 + j].split()[:3]] for j in range(natoms)]
                    vacuum_gaps = [
                        lengths[ax] * (1 - (max(c[ax] for c in fr) - min(c[ax] for c in fr)))
                        for ax in range(3)
                    ]
                    max_vacuum = max(vacuum_gaps)
            except (ValueError, IndexError):
                max_vacuum = None
        except (ValueError, IndexError):
            errors.append("POSCAR could not be parsed")

    # --- POTCAR ---
    pot_species = []
    if os.path.isfile(f("POTCAR")):
        for line in open(f("POTCAR"), errors="ignore"):
            if "TITEL" in line:
                # e.g. 'TITEL  = PAW_PBE Fe_pv 02Aug2007' -> Fe
                m = re.search(r"=\s*\S+\s+([A-Z][a-z]?)", line)
                if m:
                    pot_species.append(m.group(1))
        if species and pot_species:
            if species != pot_species:
                errors.append(f"species order mismatch: POSCAR {species} != POTCAR {pot_species}")
            else:
                print(f"ok: species order {species} matches POTCAR")
    else:
        warn("POTCAR missing (fine if generated at submit time - verify mapping)")

    # --- INCAR ---
    incar = parse_incar(f("INCAR"))
    if not incar:
        errors.append("INCAR missing or empty")

    nspec = len(species) or len(pot_species)
    if "MAGMOM" in incar and natoms:
        try:
            mlen = len(expand_counts(incar["MAGMOM"].split()))
            if mlen != natoms:
                errors.append(f"MAGMOM has {mlen} entries, POSCAR has {natoms} atoms")
        except ValueError:
            warn("MAGMOM could not be parsed")
    for tag in ("LDAUL", "LDAUU", "LDAUJ"):
        if tag in incar and nspec:
            tlen = len(incar[tag].split())
            if tlen != nspec:
                errors.append(f"{tag} has {tlen} entries, expected {nspec} (one per species)")
    _DF = {  # transition metals + lanthanides + actinides: LMAXMIX matters for magnetization/energy
        "Sc","Ti","V","Cr","Mn","Fe","Co","Ni","Cu","Zn","Y","Zr","Nb","Mo","Tc","Ru","Rh","Pd","Ag","Cd",
        "Hf","Ta","W","Re","Os","Ir","Pt","Au","Hg",
        "La","Ce","Pr","Nd","Pm","Sm","Eu","Gd","Tb","Dy","Ho","Er","Tm","Yb","Lu",
        "Ac","Th","Pa","U","Np","Pu","Am","Cm","Bk","Cf","Es","Fm","Md","No","Lr"}
    _plus_u = any(t in incar for t in ("LDAUL", "LDAUU"))
    _spin = incar.get("ISPIN", "1").split()[0] == "2" or "MAGMOM" in incar
    _has_df = any(s in _DF for s in species)
    if "LMAXMIX" not in incar and (_plus_u or (_spin and _has_df)):
        ctx = "DFT+U" if _plus_u else "spin-polarized d/f system"
        warn(f"{ctx} without LMAXMIX (use 4 for d, 6 for f electrons) — "
             "affects on-site magnetization and total energy")

    if "ENCUT" not in incar:
        warn("ENCUT not set - POTCAR default varies by element; set explicitly")
    if max_vacuum is not None and max_vacuum > 8.0:
        isym = first_int(incar["ISYM"]) if "ISYM" in incar else None
        if isym != 0:
            found = "missing" if isym is None else f"set to {isym}"
            warn(f"large-vacuum slab/molecule-like cell has ISYM {found}; "
                 "for slabs, surfaces, adsorbates, interfaces, and asymmetric 2D systems "
                 "set ISYM=0 so VASP does not constrain or re-symmetrize surface "
                 "distortions, adsorbates, fixed layers, magnetic order, or reconstructions")
    if not os.path.isfile(f("KPOINTS")) and "KSPACING" not in incar:
        errors.append("no KPOINTS file and no KSPACING in INCAR")
    if os.path.isfile(f("KPOINTS")) and "KSPACING" in incar:
        warn("both KPOINTS and KSPACING are present; verify which k-policy VASP will use "
             "and record the intended one")
    if os.path.isfile(f("KPOINTS")):
        kpoints = parse_kpoints_mesh(f("KPOINTS"))
        mesh = kpoints["mesh"] if kpoints else None
        if mesh and any(k <= 0 for k in mesh):
            errors.append(f"KPOINTS mesh has non-positive entry: {mesh}")
        if mesh and lengths and max_vacuum is not None and max_vacuum > 8.0:
            vacuum_axis = max(range(3), key=lambda ax: vacuum_gaps[ax]) if vacuum_gaps else 2
            axis_names = ("a", "b", "c")
            if mesh[vacuum_axis] != 1:
                warn(f"KPOINTS mesh {mesh} gives {mesh[vacuum_axis]} k-points along the "
                     f"largest vacuum direction ({axis_names[vacuum_axis]}); slab/molecule-like "
                     "cells should use exactly 1 k-point along vacuum")
            if vacuum_axis != 2:
                warn(f"largest vacuum gap appears along {axis_names[vacuum_axis]}, not c; "
                     "local slab policy assumes c is the surface normal, so verify the slab "
                     "orientation and KPOINTS before submission")
            for ax in range(3):
                if ax == vacuum_axis or lengths[ax] <= 0:
                    continue
                recommended = max(1, int(math.ceil(13.0 / lengths[ax])))
                if recommended == 1 and mesh[ax] > 1:
                    warn(f"large slab in-plane {axis_names[ax]} length {lengths[ax]:.1f} A "
                         f"uses {mesh[ax]} k-points; local routine slab default is 1 for "
                         "in-plane lengths >= 13 A. Record a convergence/property reason "
                         "or reduce the mesh", performance=True)
                elif recommended > 1 and mesh[ax] < recommended:
                    warn(f"small slab in-plane {axis_names[ax]} length {lengths[ax]:.1f} A "
                         f"uses only {mesh[ax]} k-point(s); review a {recommended}-point "
                         "starting mesh or document a convergence reason")
                elif recommended > 1 and mesh[ax] > recommended + 1:
                    warn(f"slab in-plane {axis_names[ax]} length {lengths[ax]:.1f} A uses "
                         f"{mesh[ax]} k-points, denser than the local routine starting "
                         f"mesh of {recommended}; record the convergence/property reason",
                         performance=True)
            if mesh == (1, 1, 1) and kpoints.get("mode") != "gamma":
                warn("Gamma-only KPOINTS should be Gamma-centered and run with vasp_gam "
                     "when the site provides that binary and the task is compatible "
                     "with it (not SOC/noncollinear)")
    if "KSPACING" in incar:
        kspacing = first_float(incar["KSPACING"])
        if kspacing is None:
            warn("KSPACING could not be parsed; verify the k-mesh policy manually")
        else:
            if kspacing < 0.12:
                warn(f"KSPACING={kspacing:g} is extremely dense for routine production and can be very slow; "
                     "record the convergence/property reason or relax it", performance=True)
            elif kspacing < 0.15:
                warn(f"KSPACING={kspacing:g} is denser than the usual metal production range "
                     "(~0.15-0.20 A^-1); verify this is intentional", performance=True)
            elif kspacing >= 0.45:
                warn(f"KSPACING={kspacing:g} is smoke-test/Gamma-like for many periodic systems; "
                     "do not use it for production numbers without a convergence reason")
            if max_vacuum is not None and max_vacuum > 8.0:
                warn(f"KSPACING used for a slab/molecule-like cell with ~{max_vacuum:.0f} A vacuum; "
                     "verify the vacuum direction has exactly one k-point, or use an explicit "
                     "Gamma-centered KPOINTS file")

    ismear = incar.get("ISMEAR", "1").split()[0]
    nsw = int(incar.get("NSW", "0").split()[0] or 0)
    if ismear == "-5" and nsw > 0:
        errors.append("ISMEAR=-5 with NSW>0: tetrahedron forces are inaccurate for relaxation")
    isif = incar.get("ISIF", "2").split()[0]
    if isif == "3" and "ENCUT" in incar:
        try:
            if float(incar["ENCUT"]) < 500:
                warn(f"ISIF=3 with ENCUT={incar['ENCUT']}: cell relaxations "
                     "need ~1.3x ENMAX to avoid Pulay stress")
        except ValueError:
            pass
    if isif == "3" and max_vacuum is not None and max_vacuum > 8.0:
        warn(f"ISIF=3 with ~{max_vacuum:.0f} A vacuum (slab/molecule): full-cell relaxation "
             "will collapse the vacuum — use ISIF=2 (ions only) for a slab")
    for g in ("NGX", "NGY", "NGZ", "NGXF", "NGYF", "NGZF"):
        if g in incar:
            try:
                if int(incar[g].split()[0]) == 0:
                    warn(f"{g}=0 is not 'use default' — it sets a zero FFT grid and can "
                         f"hang or abort; remove {g} to let VASP choose, or set a real value")
            except ValueError:
                pass
    ibrion = incar.get("IBRION", "").split()[0] if "IBRION" in incar else ""
    npar = first_int(incar["NPAR"]) if "NPAR" in incar else None
    ncore = first_int(incar["NCORE"]) if "NCORE" in incar else None
    if npar is not None and ncore is not None:
        warn("both NPAR and NCORE are set; prefer one site-tested parallelization convention "
             "and record the reason")
    if ibrion in {"5", "6"}:
        if (npar is not None and npar != 1) or (ncore is not None and ncore != 1):
            warn("IBRION=5/6 finite-difference job carries NPAR/NCORE from another run; "
                 "VASP frequency jobs can abort or misbehave with untested parallel layout. "
                 "Use NPAR=1/NCORE=1 or a site-tested setting", performance=True)
    is_gpu = job_looks_gpu(d)
    if is_gpu and (npar is not None or ncore is not None):
        warn("GPU/OpenACC-looking VASP job carries NPAR/NCORE. Local default is to omit "
             "NPAR/NCORE for GPU inputs unless the GPU module documentation explicitly "
             "recommends them", performance=True)
    elif ibrion not in {"5", "6"} and natoms >= 40 and not is_gpu:
        if npar is None:
            if ncore is not None:
                warn("CPU-like production-size VASP job uses NCORE without NPAR. Local "
                     "default is NPAR=4; do not default to NCORE=4 unless a site guide "
                     "or timing benchmark shows it is faster", performance=True)
            else:
                warn("CPU-like production-size VASP job has no NPAR. Local default is "
                     "NPAR=4 for routine CPU relax/static jobs. Omit only with an "
                     "explicit site-default rationale", performance=True)
        elif npar != 4:
            warn(f"CPU-like production-size VASP job uses NPAR={npar}; local default is "
                 "NPAR=4. Keep a non-default value only with a site benchmark or "
                 "task-specific rationale", performance=True)

    # --- report ---
    for w in warnings:
        print(f"WARN: {w}")
    if strict_performance and performance_warnings:
        for e in performance_warnings:
            errors.append(f"performance: {e}")
    for e in errors:
        print(f"FAIL: {e}")
    if errors:
        sys.exit(1)
    print(f"preflight passed ({natoms} atoms" + (f", {len(species)} species" if species else "") + ")")


if __name__ == "__main__":
    main()
