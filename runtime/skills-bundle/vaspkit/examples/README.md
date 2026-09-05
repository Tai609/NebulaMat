# Examples

Each example is a self-contained VASP run directory plus VASPKIT post-processing notes: input files, `vaspkit.<task>.log`, generated outputs, `README.md`, and `expected-output.md`.

Rules:

1. Verified only. Record VASPKIT version, VASP version/source files, date, machine, and exact task/menu answers.
2. Never commit POTCAR, WAVECAR, CHGCAR, AECCAR, large trajectories, or copied manuals.
3. For figures, commit the lightweight source data and plotting script; keep bulky raw arrays out unless the example needs them.
4. Every example README answers: what it demonstrates, required upstream VASP files, expected result, runtime, and what to adapt.

Template:

```markdown
# <name>
Demonstrates: <VASPKIT task and scientific purpose>
Inputs: <VASP files and their provenance>
Command/menu: <task ID and answers>
Expected result: <files and key values with units>
Verified: <VASPKIT version, VASP source files, date, machine>
Adapt by changing: <structure, task inputs, plotting parameters>
```
