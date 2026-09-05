# Expected output

Run: `uv run scripts/vacancy.py` (≈5 s, local, no engine/cluster).

```
Au: N=108  E_perfect=0.2815 eV  E_vac=1.0908 eV  E_v(formation)=0.812 eV
Cu: N=108  E_perfect=-0.6136 eV  E_vac=0.6357 eV  E_v(formation)=1.244 eV
```

Verified 2026-06-15, ASE-EMT, macOS, Python 3.12 (via uv).

**Pass criteria:** both E_v positive and ~1 eV; **E_v(Au) < E_v(Cu)**. EMT values are
run-to-run deterministic. Because the claim requires E_v(Au) > E_v(Cu), this result is a
**`contradicts`** outcome — the pipeline must halt at Phase 4 and produce `escalation.md`,
not a `response-package.md`.
