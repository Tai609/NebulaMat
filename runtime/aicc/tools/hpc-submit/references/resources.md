# Scheduler Resources

> Load this when: a question isn't covered by the local references — consult the linked source, then distill the answer back into the topical file.

- **Slurm documentation** — https://slurm.schedmd.com/documentation.html — sbatch/sacct/scontrol references; the sbatch page documents every directive.
- **Slurm reason codes** — https://slurm.schedmd.com/squeue.html#SECTION_JOB-REASON-CODES — decoding why a job is pending.
- **PBS Professional guides** — https://altair.com/pbs-professional — qsub/qstat references for PBS clusters.
- **Cluster-specific docs** — every center's own documentation overrides generic advice (partitions, QOS, scratch policy, MPI launcher). Record learned cluster facts (partition names, cores per node, launcher) in the user's private cluster guide (see `cluster-guide-template.md`) so they're never re-discovered — and never committed.
