# Validating Gaussian Calculations

> Load this when: judging whether a finished Gaussian job is usable, or checking an input before submission.

## Pre-submission

- Charge and multiplicity present and *derived*, not guessed (origin stated: structure, source paper, or user).
- Trailing blank line at end of input; `%chk` set for anything you may restart or post-process.
- `%mem`/`%nprocshared` fit the node with headroom; scratch (`GAUSS_SCRDIR`) has space.
- Opt and Freq at the same level of theory if thermochemistry is the goal.

## Post-run

Run `uv run scripts/parse_gaussian.py JOB.log` — exits 0 only for a clean run; reports termination count, SCF energy, opt status, imaginary modes, thermochemistry, S².

Checks the script enforces, and what they mean:

- **`Normal termination` count == number of job steps** (Opt+Freq = 2; each `--Link1--` step adds one). Fewer = something died; find the `Error termination via Lnk1e in l<NNN>` line and go to errors.md.
- **`Stationary point found`** present for optimizations; all four convergence criteria YES.
- **Imaginary frequencies**: 0 for a minimum. On a *minimum*, a small one (|ν| < ~50i cm⁻¹) is usually an unconverged rotor — reoptimize with `opt=tight int=ultrafine`. For a TS: exactly 1, and its displacement vector must correspond to the intended reaction coordinate (inspect/animate; confirm with IRC when the claim matters). **Exception:** a genuine low-barrier / flat-top TS (hindered rotation, atropisomerization) legitimately has a single *small* imaginary mode — if its displacement is the reaction coordinate, keep it; do not "reoptimize it away" as if it were rotor noise.
- **Spin contamination** (unrestricted runs): S² within ~10 % of s(s+1); larger deviations need comment or a different method.

## Energy discipline

- State which energy is quoted: E(SCF), E+ZPE, H(298), or G(298) — they differ by tens of kcal/mol.
- Energies compared across species must share method, basis, solvation, and dispersion.
- Standard-state and conformer corrections are not automatic; if skipped, say so.
- Units explicit on every value (Hartree internally; convert deliberately: 1 Ha = 627.5095 kcal/mol = 27.2114 eV).

## Provenance to preserve

The `.log`/`.out`, the `.chk` (or `formchk` → `.fchk` since .chk is binary/version-bound), and the exact input file.
