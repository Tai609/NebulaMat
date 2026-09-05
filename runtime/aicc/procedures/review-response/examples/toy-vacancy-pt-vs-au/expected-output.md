# Expected output

Run: `uv run scripts/vacancy.py` (≈5 s, local, no engine/cluster).

```
Pt: N=108  E_perfect=-0.0135 eV  E_vac=1.0013 eV  E_v(formation)=1.015 eV
Au: N=108  E_perfect=0.2815 eV  E_vac=1.0908 eV  E_v(formation)=0.812 eV
```

Verified 2026-06-13, ASE-EMT, macOS, Python 3.12 (via uv).

**Pass criteria:** both E_v positive and ~1 eV; **E_v(Pt) > E_v(Au)**. EMT values
are run-to-run deterministic. The conclusion uses only the ordering, not the
absolute numbers.
