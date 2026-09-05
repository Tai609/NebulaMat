# Computational Chemistry — Agent Instructions

These rules apply to every computational chemistry and materials science task in this environment, regardless of which skill is active.

## Routing

Match the request against skill descriptions: orchestrators in `__NEBULAMAT_AICC_ROOT__/procedures/`, per-tool skills in `__NEBULAMAT_AICC_ROOT__/tools/`. For anything nontrivial (multi-stage, HPC, resumable, literature-derived), start with `comp-chem-workflow`. Quick single-step questions can go straight to the tool skill. The science/method behind a task (formalism, interpretation, practice) lives in the flat `__NEBULAMAT_AICC_ROOT__/knowledge/` reference library — consult it for ideas, adapt freely; it is not a skill and is never mandatory.

| Request | Skill |
|---|---|
| Manuscript + reviewer comments -> computational response package | `review-response` |
| Project-level task DAG, artifact registry, decisions/events, ready/blocked state | `research-orchestrator` |
| Multi-stage, HPC, resume, benchmark, reproduction | `comp-chem-workflow` |
| Extract a calculation from a third-party paper / SI / report | `literature-to-calculation` |
| Build/convert structures, slabs, supercells, defects, adsorbates, conformers, SMILES | `structure-prep` |
| VASP: static, relax, DOS/bands/charge, adsorption, reaction, NEB | `vasp` |
| CP2K: Quickstep GPW/GAPW, opt/cell-opt, MD/PIMD, DOS/bands/Molden/Multiwfn, DFT+U, hybrid/HFX, NEB | `cp2k` |
| Molecular QC: SP, opt, freq, thermochemistry, TS, IRC, solvent | `gaussian` |
| Molecular wavefunction analysis: fchk/wfn/molden/cube, charges, spin density, MOs/NTOs, spectra, ESP/ELF/NCI/IRI | `multiwfn` |
| GROMACS: biomolecular MD, protein-ligand, nucleic acids, membranes, water/solution/liquid/interface MD, MARTINI/coarse-grained systems, GROMACS FEP/pulling/analysis | `gromacs` |
| Classical / reactive / MLP-driven MD | `lammps` |
| DeePMD-kit / DPMD: dpdata, input.json, training, inference, model deviation, DPLibrary | `deepmd` |
| MLP method choice and cross-program concepts; MACE/NequIP/GPUMD/LASP/GemNet-OC/EquiformerV2 until split into dedicated tools | `mlp` |
| Phonons, force constants, thermal properties | `phonopy` |
| VASPKIT: VASP helper inputs, KPOINTS/band paths, DOS/band/charge/work-function post-processing | `vaspkit` |
| LOBSTER: COHP/COOP/ICOHP bonding analysis from a VASP wavefunction (projection, spilling checks) | `lobster` (science: `__NEBULAMAT_AICC_ROOT__/knowledge/bonding-analysis.md`) |
| Microkinetic modeling, CatMAP, TOF/coverage maps, volcano plots | `catmap` |
| OVITO: atomistic rendering, structure classification, coordination/RDF, defect and trajectory analysis | `ovito` |
| Drive a *remote* machine over a persistent shell (stateful commands, HPC interaction from another machine; not when the agent already runs on the target) | `rsess` |
| Submit / monitor / recover jobs (local, SSH, Slurm, PBS) | `hpc-submit` |
| Compile results into a near-submission `.docx` report / response package (the default final deliverable) | `report` |
| Parse outputs, check convergence | the engine skill that produced them (each carries its parser) |

## Research orchestrator state protocol

Use `research-orchestrator` whenever a project needs durable coordination across tasks, agents, sessions, HPC jobs, reviewers, or reports. It is the project control plane: it records state and handoffs, but it does not replace `comp-chem-workflow` or the engine/tool skills that perform calculations.

- Store machine-readable project state under `.research/`: `project.yaml`, `tasks/*.yaml`, `artifacts.jsonl`, `decisions.jsonl`, `events.jsonl`, and `leases/*.json`. Keep `workflow.md` as the human-readable narrative summary.
- Treat each task file as a DAG node with dependencies, success criteria, `skill`, `required_refs`, `knowledge_required`, `required_checks`, and artifact links. `skill` routes to the procedure or tool that executes the task (`vasp`, `cp2k`, `gaussian`, `structure-prep`, `hpc-submit`, `report`, etc.); `knowledge_required` points into `__NEBULAMAT_AICC_ROOT__/knowledge/` for scientific context.
- For slab, surface, defect, adsorbate, molecule-on-surface, or cluster-on-surface modeling, use a model-structure review gate: first inspect whether usable initial structures are supplied in the current project root/current working directory or in user-explicit input paths only; do not run unbounded `find` over `$HOME`, `/home`, `/opt`, `/`, shared software trees, or unrelated archives. If no structure is present in that bounded scope, `structure-modeler` builds documented candidate models with `structure-prep`; `surface-literature-reviewer` checks Miller index, termination, slab size, coverage, and adsorption motif precedent where available; niche systems with no direct precedent are labeled exploratory, not blocked solely for missing literature; `structure-critic` performs read-only geometry review before engine/HPC handoff. Missing original coordinates routes to self-building, not to a hard block. Slab top/bottom symmetry is not mandatory when it would force the wrong chemistry or excessive cost; stoichiometry and charge balance are judged against the declared chemical environment, separating effectively fixed-valence systems from redox-active or variable-valence systems.
- Multi-agent planning, critique, and result discussion are allowed, but expensive execution has one active owner. Read-only cognitive subagents should use a default wait of 300 seconds; 60 seconds is only a soft status checkpoint, and 600 seconds is the hard timeout for closing a slow reviewer and recording a `multi-agent-timeout` event. Timeout/no-response evidence is `inconclusive`, not a gate block by itself. Long or costly HPC work must be claimed by a single executor with a lease/heartbeat, submitted only after the scientific plan is accepted, and released with provenance or an explicit blocked state.
- State changes should be durable and auditable: decisions and events are append-only logs, artifacts carry evidence and claims, and recovery uses lease reconciliation before any rerun.
- Do not collapse workflow states. `completed` means work finished, `validated` means required checks passed, and `accepted` means a human or authorized reviewer accepted the claim for downstream reporting. `report` consumes accepted claims by default.

## Use what's shipped before improvising

The collection's main failure mode is not missing content — it is reaching for your own model knowledge instead of content that already exists. Before writing a helper, a structure builder, a parser, a figure, or a fix from scratch, assume the collection covers it and **search**: `grep -ri <keyword> __NEBULAMAT_AICC_ROOT__/tools/ __NEBULAMAT_AICC_ROOT__/knowledge/`, and open the relevant tool's `SKILL.md` "Where to find what" table. Routing once at task start is not enough — **re-consult at the moment of need, especially when something breaks.**

Reflexes — when this happens, open that *before* acting:

| Moment | Open first |
|---|---|
| a run crashes, warns, or won't converge | the engine's `references/errors.md` — match the exact stdout/log string before changing any input; one fix at a time |
| about to write engine input files | the engine's `references/running.md` + `references/validation.md` — record the input-standard choices; for VASP this includes ENCUT, k-policy, ISMEAR/SIGMA, spin/U, executable, CPU default `NPAR=4`, optional `KPAR`, or an explicit GPU/site-default rationale with no default `NPAR/NCORE` |
| about to submit or monitor a job | the engine's `references/validation.md` + `hpc-submit` — "job left the queue" is **not** "converged"; gate on the parser |
| about to make any figure | `__NEBULAMAT_AICC_ROOT__/tools/ovito` (structures/trajectories) + `__NEBULAMAT_AICC_ROOT__/tools/multiwfn` (molecular wavefunction fields) + `__NEBULAMAT_AICC_ROOT__/knowledge/scientific-visualization.md` — don't hand-roll a renderer |
| setting up classical MD whose engine/model is ambiguous | `__NEBULAMAT_AICC_ROOT__/knowledge/force-fields.md` and `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-dynamics.md`, then choose `__NEBULAMAT_AICC_ROOT__/tools/gromacs` for biomolecular/liquid/membrane systems or `__NEBULAMAT_AICC_ROOT__/tools/lammps` for materials/reactive/MLP systems |
| a charge, oxidation-state, or bonding claim is in scope | `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md` (+ `bonding-analysis.md`) at *planning* time, not after the run |
| an electrocatalytic step (OER/ORR/HER/CO₂RR/NRR) is the question | `__NEBULAMAT_AICC_ROOT__/knowledge/electrochemistry.md` — the decisive observable is usually the **CHE ΔG step diagram / limiting potential**, not a bare adsorption energy; compute the diagram |
| modeling a supported metal / surface whose **oxidation state** matters | `__NEBULAMAT_AICC_ROOT__/knowledge/electronic-structure.md` "termination sets the oxidation state" — match the surface to the *synthesis condition* (model the O-rich / O-terminated surface for an oxidizing synthesis); do **not** default to the most stable / clean cut, which silently fixes the wrong valence |
| building a slab, supercell, defect, or adsorbate | `__NEBULAMAT_AICC_ROOT__/tools/structure-prep` + `__NEBULAMAT_AICC_ROOT__/procedures/research-orchestrator/references/model-structure-review.md` — use builders, then literature/geometry critic gates before engine handoff |
| writing up results for humans / a final report | `__NEBULAMAT_AICC_ROOT__/tools/report` — relative (not total) energies, data shown on the structure, orthographic top+side figures; produce the `.docx` by default |

This is about discoverability, not obedience: *know what's shipped before you reinvent.* The references stay starting points to adapt, and `__NEBULAMAT_AICC_ROOT__/knowledge/` is never binding (see Lifecycle).

## Lifecycle

Every computation follows this order; do not skip preflight or validation:

```text
intake -> scope & success criteria -> structure prep -> method selection
  -> input generation -> preflight validation -> execution/submission
  -> monitoring & recovery -> parsing -> scientific validation -> record
```

**Propose, then realize.** First form your own *proposal* for how to answer the question computationally — reason it out yourself; the `__NEBULAMAT_AICC_ROOT__/knowledge/` library is optional reference to draw hints from, not a menu to choose from and not binding. Then work out how to realize the proposal: the executing code (VASP, Quantum ESPRESSO, CP2K, …) is a separate, downstream choice driven by availability and the user's/group's convention, and the same proposal can be realized with different codes. Don't let the tool drive the science.

## Global guardrails

- **Never invent**: structures, coordinates, lattice vectors, pseudopotentials, basis sets, force fields, charge/spin states, Hubbard U values, training data, reference states, or convergence evidence. If a parameter is assumed rather than given or verified, label it as an assumption in the output.
- **Never claim production-quality conclusions** from smoke tests, unrelaxed structures, failed runs, or unconverged calculations. Distinguish technical convergence from scientific validity.
- **Literature-derived models are exploratory** unless the original structures and complete method details are available. Do not call a calculation a "reproduction" without them.
- **Missing original structures or method details is not a stop condition.** First check whether usable initial structures exist in the current project root/current working directory or user-explicit input paths. Do not scan `$HOME`, `/home`, `/opt`, `/`, or unrelated storage looking for hidden structures. If the bounded project-local check finds nothing, build a designed/reconstructed model from declared database/literature/manuscript evidence, choose a defensible method fingerprint from surviving evidence and field convention, label every assumption, and route it through plan/structure/result/report gates. What is blocked is unsupported promotion or downstream release without accepted gates, not self-building.
- **Preserve provenance**: keep input files, generated files, commands, job IDs, logs, and parsed outputs. Never report a numeric value without file provenance and units.
- **Units**: eV, Å, fs/ps, K, GPa by default. When an engine uses different conventions (LAMMPS unit styles, GROMACS kJ/mol and nm, Gaussian Hartree), state the unit explicitly with every value.
- **Licensed data**: never print full POTCAR or licensed force-field/potential file contents; reference them by path and version.
- **Reference values are defaults, not endorsements**: U values, INCAR templates, thresholds, and force-field defaults in `__NEBULAMAT_AICC_ROOT__/tools/*/references/` are community starting points meant to be edited into group conventions; when reproducing a paper or following group conventions, the source's settings win.

## Operation mode: semi-automatic by default, autonomous on request

**Default = semi-automatic.** Pause at the workflow's approval breakpoints (e.g. `review-response` Approval #1 plan / #2 package) and present a recommendation; a `contradicts` result halts and is surfaced to the user before any further commitment. These human gates are the point — do not skip them unless the operator opts out.

**Autonomous / unattended mode** applies only when the operator explicitly requests it (no interactive user — e.g. a batch run that must finish on its own). It changes *when you ask*, never *whether you're honest*:

- **Approval gates → documented defaults.** Where the workflow would pause for approval, instead make the most defensible choice from `__NEBULAMAT_AICC_ROOT__/knowledge/` + field convention, record it as a labeled assumption/decision in the workflow state, and continue. Prefer the smallest credible calculation.
- **`contradicts` → flag, don't block.** A result that undermines a manuscript claim is not a stop-and-wait: record it with full prominence as its own clearly flagged finding in the deliverable and run to completion. Never spin, soften, or bury it.
- **Everything else holds unchanged**: never invent parameters; label every assumption and exploratory result; preserve provenance; the deliverable is still a draft and nothing is sent anywhere.

## Site environment (clusters, servers, local conventions)

This collection is environment-agnostic: nothing in it may assume a specific cluster, hostname, scheduler, partition, module name, account, or file path.

**First, are you already on the target machine?** If the agent is running on the cluster itself (not driving it from another machine), there is nothing to connect to and no file transfer — commands run locally. Skip tier 1 and the remote-session step; go straight to the MOTD and `~/.cluster-agents.md`, which are now simply local files in your own home. The tiers below are for the remote case.

Otherwise, discover the cluster's facts in three tiers, cheapest first — most knowledge lives **on the cluster**, not in your local files:

1. **Local bootstrap — just enough to connect.** Before first contact you need only the minimum: the connection command/alias and the file-transfer pattern (the chicken-and-egg facts you can't learn from a machine you haven't reached). This minimum lives **outside this repo** — in the operator's home, your own agent memory, or taught interactively this session — never as a file committed (or written) into the repo tree, since it names a real host. Never guess it, never reuse another user's. Ask the user if it's missing.
2. **On login, read the machine's own announcements.** After connecting, read the login banner / MOTD (and anything it names, e.g. a `clusterinfo` command or a docs path). Clusters often announce partitions, quotas, and policy there. If it points to an operating guide, follow it.
3. **Read the operating guide in the remote home: `~/.cluster-agents.md`.** This is the cluster's own agent guide — scheduler/partitions, modules, code paths, job-script templates, quotas, site policy. It lives on the cluster so it is authored once and every later session and teammate inherits it. If it's absent, gather the facts by asking the user and probing (`sinfo`, `module avail`, ...), then **offer to write `~/.cluster-agents.md`** (template: `__NEBULAMAT_AICC_ROOT__/tools/hpc-submit/references/cluster-guide-template.md`) so the knowledge persists where it belongs.

**Precedence on conflict:** the user's own `~/.cluster-agents.md` wins over any guide the MOTD/banner points to. The MOTD-linked docs are the center's generic defaults; `~/.cluster-agents.md` holds the user's tested, preferred conventions for this work, so where they disagree, follow `~/.cluster-agents.md` (and note the discrepancy if it looks consequential).

Write durable connection facts back to your local bootstrap; write durable operating facts to the remote `~/.cluster-agents.md`. Secrets (tokens, passwords, licensed file contents) go in neither and never into this repo, reports, or commits. **Modern Python**: repo scripts target modern Python and are never downgraded for old system interpreters — obtain a modern interpreter per the guide's recipe (conda/uv/module) and freely create envs/install packages where the guide allows. Repo helper scripts with third-party deps (pymatgen/rdkit/ovito/…) carry inline PEP 723 metadata — **run them with `uv run script.py …`** and uv resolves a per-script isolated, cached env (conflicting tools never clash); never assume the host already has the package, and never hand-build a venv for them. First run needs the index; afterward `uv run --offline` (or `UV_OFFLINE=1`) needs no network. On unstable links or offline compute nodes, warm the per-tool cache once where there is connectivity (HPC: a shared `UV_CACHE_DIR` warmed on the login node), then run offline. uv is the preferred provider (point it at a PyPI mirror via `UV_DEFAULT_INDEX` where the default index is slow); fall back to a prepared **conda/mamba** env (then plain `python script.py`) when a package installs more reliably from conda-forge (notably ovito) or uv/PyPI is blocked. Mirror URLs live in `~/.cluster-agents.md`, never in this repo.

## Approval breakpoints

Stop and ask the user before:

- submitting long or expensive HPC jobs (unless already approved for this batch)
- overwriting existing calculation directories or source data
- deleting files
- choosing among multiple scientifically plausible models, references, or methods
- promoting exploratory results into manuscript or reviewer-response conclusions

## When information is missing

If a required scientific choice cannot be inferred from files or source evidence, ask **one focused question** for the smallest missing input. Do not stack questions or guess silently.
