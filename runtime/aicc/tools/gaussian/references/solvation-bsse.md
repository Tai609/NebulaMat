# Gaussian Solvation and BSSE Workflows

> Load this when: adding Gaussian implicit solvent, computing solvation free energies, defining fragments, or applying counterpoise correction. Science background: `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-qc-practical-rules.md`.

## Routine implicit solvent

PCM/IEFPCM default water:

```text
#p {method}/{basis} opt freq scrf=(solvent=water)
```

SMD in a named solvent:

```text
#p {method}/{basis} opt freq scrf=(smd,solvent=ethanol)
```

Check the exact Gaussian solvent name before running. Do not invent a solvent keyword.

## Custom PCM solvent

```text
#p {method}/{basis} scrf=(read,solvent=generic)

Title

0 1
coordinates

Eps=12.34
EpsInf=2.10
```

Most custom electrostatic PCM uses only `Eps`; include `EpsInf` only when the property/model needs it. For SMD custom solvents, use the full SMD parameter set; do not approximate it with dielectric constant alone unless the limitation is explicit.

## Solvation free energy pattern

A compact SMD estimate:

```text
E_solvation = E_SMD(geometry) - E_gas(geometry)
```

Keep gas and SMD single points at the same level and geometry. When combining with thermochemistry, record whether the geometry/frequency was gas-phase or solution-phase and whether the 1 atm to 1 M correction is applied.

## Counterpoise input

Automatic two-fragment CP:

```text
#p {method}/{basis} counterpoise=2

Title

0 1  0 1  0 1
N(Fragment=1)  ...
H(Fragment=1)  ...
O(Fragment=2)  ...
H(Fragment=2)  ...
```

The charge/multiplicity line gives total charge/multiplicity first, then fragment charge/multiplicity pairs.

Manual ghost-atom style is also possible:

```text
#p {method}/{basis}

fragment A in full dimer basis

0 1
N     ...
H     ...
O-Bq  ...
H-Bq  ...
```

Prefer `counterpoise=N` for routine use because it reduces bookkeeping errors.

## Output to preserve

Record both raw and corrected values when CP matters:

- raw complexation/binding energy;
- BSSE energy;
- counterpoise-corrected complexation/binding energy;
- fragment definitions and monomer charge/multiplicity;
- whether monomers are rigid or separately relaxed.

If the CP correction changes the conclusion, report both values and discuss the basis-set dependence rather than hiding one.
