# Examples

Examples must be verified, site-neutral, and small enough to commit. Do not commit bulky CatMAP output maps unless they are trimmed expected-output artifacts.

Each CatMAP example should include:

- `README.md`: mechanism, expected result, CatMAP version, runtime, what to adapt.
- `energies.txt`: minimal species table with no private paths.
- `<model>.mkm`: setup file with descriptor ranges and thermochemistry modes.
- `mkm_job.py`: launcher and analysis commands.
- `expected-output.md`: trimmed solver log summary, key TOF/coverage values, and generated plot names.
