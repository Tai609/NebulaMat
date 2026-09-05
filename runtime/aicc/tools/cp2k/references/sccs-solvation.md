# CP2K SCCS and Implicit Solvation

> Load this when: setting up or interpreting CP2K implicit-solvent/SCCS calculations, comparing vacuum and solvated energies, or deciding whether implicit solvent is appropriate. Also load `low-dimensional-electrostatics.md` and `__NEBULAMAT_AICC_ROOT__/knowledge/periodic-electrostatics.md` for boundary-condition and thermodynamic-cycle reasoning.

## When to use

Implicit solvent is useful for screening solvation effects, stabilizing charged species, approximating continuum electrostatics, and estimating solvent contributions when explicit solvent structure is not the central question.

Do not use it as a substitute for explicit hydrogen bonding, specific ion coordination, proton transfer networks, interfacial water structure, or solvent reorganization dynamics unless the approximation is explicitly justified.

## Workflow

1. First converge the same model in vacuum or the baseline electrostatic environment.
2. Add SCCS/implicit-solvent settings with the same structure, basis, potential, grid, charge, spin, and SCF strategy.
3. Re-optimize if the solvated geometry is part of the property.
4. Compare only like with like: all terms in a solvation-corrected energy expression need the same solvation model and parameters unless the expression explicitly defines otherwise.
5. Validate sensitivity to cavity/solvent parameters when the conclusion depends on small energy differences.

## Template shape

Verify exact keyword names and units against the installed CP2K manual before production:

```text
&DFT
  &SCCS
    ALPHA [N/m] 38.4        # surface-tension-like parameter; adjust from model/source
    BETA  [GPa] -0.5        # pressure-like parameter; adjust from model/source
    GAMMA [mN/m] 0.0        # dispersion/repulsion-related parameter; adjust from model/source
    DIELECTRIC_CONSTANT 78.36
    EPS_SCCS 1.0E-6
    MAX_ITER 100
    DERIVATIVE_METHOD FFT
    &ANDREUSSI
      RHO_MIN 0.0001841
      RHO_MAX 0.0013604
    &END ANDREUSSI
  &END SCCS
&END DFT
```

The numeric values above are placeholders/example-shaped settings, not universal solvent parameters. Use the source paper, CP2K manual, or a calibrated group protocol for the actual solvent/cavity model.

## Energy interpretation

SCCS terms can be decomposed into polarization/electrostatic, cavity, dispersion, repulsion, and total solvation-like contributions depending on version/output. Do not assume the printed `ENERGY| Total FORCE_EVAL` alone is the desired solvation free energy.

Write the thermodynamic cycle first, for example:

```text
DeltaG_solv(A) = G_SCCS(A) - G_vac(A)
DeltaG_ads,solv = G_SCCS(slab+ads) - G_SCCS(slab) - G_SCCS(ads_ref)
```

If a gas-phase reference is intentionally used for one term, state that convention explicitly.

## Guardrails

- Verify exact keyword paths in the manual for the installed CP2K version; implicit-solvent sections have changed across versions.
- Charged systems need a deliberate cell, Poisson, and reference-potential convention.
- SCCS can change SCF behavior; reuse a compatible vacuum `.wfn` only when the method change is documented and the restart is stable.
- Do not mix vacuum gas-phase reference energies with solvated surface/adsorbate energies without writing the thermodynamic cycle explicitly.
- Cavity parameters are method parameters. A small change can move adsorption/solvation energies enough to change trends.
- For surfaces, decide whether solvent should contact one side or both sides of the slab and whether explicit water/ions are needed.

## Typical validation

- Compare vacuum and SCCS single-point energies for the same geometry before running long optimizations.
- Check SCF stability with and without SCCS.
- Test sensitivity to cavity parameters when energy differences are small.
- For charged systems, test cell/electrostatics and reference convention.
- For interfacial systems, inspect whether the continuum cavity follows the intended solvent-accessible region.

## Reporting checklist

- Solvation model and all solvent/cavity parameters.
- Whether geometry was optimized in vacuum or solution.
- Charge, spin, cell, Poisson/periodicity settings.
- Baseline/vacuum comparison and exact thermodynamic cycle.
- Which printed SCCS energy terms were used.
- Convergence of SCF and energy differences with cavity/grid/electrostatic settings when relevant.
