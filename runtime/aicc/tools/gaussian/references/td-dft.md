# Gaussian TD-DFT and Electronic Spectra

> Load this when: writing Gaussian TD-DFT inputs, reading excitation output, computing UV-Vis/ECD/fluorescence, or exporting data for orbital/NTO analysis. Science background: `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-qc-practical-rules.md`.

## Vertical absorption

Ground-state optimization/frequency, then TD single point:

```text
%chk=gs.chk
#p {method}/{basis} opt freq

...

--Link1--
%chk=gs.chk
#p {td-method}/{td-basis} td(nstates=20) geom=allcheck guess=read
```

TD can use a different functional/basis from the ground-state optimization, but the method change must be intentional and reported.

## Useful TD options

| Option | Use |
|---|---|
| `td(nstates=N)` | compute more states than the target peak count; default is often too small |
| `td(root=N)` | optimize or analyze a specific excited state |
| `td(triplets)` | triplet excitations from closed-shell singlet reference |
| `td(50-50)` | singlets and triplets together for closed-shell singlet reference |
| `iop(9/40=2)` | print smaller excitation coefficients when detailed assignment is needed |

## Reading Gaussian TD output

Key lines:

```text
Excited State  1: Singlet-A  3.8961 eV  318.23 nm  f=0.0005  <S**2>=0.000
  58 -> 61   0.63014
  58 -> 66  -0.20966
```

Record:

- state number, multiplicity/symmetry;
- excitation energy in eV and nm;
- oscillator strength `f`;
- dominant transitions and approximate contributions;
- total TD energy if comparing excited-state energies directly.

For closed-shell TD output, a rough contribution from coefficient `C` is `2*C^2*100%`. For open-shell spin-resolved output, use `C^2*100%`.

## ECD and conformers

TD output includes rotational strengths needed for ECD. For flexible molecules:

1. enumerate credible conformers;
2. optimize/frequency-check them;
3. compute conformer free energies and Boltzmann weights;
4. run TD for each conformer using consistent settings;
5. generate a weighted spectrum.

Do not compare a single conformer ECD spectrum to experiment unless conformer dominance is justified.

## Fluorescence

Typical route:

```text
%chk=gs.chk
#p {method}/{basis} opt freq

...

--Link1--
%oldchk=gs.chk
%chk=s1.chk
#p {method}/{basis} td(root=1,nstates=6) opt freq geom=allcheck guess=read
```

The excitation energy at the optimized S1 geometry estimates fluorescence emission. The S1 structure must be checked for unintended imaginary frequencies; if it has one, displace along the mode and reoptimize.

## Export for analysis

- Use `formchk job.chk job.fchk` for Multiwfn/GaussView-friendly wavefunction data.
- Use NTO analysis when orbital-transition lists are too mixed for clear assignment.
- For molecular orbital or density-difference figures, record isovalue, state number, functional, basis, solvent model, and whether the plot shows canonical MOs, NTOs, or density difference.
