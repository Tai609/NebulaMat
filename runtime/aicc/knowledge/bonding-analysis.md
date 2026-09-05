# Chemical Bonding Analysis: COHP, COOP, ICOHP

> Covers: interpreting pairwise bonding from COHP/COOP/ICOHP and projected (orbital-resolved) COHP — bonding vs antibonding character, occupied antibonding states, bond weakening/strengthening, and how to argue a bond-strength claim soundly.

Tool-agnostic science and practice. The *interpretation* of bonding indicators is the same
whatever code produced them; running the LOBSTER program that computes them from a VASP
wavefunction lives in `__NEBULAMAT_AICC_ROOT__/tools/lobster`. Starting points to adapt, not fixed rules.

COHP/COOP analysis answers a different question from DOS/PDOS. DOS says which atoms/orbitals
contribute states at an energy; COHP/COOP asks whether a chosen **atom pair** contributes
bonding or antibonding character at that energy. Use it when a claim is about bond strength,
bond weakening, antibonding occupation, or why an adsorbate is activated.

## What the quantities mean

| Quantity | Meaning | Use |
|---|---|---|
| COOP | DOS weighted by overlap population | older bonding indicator; positive often bonding, negative antibonding |
| COHP | DOS weighted by Hamiltonian population | preferred bonding analysis for plane-wave wavefunctions |
| -COHP | sign-flipped COHP commonly plotted in papers | positive side bonding-like, negative side antibonding-like in the common convention |
| ICOHP / IpCOHP | integrated COHP up to an energy, commonly `E_F` | more negative usually = stronger net bonding for the selected pair, *if settings are comparable* |
| pCOHP | projected/orbital-resolved COHP | decomposes a pair interaction into channels (s-s, s-p, p-p, d-p) |

Be explicit about sign convention: raw COHP and plotted `-COHP` are easy to confuse. Many
papers plot `-pCOHP` so bonding peaks appear on the positive side. Always report whether a
value is COHP, `-COHP`, ICOHP, or `-ICOHP`.

COHP and COOP are **pairwise**. They do not directly describe a many-atom fragment
interaction unless you deliberately sum selected atom pairs (e.g. a distance/element-type
generator) — and then you must describe it as a sum, not as one specific bond.

## Good use cases

- **C–O bond weakening after CO adsorption:** compare isolated-CO `ICOHP(C-O)` with adsorbed-CO `ICOHP(C-O)`; identify occupied antibonding states.
- **Metal–adsorbate bonding:** compare `ICOHP(M-C)`, `ICOHP(M-O)`, `ICOHP(M-N)`; inspect orbital-resolved d–p / σ / π channels.
- **N₂ activation:** pair N–N COHP with N–N elongation, Bader charge, spin density, and PDOS of N₂ π* and metal d states.
- **Solid-state stability:** antibonding states below `E_F` often signal instability or a driving force for distortion/composition change.

## Reading COHP plots and values

- Confirm whether the plot is COHP or `-COHP`; state the energy zero (`E_F = 0`) and the spin channel.
- Occupied **antibonding** states below `E_F` weaken a bond; occupied **bonding** states strengthen it.
- More negative ICOHP for the same kind of pair under comparable settings usually means stronger bonding.
- Compare like with like: same functional, PAW type, basis set, energy window, k-mesh quality, and atom-pair definition. ICOHP from different basis sets / PAW valence choices / pair definitions are not comparable.
- For spin-polarized systems inspect both channels — a spin-resolved antibonding occupation can be the key evidence for magnetic stabilization or bond activation.
- Do not treat ICOHP as quantitative when the projection quality (charge spilling) is poor — that is an operational check; see `__NEBULAMAT_AICC_ROOT__/tools/lobster`.

## Adsorbate-bonding reasoning pattern

For CO on a transition-metal surface:

1. Compute CO, clean surface, and adsorbed surface with compatible electronic settings and clear alignment assumptions.
2. Analyze metal–C and C–O pairs orbital-resolved.
3. Compare `ICOHP(C-O)` before/after adsorption — weakening shows as a less-negative C–O ICOHP plus occupied C–O antibonding contribution.
4. Decompose metal–C into orbital channels: metal d ↔ CO π* often dominates back-donation; σ donation/back-donation needs the molecule orientation mapped to `px/py/pz`.
5. Support the COHP conclusion with bond length, vibrational-frequency shift, Bader charge, charge-density difference, and PDOS.

For N₂ activation, compare isolated vs adsorbed `ICOHP(N-N)`, N–N distance, N₂ π* PDOS/partial charge, Bader charge, and spin density. A weaker N–N ICOHP plus occupied antibonding COHP below `E_F` is far stronger evidence than PDOS peak overlap alone.

## Interpretation red flags

- Comparing ICOHP across different basis sets, PAW valence choices, or atom-pair definitions.
- Reporting `-COHP` plots while quoting raw COHP signs without explanation.
- Describing a summed distance-generated COHP as one specific bond.
- Claiming fragment bonding from PDOS overlap alone when a bonding metric (COHP/ICOHP) is available.
- Quoting ICOHP trends from a projection with poor charge spilling without flagging the limitation.
