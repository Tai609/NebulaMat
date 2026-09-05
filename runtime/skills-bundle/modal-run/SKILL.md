---
name: modal-run
description: Use when the user asks to run heavy or GPU work on Modal (the cloud compute platform) — writing a Modal function in the workspace, running it with the user's own `modal` CLI + token, and bringing results back. Data-to-compute for jobs too big for the laptop, without a Slurm cluster.
---

# Run compute on Modal

Modal runs code in the cloud on demand (CPU/GPU), billed to the **user's own**
Modal account. Like the HPC/Slurm path, the app never handles credentials — you
use the user's installed `modal` CLI and their token. Prefer local execution or
Slurm first; reach for Modal when the job needs cloud GPUs or elastic scale and
no cluster is available.

## 1 · Check Modal is ready

Modal must be installed and authenticated (the Settings **Cloud compute (Modal)**
card shows this). Verify before writing code:

```bash
modal --version          # installed?
test -f ~/.modal.toml && echo "authenticated" || echo "run: modal token new"
```

If it is not installed, tell the user to `pip install modal`; if not
authenticated, ask them to run `modal token new` in their terminal (it opens a
browser). Do **not** attempt to create or store tokens yourself.

## 2 · Write the Modal function into the workspace

Put the script in the workspace so provenance records it. Pin dependencies in
the image so the run is reproducible, and fix any random seed.

```python
# compute.py — run with:  modal run compute.py
import modal

app = modal.App("open-science-job")
image = modal.Image.debian_slim().pip_install("numpy==1.26.4", "scipy==1.13.1")

@app.function(image=image, gpu=None, timeout=1800)  # set gpu="A10G" etc. if needed
def run(n: int = 1_000_000):
    import numpy as np
    rng = np.random.default_rng(0)          # fixed seed → reproducible
    x = rng.standard_normal(n)
    return {"n": n, "mean": float(x.mean()), "std": float(x.std())}

@app.local_entrypoint()
def main():
    result = run.remote()
    print(result)                            # printed locally; capture it below
```

## 3 · Run it and capture the result

`modal run` executes remotely and streams logs + the local entrypoint's stdout
back. Write the result into a fresh, immutable result directory so it becomes a
traceable artifact and does not overwrite a previous run:

```bash
RESULT=results/<job-name>/<YYYYmmdd-HHMMSS>
mkdir -p "$RESULT"
modal run compute.py | tee "$RESULT"/modal_result.txt
```

For large outputs, have the function write to a Modal Volume and download with
`modal volume get`, rather than returning big objects. Download every run into
its own `RESULT` directory; never reuse a recorded output path.

## 4 · Record the run (reproducibility) — REQUIRED, every time

Modal runs on remote cloud hardware the app can't see, so this call is the ONLY
thing that makes the run exist in Runs. Do it after **every** completed run —
including quick re-runs. Skipping it loses the run entirely (it shows in neither
the global Runs view nor the session). Record it after it completes (from the
workspace root):

Record it completely: `--code` once per script that ran, and `--output` once
per file you captured or downloaded (the streamed result **and** any
`modal volume get` files) — not just the summary. Output paths must be under the
fresh `RESULT` directory; the helper refuses to record paths used by earlier
runs.

```bash
python "$XDG_CONFIG_HOME/opencode/skills/modal-run/record_run.py" \
  --surface modal --command "modal run compute.py" \
  --status <ok|failed> --host "modal:<app-name>" \
  --hardware "<the gpu= from @app.function, e.g. A10G — or 'CPU'>" \
  --code compute.py --output "$RESULT"/modal_result.txt \
  --output "$RESULT"/<each downloaded file> \
  --session-id "$(cat .openscience/session.txt 2>/dev/null)"
```

`--session-id` attaches the run to this session (empty-safe if the marker's absent).

The environment is reproduced by the `modal.Image` definition in `compute.py`
(pinned `pip_install` + base image — already versioned in the workspace), so
record the GPU/hardware string, not a package list, and no `--env-file` is
needed. Use `--status failed` if the run errored.

## Rules

- **User's account only.** Never handle, print, or store Modal tokens.
- **Reproducible.** Pin image packages and fix seeds; record the script + result
  in the workspace (provenance captures them).
- **Cost-aware.** Modal bills the user — keep `timeout` bounded, don't request a
  GPU unless the work needs one, and say what you're about to run before a large
  job.
