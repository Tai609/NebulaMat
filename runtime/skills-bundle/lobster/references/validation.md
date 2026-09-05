# LOBSTER validation: spilling, outputs, reporting

> Load this when: checking whether a LOBSTER projection is trustworthy, or recording what a COHP run produced.

## Spilling / projection quality (check this first)

LOBSTER projects a plane-wave wavefunction onto a local basis, so projection error is
unavoidable. Read `lobsterout` for the spilling values:

- **`charge spilling`** — occupied-state projection error; the most important number for bonding conclusions.
- **`total spilling`** — includes unoccupied states; usually larger.
- Charge spilling below ~5% is commonly acceptable; for strong claims aim for ~2% or lower when feasible.

If charge spilling is too large, fix it before drawing conclusions:

- increase `NBANDS` and rerun the VASP static;
- ensure `basisfunctions` match the PAW valence (including `_sv`/`_pv` semicore);
- try the VASP-fitted basis (`pbeVaspFit2015`) or another supported set;
- confirm `WAVECAR` and `POSCAR` correspond to the same final static run.

**Do not quote ICOHP/COHP trends from a poor-spilling run without flagging the limitation.**

## Main outputs

| File | Meaning |
|---|---|
| `lobsterout` | version, input echo, basis recommendation, projection progress, spilling, warnings |
| `COHPCAR.lobster` | energy-resolved COHP + integrated COHP; orbitalwise columns if requested |
| `ICOHPLIST.lobster` | pairwise ICOHP at `E_F`, bond distances, translations, spin channel |
| `COOPCAR.lobster` | energy-resolved COOP |
| `ICOOPLIST.lobster` | pairwise ICOOP summary |
| `DOSCAR.lobster` | LOBSTER-projected DOS (compare with VASP DOS only with care) |
| `CHARGE.lobster` / `GROSSPOP.lobster` | Mulliken / Loewdin populations and charges |
| `projectionData.lobster` | cached projection for repeated pair selections |

For orbital-resolved ICOHP, `ICOHPLIST.lobster` may show only the pair total — extract orbital
contributions from `COHPCAR.lobster` at `E - E_F = 0`, or use a LOBSTER-aware parser.

Never commit `WAVECAR`, `CHGCAR`, `COHPCAR.lobster`, `DOSCAR.lobster`, `projectionData.lobster`,
or bulky plot exports; keep concise run notes, small parsed tables, or scripts.

## Reporting checklist

- VASP source run: structure, functional, PAW potentials, k-mesh, spin, `ISYM=-1`, `NBANDS`, whether `WAVECAR` was regenerated.
- LOBSTER version/module, thread count, `lobsterin`, basis set, basis functions, pair/generator definitions.
- Spilling values and whether they are acceptable.
- Sign convention (COHP or `-COHP`; ICOHP or `-ICOHP`), energy zero, spin channel, integration energy (usually `E_F`).
- Pair distances/translations from `ICOHPLIST.lobster`; for orbitalwise, the orbital-coordinate convention and molecule orientation.
- Supporting evidence (DOS/PDOS, charge-density difference, spin density, Bader, bond lengths, frequencies).

(The interpretation of these numbers — bonding vs antibonding, like-with-like comparison — is in `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md`.)
