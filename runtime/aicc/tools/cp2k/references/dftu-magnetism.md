# CP2K DFT+U and Magnetism

> Load this when: setting up CP2K spin-polarized calculations, DFT+U, transition-metal oxides, radicals, broken-symmetry states, local magnetic moments, or comparing magnetic orderings.

## Guardrails

- DFT+U and magnetic initialization are scientific choices, not convergence knobs.
- U values are basis-, code-, pseudopotential-, oxidation-state-, and population-scheme-dependent. Do not copy VASP/QE U values into CP2K without validation.
- Different U values, population methods, spin states, or broken-symmetry constraints are different methods for energy comparison.
- A converged zero-moment state in a known magnetic system can be the wrong local minimum.

## Basic UKS setup

```text
&DFT
  UKS T
  CHARGE 0
  MULTIPLICITY 5
&END DFT
```

Use `MULTIPLICITY = 2S + 1` for isolated molecules/clusters. For periodic magnetic materials, initialize plausible local moments and compare final local moments/energies across orderings.

## Initial magnetization

```text
&SUBSYS
  &KIND Fe
    BASIS_SET DZVP-MOLOPT-SR-GTH
    POTENTIAL GTH-PBE-q16
    MAGNETIZATION 4.0
  &END KIND
  &KIND O
    BASIS_SET DZVP-MOLOPT-SR-GTH
    POTENTIAL GTH-PBE-q6
    MAGNETIZATION 0.0
  &END KIND
&END SUBSYS
```

If different atoms of the same element need different initial moments, split them into separate kind names, e.g. `Fe_A` and `Fe_B`, and make the coordinate labels match those kind names.

## DFT+U pattern

```text
&DFT
  UKS T
  PLUS_U_METHOD MULLIKEN
&END DFT
&SUBSYS
  &KIND Fe
    BASIS_SET DZVP-MOLOPT-SR-GTH
    POTENTIAL GTH-PBE-q16
    MAGNETIZATION 4.0
    &DFT_PLUS_U
      L 2
      U_MINUS_J [eV] 4.0
    &END DFT_PLUS_U
  &END KIND
&END SUBSYS
```

Rules:

- `L 2` targets d states; `L 3` targets f states.
- Always state units for `U_MINUS_J` in templates.
- Record the population method and final occupations.
- Test sensitivity to U only when scientifically needed; do not use U scanning to force a desired result.

## Broken-symmetry and antiferromagnetism

1. Build a cell large enough to host the magnetic ordering.
2. Use distinct kind names for inequivalent spin sites.
3. Assign positive and negative `MAGNETIZATION` values as initial guesses.
4. Keep atom ordering and labels traceable.
5. Compare final energy, final local moments, and occupations, not only SCF convergence.

Example labels:

```text
&COORD
  Fe_A 0.0 0.0 0.0
  Fe_B 0.5 0.5 0.5
&END COORD
&KIND Fe_A
  ELEMENT Fe
  MAGNETIZATION 4.0
  ...
&END KIND
&KIND Fe_B
  ELEMENT Fe
  MAGNETIZATION -4.0
  ...
&END KIND
```

## Validation checklist

- Multiple plausible magnetic orderings tested when the ordering affects the result.
- Final total magnetic moment and local moments are reported.
- U value, population method, localized angular momentum channel, and basis/potential family recorded.
- Occupations are chemically plausible for the intended oxidation states.
- Geometry is reoptimized after changing U or magnetic state if forces/structure matter.
- Energies compared across magnetic states use identical settings except for the intended magnetic initialization/order.
