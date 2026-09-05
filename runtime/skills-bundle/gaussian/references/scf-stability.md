# Gaussian SCF and Stability Playbook

> Load this when: Gaussian reports SCF convergence failure, the molecule is open-shell/biradical/transition-metal, or wavefunction stability must be verified. Science background: `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-qc-practical-rules.md`.

Fix one thing at a time. Check geometry, charge, multiplicity, units, and heavy-element basis/ECP treatment before changing SCF controls.

## Diagnosis table

| Case | First Gaussian move |
|---|---|
| target basis has diffuse functions and SCF fails | converge smaller/no-diffuse basis first, then target job with `guess=read` |
| DFT grid-sensitive functional or noisy SCF | `int=ultrafine` or `int=superfine`; for integral threshold use `int=acc2e=12` |
| early SCF numerical shortcuts look suspicious | `scf=novaracc` and/or `scf=noincfock` |
| small gap, metal, conjugated system | `scf=vshift=300` to `500`; consider `scf=fermi` |
| hard convergence after sane setup | `scf=xqc` before `scf=qc`; for very large jobs consider `scf=yqc` if available |
| bad initial guess | try a different `guess=` strategy or reuse a checkpoint from a related converged job |
| open-shell singlet / antiferromagnetic coupling | unrestricted method with `guess=mix nosymm stable=opt` |
| SP-only exploratory result is nearly converged | `scf=conver=6` only if no gradients, frequencies, or post-SCF steps depend on it |

Avoid `scf=maxcycle=N` as the first fix. Use it only when the SCF error and energy clearly trend toward convergence.

## Smaller-basis to target-basis workflow

```text
%chk=small.chk
#p {method}/{small-basis} scf=xqc

...

--Link1--
%oldchk=small.chk
%chk=target.chk
#p {method}/{target-basis} guess=read geom=allcheck scf=xqc
```

Use this when diffuse functions or a large basis destabilize the first SCF. The small-basis wavefunction is only an initial guess.

## Broken-symmetry singlet workflow

```text
%chk=bs.chk
#p u{method}/{basis} guess=mix nosymm stable=opt

broken-symmetry search

0 1
coordinates

--Link1--
%chk=bs.chk
#p u{method}/{basis} opt freq guess=read geom=allcheck nosymm

--Link1--
%chk=bs.chk
#p u{method}/{basis} stable=opt guess=read geom=allcheck nosymm
```

Also compute plausible high-spin alternatives. Report `S**2`, spin density, and whether the final stability check passed.

## Stability output interpretation

| Output | Meaning | Action |
|---|---|---|
| `The wavefunction is stable...` | no lower solution found in tested space | proceed, still check spin contamination |
| `RHF -> UHF instability` | closed-shell solution is unstable to unrestricted solution | search broken-symmetry or higher-spin solutions |
| `internal instability` | converged to higher-energy orbital solution | rerun from the optimized stable wavefunction |

## Hard stops

- Do not continue to Opt/Freq/MP2/CC from an unconverged SCF.
- Do not relax SCF convergence for geometries, frequencies, or post-SCF energies.
- Do not accept a closed-shell singlet for a suspected biradical without a stability test.
