# Examples

Each example is a self-contained directory: complete input files + a `README.md` + `expected-output.md`. Full conventions in the repo-root `__NEBULAMAT_AICC_ROOT__/STRUCTURE.md`.

Rules:

1. **Verified only** — every example was actually run; its README records CP2K version, date, and machine. An unverified example is worse than none: agents copy examples with full confidence.
2. **`expected-output.md`** holds the parsed summary (final energy, convergence status, key warnings) and trimmed log excerpts — never bulky raw outputs.
3. **Never commit** bulky restart/wavefunction/trajectory files or local manual/basis/potential library copies. Record basis/potential file names, versions, and source paths instead.
4. When an example is added, list it in the skill's `SKILL.md` examples table.

Keep examples site-neutral: job scripts use placeholders such as `<PARTITION>`, `<LOAD_CP2K>`, and `<MPI_LAUNCH>`.

Per-example `README.md` template:

```markdown
# <name>
Demonstrates: <what question this answers>
Expected result: <the number/behavior, with units>
Runtime: <walltime on what resources>
Verified: <CP2K version, date, machine>
Adapt by changing: <the lines/files someone edits for their system>
```
