# Examples

Each example should contain a small source structure/trajectory, the OVITO script, rendered or exported lightweight outputs, `README.md`, and `expected-output.md`.

Rules:

1. Verified only. Record OVITO version, Python/ovitos mode, date, machine, source file provenance, and modifier parameters.
2. Keep source data small. Do not commit production trajectories, long movies, or bulky rendered frames.
3. Quantitative examples must include machine-readable output such as JSON/CSV plus a short interpretation.
4. Rendering examples must include the script that fixes camera, colors, frame, image size, and source file.

Template:

```markdown
# <name>
Demonstrates: <rendering or analysis task>
Input: <file, format, frame range, provenance>
Command: <script invocation>
Expected result: <counts/image/exported files>
Verified: <OVITO version, Python/ovitos, date, machine>
Adapt by changing: <cutoffs, modifiers, colors, camera, frame range>
```
