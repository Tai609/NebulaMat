---
name: materials-dft
description: Prepare reproducible materials DFT jobs and dispatch them through the existing remote-compute SSH/Slurm mechanism.
---

# Materials DFT

The desktop application does not embed VASP, Quantum ESPRESSO, or any other
commercial executable. Prepare an input bundle and submit it through
`remote-compute`; the remote machine owns the licensed software and its module
environment.

## Workflow

1. Validate the candidate and structure locally first. Freeze the structure file,
   pseudopotential choice, functional, spin/charge assumptions, k-point policy,
   `ENCUT`, `EDIFF`, and `EDIFFG` in a `DFTRunSpec` JSON artifact.
2. Load the matching AICC engine skill (`vasp`, `cp2k`, or another deployed
   engine). For VASP, also load `vaspkit` and write `vaspkit-plan.json` with the
   applicable input-generation and post-processing task families. Generate
   inputs from the documented references and run the deterministic
   `comp-chem-workflow` preflight. Store `preflight.json`; a failure blocks
   submission and a warning needs a recorded waiver.
3. Write a versioned `run.sh` or Slurm `.sbatch` wrapper in the workspace. The
   wrapper records the remote software/module environment before launching the
   code and writes exit status, logs, and every output artifact.
4. Ask `hpc-submit`/`remote-compute` to select a configured host; never guess a
   machine or copy credentials. Never install VASP into the desktop environment.
5. Fetch all outputs into a fresh immutable `results/<job>/<timestamp>/` folder,
   then record the run with the existing provenance helper.
6. Run `comp-chem-workflow/validate_calculation.py result` for the selected
   engine and store `validation.json` beside the fetched outputs. Only the
   engine parser may mark technical convergence.
7. Resolve engine post-processing before review. For VASP, run every applicable
   VASPKIT task on the configured remote host through `remote-compute`, after
   checking that task's required inputs and the remote executable/config. Fetch
   and record the task log and generated outputs. A required task that cannot
   run is `blocked`; use `not_applicable` only with a scientific reason. A
   separate materials reviewer decides scientific validity and claim
   acceptance.

## Artifact contract

`DFTRunSpec` includes `code`, `functional`, `pseudopotential`, `incar`,
`kpoints`, `structure`, `remote_host`, `scheduler`, `requested_outputs`, and
`provenance`, plus `engine_skill`, `preflight_command`, `parser_command`,
`postprocessing`, and the four validation rungs. For VASP, `postprocessing`
references the versioned `vaspkit-plan.json` and its final status. API keys and
SSH secrets never belong in it. A failed or non-converged job is still recorded
with `status: failed` or `status: review`.
