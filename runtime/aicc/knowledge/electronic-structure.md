# Reading Electronic Structure: DOS, Bands, Charge, Bonding

> Covers: interpreting DOS/PDOS, band structure, Bader/charge partitioning, charge-density difference, spin density, work function, ELF, partial-charge orbital character, and the d-band-center descriptor — what each observable can and cannot prove, and how to build a sound evidence chain.

Tool-agnostic science and practice — the *meaning* of these quantities and how to argue with
them. The same interpretation applies whatever code produced the files; *how to run* each task
(INCAR tags, `bader`, `LOCPOT` averaging, `PARCHG`, CP2K Molden/cube/PDOS print sections) is in the engine skills (`__NEBULAMAT_AICC_ROOT__/tools/vasp/references/dos-band.md`,
`__NEBULAMAT_AICC_ROOT__/tools/vasp/references/electronic-analysis.md`, `__NEBULAMAT_AICC_ROOT__/tools/cp2k/references/electronic-analysis.md`; `__NEBULAMAT_AICC_ROOT__/tools/vaspkit` for menu extraction). Starting
points to adapt, not fixed rules.

**Electronic analysis is an evidence chain, not a single post-processing command.** A Bader
number alone rarely proves charge transfer or oxidation state; a PDOS overlap alone rarely proves
bonding. Match the observable to the claim, keep reference calculations consistent, and state what
each observable can and cannot show. Strong charge-transfer / oxidation-state / bonding claims
should cite **at least two compatible observables**.

## Which observable for which claim

| Claim | Primary evidence | Caveats |
|---|---|---|
| net charge transfer between fragments | Bader/DDEC/RESP-like partitioning + charge-density difference | charge partitions are models; CDD shows where density moves |
| interface / adsorbate electron flow | charge-density difference, planar average of Δρ, work-function change | use fragment densities from the adsorbed geometry, not separately relaxed fragments |
| oxidation state / localized excess electron | Bader/charge population, site moment, spin density, PDOS, ELF | formal oxidation state ≠ integrated electron count |
| adsorbate–metal bonding / back-donation | adsorbate-orbital + metal PDOS, CDD, partial charge, COHP/ICOHP | align references; don't over-read broad PDOS overlap; bond strength → COHP (`bonding-analysis.md`) |
| band-edge localization | bands/eigenvalues for VBM/CBM, partial charge/orbital density for the full degenerate set, PDOS | plot all degenerate components together or density looks symmetry-broken |
| work function / band alignment | planar-average electrostatic potential, `E_vac − E_F`, dipole status | asymmetric slabs have different vacuum plateaus on each side; see `periodic-electrostatics.md` |
| defect / magnetic polaron | spin density, local moments, PDOS, Bader/ELF | compare spin initializations; a collapsed moment can be a wrong minimum |
| localized bonds / lone pairs | ELF + charge/PDOS context; COHP for pairwise strength | PAW/core treatment and pseudopotentials can hide core localization; ELF is qualitative |

## DOS / PDOS interpretation

- DOS at `E_F`, gap, and band crossings classify metal/semiconductor/insulator — always state the energy zero and smearing.
- **PDOS is a projection, not a unique partition of the total DOS.** The projection definition depends on the code: PAW sphere projections, Gaussian/AO projections, Mulliken-like decompositions, and localized orbital projections are not numerically interchangeable. Do not integrate PDOS and report it as a rigorous atomic-orbital occupation unless the method explicitly defines that occupation.
- In VASP, `LORBIT=11` resolves magnetic components (`s`, `px/py/pz`, `dxy…dx2-y2`) — use it when orbital orientation matters (CO σ/π, surface symmetry); `LORBIT=10` gives coarser s/p/d.
- In CP2K/Gaussian-basis workflows, PDOS and Molden-based orbital composition are basis-dependent; keep basis family, valence partition, and broadening identical across comparisons.
- For spin-polarized systems, check both channels; plotting spin-down as negative is only a visualization convention — say so.
- PDOS overlap *suggests* hybridization; spatial plots (partial charge density / MO cubes / orbital isosurfaces) show *where* the state lives. Robustness to projection/broadening settings matters.

## Energy alignment (gets misused constantly)

- Single plot: shift to `E − E_F` or a stated HOCO/VBM/CBM/midgap reference. For gapped systems, the Fermi level in a gap is a numerical reference, so do not over-read it.
- Comparing across cells: align to **vacuum level** (planar-average electrostatic potential) for isolated molecules vs clean vs adsorbed slabs; align to `E_F` only within the same metallic electrode model. Never compare raw eigenvalues / DOS peak positions from unrelated cells.
- For charged cells or implicit-solvent models, alignment depends on the correction/reference convention; write that convention before comparing band edges or redox levels.

## d-band center

First moment of the d-PDOS relative to the chosen zero:

```text
epsilon_d = ∫ E·D_d(E) dE / ∫ D_d(E) dE
```

A trend descriptor, not a standalone law. It is sensitive to surface model, atom selection,
unoccupied-band range, energy window, spin treatment, and adsorption-induced changes. Rules:

- use surface / active-site atoms, not bulk, for surface adsorption;
- keep the integration window and energy zero consistent across the series;
- report spin-up/down centers or a defined average for magnetic systems;
- compare the d-band center against adsorption energies/barriers — trends are reliable, absolute values are not.

Qualitatively, a higher d-band center often correlates with stronger adsorbate interaction
(antibonding states pushed above `E_F`, less occupied); lower often weakens it. Trend, not law.

## Charge partitioning interpretation

Bader, Hirshfeld, Mulliken, Lowdin, RESP/REPEAT, DDEC, and other schemes are **relative, model-dependent**. They can be valuable for trends under a controlled setup, but none is a formal oxidation-state measurement.

Rules:

- State the scheme and electron/core convention.
- Compare trends under identical structure class, basis/potential or PAW setup, charge/spin state, and grid.
- A claim that depends on *which* atoms — interface, defect-neighbor, single-atom, adsorbate-bound — needs a structure-level figure, not just a numeric table.
- A single-state charge render is a structural reference, not by itself evidence for a *dynamic* valence change.

For PAW/Bader workflows, use the all-electron reference density when making charge-state claims. For localized-basis workflows, remember that Mulliken/Lowdin-style populations can change substantially with basis choice.

**Supported metals on reducible oxides are a known trap.** Net charges are often *small* (≲ 0.1 e) and a *weak* discriminator — the per-atom spread within one metal cluster can exceed the difference between the structures being compared, so a small positive value is not evidence of a cationic state. Require ≥ 2 observables and prefer one anchored to experiment (an adsorbate stretch frequency that maps to IR/DRIFTS often separates oxidation states more cleanly than the charge itself). And mind the geometry: a metal atom relaxed *into* an O-vacancy captures the vacancy electrons and comes out *anionic* — a cationic (Mδ⁺) reference must be the metal bonded to surface O, not sitting in the vacancy.

**The surface termination (and the O chemical potential it implies) sets the metal's oxidation state — match it to the experiment, not to the most convenient cut.** The single most consequential model choice for a supported-metal oxidation-state claim is *which surface you put the metal on*, and it is easy to get wrong because the "default" cut is usually the reducing one:

- A metal adatom on a **clean cation-terminated or stoichiometric** oxide slab generally relaxes to a **reduced, metal-coordinated** species (short M–support-cation bonds, near-zero/negative charge) — even when the real catalyst, formed/operated under **oxidizing** conditions, hosts an **oxidized M–Oₙ** site. The clean-slab adatom is then the *wrong oxidation state*, and its binding energies / charges answer a different question than the one asked.
- If the experiment forms or operates the metal under an oxidizing μ_O (calcination in air, O-rich/aqueous/hydroxylated conditions), model the **O-terminated / O-rich (or hydroxylated) surface** so the metal can adopt its oxidized coordination (e.g. M bonded to 4 surface O), and reference energetics to the appropriate oxidizing reservoir (an oxide-gas species such as MOₓ(g), or μ_O fixed by T,p) rather than to a bare metal atom. See `surface-thermodynamics.md` ("single-atom and defect stability diagrams", "volatile metal-oxide reservoirs and atom trapping").
- Symmetric trap on the reduced side: a metal in an O-vacancy (above) comes out anionic. Between these, the *physically correct* termination is fixed by the synthesis/operating chemistry — decide it explicitly at planning time; do not let the lowest-effort termination silently decide the oxidation state for you.

## Charge-density difference

```text
Δρ = ρ(combined) − ρ(fragment A in combined geometry) − ρ(fragment B in combined geometry)
```

Answers "where did density accumulate or deplete?" — **not** an integer transferred charge.
Fragments are taken from the *relaxed combined geometry* (delete the other fragment; do not relax),
sharing cell/grid/settings with the combined run. Isosurface color choices can exaggerate weak
features; state which color is accumulation vs depletion, and pair with charge partitioning, work-function change,
PDOS, and spin density for an electron-transfer claim.

For grid-based codes, all cubes/volumetric files in a subtraction must share cell, origin, grid, stride, and units. A visually plausible subtraction on mismatched grids is not evidence.

## Spin density, work function, ELF

- **Spin density** `ρ_α − ρ_β` — the right first plot for unpaired electrons, polarons, radical adsorbates, and to check whether a charge-partitioning result is actually spin-polarized and localized. Show ± isosurfaces at equal magnitude unless stated.
- **Work function** `Φ = E_vac − E_F` from the planar-average electrostatic/Hartree potential vacuum plateau; needs enough vacuum and a documented dipole-correction status. Electronegative adsorbates usually raise Φ, electropositive lower it — but report the computed value, not the trend.
- **ELF** (0–1): high regions indicate localized pairs, covalent bonds, or lone-pair density — useful for localized bonds, lone pairs, defect-localized electrons, and bonding changes along a path. Qualitative; core treatment can change what is visible.

## Adsorbate–surface orbital reasoning

A fragment-based analysis: isolated adsorbate (same orientation), clean surface, adsorbed surface,
all with compatible settings; compare adsorbate-orbital and active-site-metal PDOS for peak shifts,
broadening, splitting, spin occupation, and new states near `E_F`.

- **CO on transition metals:** separate σ-type (`s` + axis-aligned `p`) from π-type (`px/py` if the axis is z). σ donation shows in the CO 5σ region; back-donation as occupation/broadening of CO 2π* mixed with metal d.
- **N₂ activation:** look for metal-d / N₂-π* energy matching, spin-channel selectivity, partial occupation below `E_F`, N–N elongation, charge change, spin redistribution, and Δρ accumulation in the metal–N / N–N region. A PDOS peak assignment alone is not enough.

For pairwise bond-strength conclusions, COHP/ICOHP is the direct evidence — see `bonding-analysis.md`.
