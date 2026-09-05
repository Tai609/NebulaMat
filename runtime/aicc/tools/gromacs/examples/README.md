# Examples

Each example is a self-contained directory: complete text inputs + `README.md` + `expected-output.md`.

Rules:

1. **Verified only** — every example must have been run; its README records GROMACS version/build, date, machine, force-field/water identity and exact commands.
2. **Small and redistributable** — no licensed force-field contents, confidential structures, bulky trajectories, `.edr`, `.tpr`, or checkpoints.
3. **Expected output is validation evidence** — `expected-output.md` contains preflight/parser summaries, key `grompp` messages, EM force criterion, equilibration checks and a small observable with units/uncertainty.
4. **No tutorial without a scientific question** — the example states what it validates and which settings must not be generalized.

Per-example README template:

```markdown
# <name>
Demonstrates: <scientific/technical question>
System: <composition, atom count, box>
Force field: <family/version + water/ions/custom parameters>
Stages: <EM -> equilibration -> production>
Expected result: <validated behavior/value with units>
Runtime: <walltime/resources>
Verified: <GROMACS version/build, date, machine>
Adapt by changing: <files/parameters that are system-specific>
Do not generalize: <cutoffs, restraint schedule, coupling groups, etc.>
```
