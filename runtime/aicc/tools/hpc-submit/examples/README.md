# Examples

Each example is a self-contained directory: complete input files + a `README.md` + `expected-output.md`. Full conventions in the repo-root `__NEBULAMAT_AICC_ROOT__/STRUCTURE.md`.

Rules:

1. **Verified only** — every example was actually run; its README records software version, date, and machine. An unverified example is worse than none: agents copy examples with full confidence.
2. **`expected-output.md`** holds the parsed summary (final energy, convergence status, key warnings) and trimmed log excerpts — never bulky raw outputs.
3. **Never commit** licensed files (POTCAR — pointer + TITEL lines only; licensed force fields) or large binaries (WAVECAR, CHGCAR, trajectories, .chk). The repo `.gitignore` enforces the common cases.
4. When an example is added, list it in the skill's `SKILL.md` examples table.

Per-example `README.md` template:

```markdown
# <name>
Demonstrates: <what question this answers>
Expected result: <the number/behavior, with units>
Runtime: <walltime on what resources>
Verified: <software version, date, machine>
Adapt by changing: <the lines/files someone edits for their system>
```
