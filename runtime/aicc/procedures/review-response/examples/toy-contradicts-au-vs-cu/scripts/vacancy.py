# /// script
# requires-python = ">=3.10"
# dependencies = ["ase", "numpy"]
# ///
"""Monovacancy formation energy in fcc Au and Cu via ASE-EMT (toy method).
E_v = E(bulk with 1 vacancy, N-1 atoms) - (N-1)/N * E(perfect bulk, N atoms).
Relax positions (EMT) at fixed cell; 3x3x3 conventional fcc supercell = 108 atoms.
Same machinery as the sibling toy-vacancy-pt-vs-au example; only the metals differ.
Run with `uv run scripts/vacancy.py` (inline deps above resolve to a cached env)."""
import numpy as np
from ase.build import bulk
from ase.calculators.emt import EMT
from ase.optimize import BFGS

def vac_formation(sym):
    perf = bulk(sym, 'fcc', cubic=True).repeat((3, 3, 3))
    perf.calc = EMT()
    e_perf = perf.get_potential_energy()
    n = len(perf)
    vac = perf.copy()
    del vac[0]
    vac.calc = EMT()
    BFGS(vac, logfile=None).run(fmax=0.02, steps=200)
    e_vac = vac.get_potential_energy()
    ev = e_vac - (n - 1) / n * e_perf
    return dict(sym=sym, n=n, e_perf=e_perf, e_vac=e_vac, E_v=ev)

for s in ('Au', 'Cu'):
    r = vac_formation(s)
    print(f"{r['sym']}: N={r['n']}  E_perfect={r['e_perf']:.4f} eV  "
          f"E_vac={r['e_vac']:.4f} eV  E_v(formation)={r['E_v']:.3f} eV")
