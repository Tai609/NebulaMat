---
name: comp-chem-workflow
description: Design, prepare, run, validate, and report nontrivial computational chemistry and materials calculations through NebulaMat's AICC engine skills, remote-compute execution, and provenance records.
---

# Computational Chemistry Workflow

Use this controller for any multi-stage DFT, quantum-chemistry, molecular
dynamics, machine-learning-potential, phonon, microkinetic, or HPC calculation.
AICC supplies the engine-specific scientific instructions, references,
preflight scripts, error tables, and parsers. NebulaMat owns approvals,
execution, task state, Runs, and provenance.

## Lifecycle

Follow this order without collapsing stages:

```text
objective -> model and method -> structure -> engine inputs -> preflight
  -> approved remote-compute run -> fetch immutable outputs -> engine parser
  -> engine post-processing -> scientific review -> accepted claim/report
```

1. State the scientific observable, model system, method fingerprint, code,
   execution target, cost class, success criteria, assumptions, and non-goals.
2. Load the selected AICC engine skill. For structures, also load
   `structure-prep`; do not invent coordinates, charge/spin, potentials, basis
   sets, force fields, Hubbard U values, or convergence evidence. For every
   VASP workflow, also load `vaspkit` and freeze a `vaspkit-plan.json`, even
   when the conclusion is that no VASPKIT task is scientifically applicable.
3. Freeze those choices in a versioned run specification before generating
   inputs. A materials workflow uses `DFTRunSpec`; another calculation uses an
   equivalent `CalculationRunSpec` JSON artifact.
4. Run the engine preflight through `validate_calculation.py preflight`. A
   failed preflight blocks submission. A review verdict sets
   `waiver_required: true`; record and resolve that waiver in the run
   specification before submission.
5. Submit only through NebulaMat's `remote-compute`/`hpc-submit` adapter. The
   app-managed SSH configuration, approval boundary, immutable result folders,
   and `record_run.py` remain mandatory.
6. After fetching every output, run `validate_calculation.py result`. Preserve
   its JSON next to the fetched outputs and attach it as task evidence.
7. Resolve the engine post-processing plan. For VASP, run each applicable
   VASPKIT task only after its required upstream VASP result passes the engine
   parser. Preserve the VASPKIT version, executable, task/menu answers, inputs,
   log, generated files, units, and energy reference. `not_applicable` is valid
   only with a recorded scientific reason; a missing executable or config for
   a required task is `blocked`, not `not_applicable`.
8. A separate reviewer decides scientific validity and claim acceptance. A
   clean process exit or technically converged parser result cannot self-assert
   that the model answers the scientific question.

## VASP and VASPKIT contract

VASPKIT is part of every VASP workflow but it remains an assistant around VASP.
The versioned `vaspkit-plan.json` must contain `status`, `task_families`,
`required_inputs`, `commands_or_menu_answers`, `expected_outputs`,
`energy_reference`, `units`, `execution_target`, and `reason`. Use these rules:

- Before VASP, use VASPKIT when the selected method calls for helper input
  generation such as a KPOINTS mesh, band path, selective-dynamics setup, or a
  reviewed POTCAR mapping. Re-run the VASP input preflight on generated files.
- After VASP, use VASPKIT for requested DOS/band extraction, work function,
  charge-density or Bader helpers, elastic/EOS summaries, AIMD analysis, and
  thermochemistry/free-energy corrections.
- A HER free-energy workflow that reports `Delta G_H*` must plan vibrational or
  thermochemical corrections for the adsorbed H state and every other term in
  its declared CHE expression. Use VASPKIT when those corrections come from
  VASP frequencies; if a different cited source or method supplies them,
  record that source and mark only the replaced VASPKIT task `not_applicable`.
- A relaxation-only workflow may record VASPKIT post-processing as
  `not_applicable`; loading the skill and recording the plan are still
  mandatory.

Run VASPKIT and its preflight in the environment that owns the executable and
`~/.vaspkit`, normally the configured remote host. Do not treat the bundled
skill as proof that the VASPKIT executable is installed. Route remote VASPKIT
work through `remote-compute`, and never install it automatically.

## Deterministic adapter

The wrapper discovers the selected AICC skill beside this deployed skill and
normalizes its checker/parser exit code into a stable JSON contract:

```bash
python validate_calculation.py preflight --engine vasp --run-dir calculations/run-01 --out calculations/run-01/preflight.json --strict
python validate_calculation.py result --engine vasp --run-dir results/run-01/20260811-230000-1234 --out results/run-01/20260811-230000-1234/validation.json
```

Create and validate the required VASP post-processing plan with the bundled
deterministic helper. Add `--task-family` when the objective wording alone does
not identify an intended analysis:

```bash
python vaspkit_plan.py create --objective "HER Delta G_H* on Pt" --energy-reference "computational hydrogen electrode" --unit eV --out calculations/run-01/vaspkit-plan.json
python vaspkit_plan.py check --plan calculations/run-01/vaspkit-plan.json
```

After execution, update the plan and each task family to `completed`,
`not_applicable`, or `blocked`, attach actual commands/menu answers and outputs,
then run `check` again. Do not guess VASPKIT task IDs because they can change
between installed versions.

Supported adapters are VASP, CP2K, Gaussian, GROMACS, LAMMPS, DeePMD QA, and
VASPKIT preflight. VASPKIT output validation is task-specific and follows its
`references/validation.md`; do not represent that preflight as a generic result
parser. Other deployed AICC skills remain usable through their own documented
validation steps until a stable generic parser exists.

## Four validation rungs

- `files_exist`: the parser's required output exists.
- `normal_termination`: the engine finished rather than crashing, timing out,
  or merely disappearing from the queue.
- `technically_converged`: the engine-specific parser/checker passed.
- `scientifically_valid`: an independent reviewer accepted the model,
  references, settings, observable, magnitude, uncertainty, and comparison.

The first three rungs are deterministic evidence; a rung is `null` when the
selected helper does not assess it (for example, DeePMD post-processing QA does
not prove how the training process terminated). The fourth is always
`pending_reviewer` when the wrapper returns. Record `accepted`, `limited`,
`inconclusive`, or `contradicts` only through the coordinator/reviewer decision.
Contradictory evidence is surfaced and preserved; it is never hidden or spun.

## State ownership

For materials projects, the existing `materials-workflow` task DAG and
`materials-mcp` SQLite state are authoritative. For a standalone calculation,
keep versioned specifications, inputs, fetched outputs, validation JSON, and
reports in the workspace; Runs and provenance are the durable execution index.
Do not create a second scheduler or shadow task database.
