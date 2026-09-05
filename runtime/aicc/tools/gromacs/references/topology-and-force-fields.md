# GROMACS Topologies and Force-Field Integration

> Load this when: reading or editing `.top`/`.itp`, integrating a ligand or custom molecule, diagnosing parameter lookup, or checking force-field/water/ion compatibility.

Tool-agnostic force-field science lives in `__NEBULAMAT_AICC_ROOT__/knowledge/force-fields.md`. This file covers how GROMACS represents that model.

## Topology as a preprocessed program

A typical system topology is assembled from includes:

```text
#include "<forcefield>.ff/forcefield.itp"
#include "protein_chain_A.itp"
#include "ligand_atomtypes.itp"   ; if needed, before ligand atoms use them
#include "ligand.itp"
#include "<forcefield>.ff/<water>.itp"
#include "<forcefield>.ff/ions.itp"

[ system ]
protein ligand water ions

[ molecules ]
Protein_chain_A    1
LIG                1
SOL             12345
NA                  8
CL                 10
```

`gmx grompp` expands `#include`, `#define`, `#ifdef` and related preprocessing. Always write the expanded topology during preflight:

```bash
gmx grompp ... -pp processed.top -po mdout.mdp
```

The processed file is the authority for what was actually compiled. An edit to `ffbonded.itp` has no effect if a molecule-local explicit parameter overrides it; a macro has no effect if it was not defined.

## Three topology levels

### Parameter level

Common directives: `[ defaults ]`, `[ atomtypes ]`, `[ nonbond_params ]`, `[ pairtypes ]`, `[ bondtypes ]`, `[ constrainttypes ]`, `[ angletypes ]`, `[ dihedraltypes ]`, `[ cmaptypes ]`.

### Molecule level

A molecule begins with `[ moleculetype ]`, then may contain `[ atoms ]`, `[ bonds ]`, `[ constraints ]`, `[ settles ]`, `[ pairs ]`, `[ exclusions ]`, `[ angles ]`, `[ dihedrals ]`, `[ cmap ]`, `[ virtual_sites* ]` and restraint directives.

`nrexcl` on the `[ moleculetype ]` line controls how many bonded-neighbor levels are excluded from ordinary non-bonded calculation. It is part of the force-field convention, not a tuning knob.

### System level

`[ system ]` names the system; `[ molecules ]` lists molecule types and counts. Every molecule name in `[ molecules ]` must have been defined earlier, and the molecule blocks/counts must match the coordinate file used by `grompp`.

## `[ defaults ]` is a compatibility contract

```text
[ defaults ]
; nbfunc  comb-rule  gen-pairs  fudgeLJ  fudgeQQ
     1        2         yes       0.5     0.8333
```

- `nbfunc`: non-bonded functional family.
- `comb-rule`: how unlike atom types are mixed.
- `gen-pairs`: whether missing 1-4 Lennard-Jones parameters are generated.
- `fudgeLJ`, `fudgeQQ`: force-field-specific scaling for 1-4 LJ/electrostatics.

Do not copy a molecule `.itp` between force fields while ignoring these values. A topology can parse yet represent a different model because combination and 1-4 rules changed.

Common LJ combination-rule meanings:

| `comb-rule` | Stored parameters | Unlike-pair construction |
|---|---|---|
| 1 | `C6`, `C12` | geometric mixing of `C6` and `C12` |
| 2 | `sigma`, `epsilon` | arithmetic `sigma`, geometric `epsilon` |
| 3 | `sigma`, `epsilon` | geometric `sigma` and `epsilon` |

Explicit `[ nonbond_params ]` overrides generated unlike-pair values. Explicit `[ pairs ]`/`[ pairtypes ]` and the force field's pair-generation rules determine 1-4 interactions.

## Parameter lookup and precedence

For a bonded interaction, GROMACS can obtain parameters from:

1. values written explicitly in the molecule directive;
2. a preprocessor macro expanded on that line;
3. a matching parameter type in the force-field files.

Multiple matching dihedral terms may intentionally accumulate, while other duplicate definitions may overwrite or trigger warnings. Inspect `processed.top`; do not infer precedence from filenames alone.

Unknown or missing items such as `Atomtype ... not found`, `No default Bond types`, `No default Angle types` or `No default Proper Dih. types` mean the parameterization is incomplete or include/atom-type ordering is wrong. `-maxwarn` cannot create missing physics.

## Atom names, atom types and charge groups differ

- atom name identifies an atom in coordinates;
- atom type selects force-field non-bonded and often bonded parameters;
- residue name/number organizes chemistry and selections;
- charge-group number is historical bookkeeping and does not make the current Verlet neighbor scheme use charge groups.

Chemically similar element symbols are not sufficient for atom typing. Carbonyl carbon, aromatic carbon, aliphatic carbon and charged carbon centers usually require different types.

## Charges are part of the force field

The `[ atoms ]` charge column is not freely interchangeable. RESP/AM1-BCC, CMx, OPLS-style fitted charges, charge-equilibration models, off-center charges and polarizable models were developed with different LJ/bonded assumptions.

For a custom molecule, record the charge method, conformers, net-charge constraint, equivalent-atom constraints, atom-type assignment, source/version of every missing parameter and validation targets. Check per-molecule charge sums and total system charge after `[ molecules ]` multiplication.

## Water, ions and virtual sites

A water name is not a complete model identity. Three-, four- and five-site models differ in geometry, charge placement, constraints/SETTLE use and LJ parameters. Four-site waters require the matching virtual-site topology; manually adding a dummy coordinate without the corresponding virtual-site directive is invalid.

Use water and ion parameters recommended for the chosen force field and water model. Ion parameters fitted with one water model can give different activity, pairing and solvation behavior with another.

## Position restraints belong to a molecule

```text
[ moleculetype ]
LIG  3
...
#ifdef POSRES_LIGAND
#include "posre_ligand.itp"
#endif
```

Enable in `.mdp`:

```text
define = -DPOSRES_LIGAND
```

Reference coordinates are supplied through `grompp -r`. A restraint include placed under the wrong molecule restrains the wrong atom numbering.

## Mixing force fields

Treat mixing as a scientific parameterization project, not file concatenation. At minimum reconcile functional form, units, LJ combination rule, 1-4 generation/scaling, charge philosophy, polarization state, water/ion model, atom-type namespace collisions, bonded functional forms and interface validation.

A compatible small-molecule extension designed for a parent family is different from arbitrary mixing. Even then, follow the extension's documented integration order and compatibility rules.

## Topology release gate

Before dynamics, require:

- `gmx grompp` completes with no unexplained warning;
- `processed.top` contains expected force-field, water, ion, ligand, restraint and macro-expanded sections;
- coordinate atom count equals topology-derived atom count;
- `[ molecules ]` order matches coordinate blocks;
- per-molecule and total charges are intended;
- no missing bond/angle/dihedral/improper type;
- `nrexcl`, `[ pairs ]`, `gen-pairs`, `fudgeLJ` and `fudgeQQ` are inherited from one coherent family;
- custom parameter source and version are recorded without committing licensed parameter-file contents.
