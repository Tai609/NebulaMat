import { describe, expect, it } from "vitest";
import type { RunRecord } from "@ai4s/shared";
import type { ToolUpdatedEvent } from "@ai4s/sdk";
import { looksLikeExecution, reproduceRunPrompt, runInputFromEvent, surfaceForCommand } from "./runs";

const bash = (over: Partial<ToolUpdatedEvent> = {}): ToolUpdatedEvent => ({
  type: "tool.updated",
  sessionId: "ses_1",
  callId: "call_1",
  tool: "bash",
  status: "success",
  input: { command: "python train.py --lr 3e-4" },
  output: "epoch 1 done\naccuracy 0.93\n",
  startedAt: 1_000,
  endedAt: 9_000,
  ...over,
});

describe("looksLikeExecution", () => {
  it("recognizes interpreter and build/run commands", () => {
    for (const c of [
      "python train.py",
      "python3 -u run.py --seed 1",
      "Rscript fit.R",
      "julia sim.jl",
      "make train",
      "snakemake -j4",
      "nextflow run main.nf",
      "papermill nb.ipynb out.ipynb",
      "torchrun --nproc_per_node=2 train.py",
      "accelerate launch train.py",
      "bash run_experiment.sh",
      "sh ./go.sh",
      "./run.sh",
    ]) {
      expect(looksLikeExecution(c)).toBe(true);
    }
  });

  it("ignores read-only / housekeeping commands", () => {
    for (const c of [
      "ls -la",
      "cat train.py",
      "pwd",
      "cd output && ls",
      "git status",
      "git commit -m x",
      "pip install numpy",
      "echo hello",
      "grep -rn foo .",
      // A marker word buried in a quoted argument is NOT a run.
      'git commit -m "add sbatch submission script"',
      "echo 'see srun docs'",
    ]) {
      expect(looksLikeExecution(c)).toBe(false);
    }
  });

  it("recognizes path-form / venv interpreters, not only a bare `python`", () => {
    for (const c of [
      // Windows venv interpreter by full path (issue #23).
      'C:\\path\\to\\project\\.venv\\Scripts\\python.exe -c "print(1)"',
      // PowerShell call operator in front of the path.
      '& C:\\path\\to\\project\\.venv\\Scripts\\python.exe -c "print(1)"',
      // Windows path with spaces, quoted.
      '"C:\\Program Files\\Python\\python.exe" train.py',
      // POSIX absolute and relative venv interpreters.
      "/home/u/proj/.venv/bin/python train.py",
      "./.venv/bin/python train.py",
      // Bare `python.exe` and versioned names still work.
      'python.exe -c "print(1)"',
      "python3.11 train.py",
      // Env prefix in front of a path-form interpreter.
      "CUDA_VISIBLE_DEVICES=0 /home/u/.venv/bin/python train.py",
    ]) {
      expect(looksLikeExecution(c)).toBe(true);
      expect(surfaceForCommand(c)).toBe("local");
    }
  });

  it("does not mistake a path to a non-interpreter for a run", () => {
    for (const c of [
      "C:\\Windows\\System32\\cmd.exe /c dir",
      "/usr/bin/cat train.py",
      "./configure --prefix=/usr",
    ]) {
      expect(looksLikeExecution(c)).toBe(false);
    }
  });

  it("treats bash/sh as a run only when the first argument is a .sh script", () => {
    expect(looksLikeExecution("bash run_experiment.sh")).toBe(true);
    expect(looksLikeExecution("sh scripts/go.sh")).toBe(true);
    // A `.sh` merely mentioned in a quoted argument is NOT a run.
    expect(looksLikeExecution('bash -c "echo foo.sh"')).toBe(false);
    expect(looksLikeExecution('bash -c "python train.py"')).toBe(false);
  });

  it("records commands prefixed with environment-variable assignments", () => {
    // Ubiquitous in ML — the env prefix must not hide the interpreter.
    expect(looksLikeExecution("CUDA_VISIBLE_DEVICES=0 python train.py")).toBe(true);
    expect(looksLikeExecution("OMP_NUM_THREADS=4 OMP_PROC_BIND=true python run.py")).toBe(true);
    expect(looksLikeExecution("FOO=bar cd exp && python train.py")).toBe(true);
  });

  it("sees through leading cd hops to the real command", () => {
    expect(looksLikeExecution("cd experiment && python train.py")).toBe(true);
    expect(looksLikeExecution("cd a/b && ./run.sh")).toBe(true);
  });

  it("sees through transparent launch wrappers to the real command", () => {
    // Backgrounding/launch wrappers must not hide the interpreter.
    expect(looksLikeExecution("nohup python3 super_snake.py >/dev/null 2>&1 &")).toBe(true);
    expect(looksLikeExecution("time python train.py")).toBe(true);
    expect(looksLikeExecution("timeout 30 python train.py")).toBe(true);
    expect(looksLikeExecution("stdbuf -oL julia sim.jl")).toBe(true);
    expect(looksLikeExecution("nohup cd exp && python train.py")).toBe(true);
    // Still gated by the interpreter allowlist — a wrapped non-run stays out.
    expect(looksLikeExecution("nohup rsync -a a/ b/")).toBe(false);
    expect(looksLikeExecution("timeout 5 sleep 3")).toBe(false);
  });

  it("recognizes HPC/Modal/notebook batch commands even when not the head", () => {
    // Submitted over SSH — sbatch isn't the head, but it's still a run.
    expect(looksLikeExecution('ssh cluster "sbatch train.slurm"')).toBe(true);
    expect(looksLikeExecution("srun python train.py")).toBe(true);
    expect(looksLikeExecution("modal run app.py")).toBe(true);
    expect(looksLikeExecution("papermill nb.ipynb out.ipynb")).toBe(true);
  });
});

describe("surfaceForCommand", () => {
  it("classifies the compute surface a command targets", () => {
    expect(surfaceForCommand("python train.py")).toBe("local");
    expect(surfaceForCommand('ssh cluster "sbatch train.slurm"')).toBe("hpc");
    expect(surfaceForCommand("srun --gpus=1 python train.py")).toBe("hpc");
    expect(surfaceForCommand("modal run app.py")).toBe("modal");
    expect(surfaceForCommand("papermill nb.ipynb out.ipynb")).toBe("jupyter");
    expect(surfaceForCommand("jupyter nbconvert --execute nb.ipynb")).toBe("jupyter");
  });

  it("does not treat a marker word inside an argument as a remote surface", () => {
    expect(surfaceForCommand('git commit -m "add sbatch script"')).toBe("local");
    expect(surfaceForCommand("python a.py --note 'use srun'")).toBe("local");
  });
});

describe("runInputFromEvent", () => {
  it("derives a run from a successful execution command", () => {
    expect(runInputFromEvent(bash())).toEqual({
      eventId: "call_1",
      command: "python train.py --lr 3e-4",
      log: "epoch 1 done\naccuracy 0.93\n",
      startedAt: 1_000,
      endedAt: 9_000,
      status: "ok",
      surface: "local",
    });
  });

  it("skips remote submissions — the remote-compute/modal-run skills record those with real remote facts", () => {
    // The local passive capture can't see remote env/hardware/outputs, so it
    // stays out of the way rather than stamping the laptop's environment.
    expect(runInputFromEvent(bash({ input: { command: "modal run app.py" } }))).toBeNull();
    expect(runInputFromEvent(bash({ input: { command: "srun python train.py" } }))).toBeNull();
    expect(runInputFromEvent(bash({ input: { command: 'ssh cluster "sbatch train.slurm"' } }))).toBeNull();
  });

  it("records a failed run too (a crashed experiment is provenance)", () => {
    const r = runInputFromEvent(bash({ status: "failed", output: "Traceback…" }));
    expect(r?.status).toBe("failed");
  });

  it("accepts compatibility execution-tool aliases and command fields", () => {
    for (const tool of ["shell", "exec", "execute", "run", "run_command"]) {
      expect(runInputFromEvent(bash({ tool, input: { cmd: "python train.py" } }))).toMatchObject({
        command: "python train.py",
        status: "ok",
      });
    }
    expect(runInputFromEvent(bash({ tool: "execute", input: { script: "python train.py" } }))).toMatchObject({
      command: "python train.py",
    });
  });

  it("records a nohup-launched run, preserving the ORIGINAL command verbatim", () => {
    // The wrapper only feeds detection — the recorded command keeps `nohup`,
    // redirections, and the trailing `&` so Reproduce re-runs exactly this.
    const cmd = "nohup python3 super_snake.py >/dev/null 2>&1 &";
    const r = runInputFromEvent(bash({ input: { command: cmd } }));
    expect(r).not.toBeNull();
    expect(r?.command).toBe(cmd);
    expect(r?.surface).toBe("local");
  });

  it("ignores non-bash, non-terminal, pathless, and non-execution commands", () => {
    expect(runInputFromEvent(bash({ tool: "write" }))).toBeNull();
    expect(runInputFromEvent(bash({ status: "running" }))).toBeNull();
    expect(runInputFromEvent(bash({ status: "pending" }))).toBeNull();
    expect(runInputFromEvent(bash({ input: {} }))).toBeNull();
    expect(runInputFromEvent(bash({ input: { command: "ls -la" } }))).toBeNull();
  });
});

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  runId: "run_ab12cd34",
  ts: 1_700_000_000,
  sessionId: "ses_1",
  command: "python train.py --lr 3e-4",
  status: "ok",
  wallMs: 8_000,
  code: [{ path: "train.py", hash: "aaaa", size: 512 }],
  outputs: [
    { path: "output/metrics.json", hash: "bbbb", size: 64 },
    { path: "output/model.pt", size: 2_000_000 },
  ],
  env: {
    python: "3.11.4",
    platform: "linux-x86_64",
    app: "0.1.3",
    packages: { count: 51, hash: "deadbeef" },
    hardware: { cpu: "AMD EPYC 7742", cores: 64, memGb: 512, gpu: ["NVIDIA A100-SXM4-40GB"], accelerator: "cuda" },
  },
  ...over,
});

describe("reproduceRunPrompt", () => {
  it("drafts a recipe: command, env, hardware, code version, and outputs to compare", () => {
    const p = reproduceRunPrompt(run());
    expect(p).toContain("python train.py --lr 3e-4");
    expect(p).toContain("run_ab12cd34");
    expect(p).toContain("Python 3.11.4");
    expect(p).toContain("linux-x86_64");
    expect(p).toContain("NVIDIA A100-SXM4-40GB");
    // The lockfile pointer so a differing result can be pinned to versions.
    expect(p).toContain(".openscience/env/deadbeef.txt");
    // Compares the recorded outputs, not source text.
    expect(p).toContain("output/metrics.json");
    expect(p).toContain("output/model.pt");
    // Code version is pinned by hash so script drift is detectable.
    expect(p).toContain("train.py");
  });

  it("degrades gracefully when env/outputs were not captured", () => {
    const p = reproduceRunPrompt(run({ env: undefined, outputs: [], code: [], wallMs: undefined }));
    expect(p).toContain("python train.py --lr 3e-4");
    // No env clause, no crash, no phantom files.
    expect(p).not.toContain("undefined");
    expect(p).not.toContain(".openscience/env/");
  });

  it("survives records with code/outputs fields absent (empty arrays omitted by the store)", () => {
    // The Rust store omits empty code/outputs arrays, so a real record can have
    // them undefined — the prompt must not throw on `.length`.
    const bare = { ...run(), code: undefined, outputs: undefined } as unknown as RunRecord;
    expect(() => reproduceRunPrompt(bare)).not.toThrow();
    expect(reproduceRunPrompt(bare)).toContain("python train.py --lr 3e-4");
  });
});
