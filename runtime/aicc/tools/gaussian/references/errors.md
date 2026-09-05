# Gaussian Error Recovery

> Load this when: a Gaussian job error-terminated, an optimization won't converge, or output looks suspicious.

The terminating link is on the `Error termination via Lnk1e in .../l<NNN>.exe` line. Fix one thing at a time.

| Link / message | Meaning | Fix |
|---|---|---|
| `l9999` — `Number of steps exceeded` | optimization ran out of cycles | restart from last geometry: `opt=restart geom=check guess=read`; add `opt=calcfc` for a better initial Hessian; `opt=maxcycles=200` |
| `l502` — `Convergence failure -- run terminated` | SCF won't converge | `scf=xqc` (quadratic fallback) first; then smaller basis -> `guess=read` at target basis; `guess=mix` for biradicaloid singlets; check geometry & charge/multiplicity sanity |
| `l103` — `FormBX had a problem` | internal-coordinate breakdown (often near-linear angles) | restart from last geometry; `opt=cartesian` |
| `l716` — `Error in internal coordinate system` | same family as above | take last geometry, `opt=cartesian`, or define the problem coordinate via `opt=modredundant` |
| `l202` — `Problem with the distance matrix` | overlapping atoms or symmetry flip mid-opt | inspect last geometry; fix overlaps; `nosymm` if symmetry reassignment caused it |
| `l301` — basis set errors (`Atomic number out of range`, `EOF while reading basis`) | basis doesn't cover an element / malformed gen input | use a basis covering all elements or `gen` + `pseudo=read` with explicit blocks (heavy elements: LANL2DZ, def2 + ECP) |
| `l101` — `End of file in ZSymb` | malformed input: missing blank line or charge/multiplicity line | fix input format (trailing blank line is required) |
| `galloc: could not allocate memory` | `%mem` exceeds what the node/cgroup allows | lower `%mem` (leave ~10–20% headroom) or request a bigger node |
| `Erroneous write ... No space left on device` | scratch (`GAUSS_SCRDIR`) full | point scratch at a large filesystem; clean old `Gau-*` files |
| `l801/l906/l1002` in post-HF/freq steps | resource exhaustion is the common cause | more memory/disk; for MP2 freq consider numerical (`freq=numer`) |
| Opt oscillates, never converges | flat PES / floppy modes | `opt=(tight,calcfc) int=ultrafine`; consider constraining and scanning the soft coordinate |
| `Small interatomic distances encountered` warning then crash | bad starting geometry | re-prepare structure; check units (Å vs Bohr) |

## Recurring causes checklist (before deep debugging)

1. Charge/multiplicity wrong — produces SCF failures and absurd geometries; re-derive from the structure.
2. Missing trailing blank line / malformed modredundant section.
3. Stale `.chk` from a different geometry or basis with `guess=read` — delete and rerun clean.
4. Symmetry: Gaussian reorients molecules (standard orientation); use `nosymm` when external programs need fixed coordinates, accepting slower convergence.
