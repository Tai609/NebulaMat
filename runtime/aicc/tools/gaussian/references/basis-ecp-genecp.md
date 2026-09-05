# Gaussian Basis, ECP, Gen, and GenECP Notes

> Load this when: choosing Gaussian basis syntax, mixing basis sets, or writing `Gen`/`GenECP` blocks. Science background: `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-qc-practical-rules.md`.

## Syntax traps

- `6-31G(d,p)` and `6-31G**` are synonyms; `6-31+G(d)` adds diffuse functions on heavy atoms; `6-31++G(d,p)` adds diffuse functions on H/He too.
- `aug-cc-pVnZ` is the diffuse version of Dunning correlation-consistent basis sets; do not rewrite it with Pople `+` notation.
- Gaussian keyword spelling is not always the literature spelling: e.g. `wB97XD`, `def2SVP`, `def2TZVP`.
- Pure vs Cartesian functions matter. Record 5D/6D and 7F/10F choices when comparing with other programs or old literature.

## ECP rules

- `def2` basis sets can usually be specified directly for many elements; Gaussian applies the built-in def2 ECP where appropriate.
- For explicit custom ECP input, use `GenECP`, not just `Gen`.
- The valence basis and ECP must be a matched pair. Do not mix an ECP from one family with an unrelated valence basis.

## Mixed basis with built-in names

```text
#p {method}/gen

Title

0 1
coordinates

C O N 0
6-311G(d,p)
****
H 0
6-31G(d)
****
```

Atom ranges can also be used when the coordinate order is stable:

```text
1-12 0
6-311G(d,p)
****
13-80 0
6-31G(d)
****
```

Prefer element blocks unless the atom-index logic is itself part of the method.

## GenECP skeleton

```text
#p {method}/genecp

Title

0 1
Cu  ...
C   ...
O   ...

Cu 0
LANL2DZ
****
C O 0
6-31G(d)
****

Cu 0
LANL2DZ
```

The first block is the basis set specification; the second ECP block supplies the pseudopotential. Missing the second block is a common malformed-input error.

## Custom basis from BSE

When pasting a full basis definition, keep the section order exact and terminate each element block with `****`. Record source, version/date, and whether spherical or Cartesian functions were intended.

## Checkpoint reuse

- Use `guess=read` to reuse orbitals, not basis definitions.
- Use `ChkBasis` only when deliberately reading the basis from the checkpoint.
- Convert `.chk` to `.fchk` for cross-version or cross-platform post-processing; binary `.chk` files are version/platform sensitive.
