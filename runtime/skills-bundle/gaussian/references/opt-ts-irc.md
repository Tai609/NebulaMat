# Gaussian Opt, Freq, TS, IRC, and Scans

> Load this when: preparing or troubleshooting molecular optimizations, frequency checks, transition states, IRCs, or scan-assisted TS searches. Science background: `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-qc-practical-rules.md`.

## Core templates

Minimum plus frequency:

```text
#p {method}/{basis} opt freq
```

Tighter minimum check for floppy systems or small imaginary modes:

```text
#p {method}/{basis} opt=tight int=ultrafine freq
```

Restart an optimization from checkpoint:

```text
%chk=job.chk
#p {method}/{basis} opt=restart geom=check guess=read
```

If changing route settings, do not use `opt=restart`; instead start a new job from the last geometry or use checkpoint geometry/orbitals deliberately.

## Optimization failure controls

| Symptom | First fixes |
|---|---|
| bad starting structure | rebuild/pre-optimize; inspect last geometry |
| poor Hessian | `opt=calcfc`; for expensive cases `opt=(recalc=3)` to `5`; `opt=calcall` only when justified |
| internal coordinate failure / near-linear angle | `opt=cartesian` |
| late-stage oscillation | `opt=maxstep=3` to `10` |
| flat or floppy mode | `opt=(tight,calcfc) int=ultrafine`; consider scanning or constraining the soft coordinate |
| Minnesota/grid-sensitive functional | raise grid, e.g. `int=ultrafine` or `int=superfine` |

Freezing atoms can help isolate a chemically relevant subproblem, but it does not remove the frozen atoms from the electronic calculation.

## Transition-state search

Use a chemically aligned guess. Default TS route:

```text
#p {method}/{basis} opt=(ts,noeigen,calcfc) freq
```

Why these options:

- `ts`: optimize a first-order saddle;
- `noeigen`: do not abort just because early Hessians have the wrong number of negative eigenvalues — but because it disables that guard, eigenvector-following can settle on the *wrong* saddle (e.g. a methyl/torsional rotor instead of the reaction TS); always confirm the final single imaginary mode's displacement is the intended reaction coordinate (animate + IRC);
- `calcfc`: compute a real starting Hessian, often essential for TS work.

If a lower-level frequency already produced useful force constants:

```text
#p {method}/{basis} opt=(ts,noeigen,readfc) freq geom=check guess=read
```

A valid TS needs exactly one imaginary frequency, and its displacement must be the intended reaction coordinate. If the mode is wrong, change the guess; do not polish the wrong TS.

## IRC

Use the same level as the TS optimization/frequency. From a TS checkpoint with force constants:

```text
#p {method}/{basis} irc=(rcfc,maxpoints=50) geom=check guess=read
```

If no frequency/force constants are available:

```text
#p {method}/{basis} irc=(calcfc,maxpoints=50) geom=check guess=read
```

For common corrector failures such as `Delta-x Convergence NOT Met`, try one change at a time:

- smaller step: `irc=(calcfc,stepsize=5)`;
- alternate algorithm: `irc=(calcfc,lqa)`;
- more force-constant updates: `irc=(calcfc,recalc=5)` or, if justified, `calcall`.

## Relaxed scans for TS guesses

```text
#p {method}/{basis} opt=modredundant nosymm

...

B 2 15 S 15 -0.1
```

The high-energy scan point is a TS guess, not a TS. Reoptimize it with `opt=(ts,noeigen,calcfc)` and validate by freq + IRC.
