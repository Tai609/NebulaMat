# Setting DFT+U and MAGMOM in VASP

> Load this when: writing the `LDAU*` or `MAGMOM` lines of a VASP INCAR. For *which* U value to pick and *what* initial moment to use (the chemistry), see `__NEBULAMAT_AICC_ROOT__/knowledge/hubbard-u-and-magnetism.md`; this file is the VASP syntax and the array-length rules.

## DFT+U (Dudarev scheme: `LDAUTYPE=2`, only U−J matters)

One entry per POSCAR species, in order:

```ini
LDAU      = .TRUE.
LDAUTYPE  = 2
LDAUL     = 2 -1        # l per species (-1 = no U); 2 = d, 3 = f
LDAUU     = 3.9 0.0
LDAUJ     = 0.0 0.0
LMAXMIX   = 4           # 6 for f-electrons — required for +U density mixing
```

(U values: `__NEBULAMAT_AICC_ROOT__/knowledge/hubbard-u-and-magnetism.md`. e.g. Fe d = 5.3, Ce f = 4.5–5.0 with `LDAUL=3`, `LMAXMIX=6`.)

**Array-length rule (the common bug):** `LDAUL`/`LDAUU`/`LDAUJ` must match **each calculation's own
species list**. A gas-phase reference box without the +U element still needs correctly sized arrays
(all `-1`/`0.0`) or the whole `LDAU` block removed — `uv run scripts/check_inputs.py` checks the lengths.
Never mix +U and non-+U total energies in one reaction expression without a documented correction.

## MAGMOM

```ini
MAGMOM = 4*5.0 6*0.0    # counts sum to the atom total, same order as POSCAR
```

Start from the high-spin formal-oxidation-state value and let it relax (the value table and the
relax-down / AFM-pattern reasoning are in `__NEBULAMAT_AICC_ROOT__/knowledge/hubbard-u-and-magnetism.md`). For AFM,
write explicit ± per sublattice. After convergence, compare moments to the initialization; if a known
magnet collapsed to ~0 μB, restart from high-spin or a converged magnetic `CHGCAR`. Report converged
moments, not the initial guess.
