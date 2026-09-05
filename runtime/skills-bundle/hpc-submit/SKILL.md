---
name: hpc-submit
description: NebulaMat adapter for calculation skills that request HPC submission; routes approved local, SSH, Slurm, or PBS work through the existing remote-compute skill and app-managed provenance.
---

# HPC Submission Adapter

This skill is the transport adapter for AICC engine skills. Their scientific
preflight and parser rules remain authoritative, but NebulaMat owns remote
execution. Do not load or invoke AICC's upstream `hpc-submit` or `rsess`
implementation.

1. Finish the selected engine skill's deterministic preflight and preserve its
   JSON verdict. A failed preflight blocks submission.
2. Load `remote-compute`, select only a machine recorded in
   `.openscience/compute.json`, and use the app-managed SSH configuration.
3. Keep the input bundle, run script, scheduler script, method fingerprint, and
   run specification in the workspace. Never copy credentials, licensed
   potentials, or secret cluster configuration into provenance.
4. Ask for approval before expensive execution unless the exact batch was
   already approved. Submit and monitor through the existing direct/Slurm
   lifecycle; scheduler completion is process evidence, not convergence.
5. Fetch every output into a fresh immutable result directory, run the engine
   parser through `comp-chem-workflow`, and call `record_run.py` with all code,
   outputs, environment evidence, job/PID, host, final state, and session id.
6. A rerun requires a new result directory and a recorded reason. Never
   overwrite or infer success from an empty queue.

