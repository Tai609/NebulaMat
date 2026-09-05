# MatterGen integration

NebulaMat integrates the pinned Microsoft MatterGen source under `upstream/`
through a small workspace-local runner. The runner owns request validation,
output normalization, and a hash-bound run manifest. The default fine-tuned
`chemical_system` checkpoint is a separately installed workspace asset; it is
not included in the desktop installer. The app provisions Python 3.10 and the
upstream dependencies into its private app-data environment; users do not need
to install MatterGen globally.

Upstream is pinned to commit `ac9ddd406171138c3f037d06b9b53fedbbb1c536` (the
repository head inspected on 2026-08-14) and is MIT licensed:
`https://github.com/microsoft/mattergen`.

## App-managed environment

The desktop runtime exposes the bundled source through
`NEBULAMAT_MATTERGEN_SOURCE` and provisions an isolated environment with the
bundled `uv` executable. The model task invokes the paths exposed by
`NEBULAMAT_MATTERGEN_RUNNER` and `NEBULAMAT_MATTERGEN_SETUP`; in a source
checkout the setup helper can also be run directly with:

```bash
python runtime/mattergen/setup_mattergen.py
```

The helper keeps the environment under the application data directory and
does not modify a user's system Python. The source revision is pinned to
`ac9ddd406171138c3f037d06b9b53fedbbb1c536` and the package version is `1.0.3`.
The first setup still needs network access for platform-specific Python and
PyTorch/PyG wheels.

## Optional model and dataset assets

The GitHub source package intentionally excludes MatterGen checkpoints and
large training datasets. These files are upstream Git LFS assets and are not
required to install NebulaMat. Install a model from the desktop Scientific
environment when generation is needed; the selected model and dataset are
downloaded into the workspace on demand. The bundled source and YAML configs
remain available for inspection and reproducible setup.

Apple Silicon is experimental upstream. Windows is not an upstream-supported
CUDA target; use a registered Linux/Slurm or SSH GPU machine for production
sampling and keep the generated CIFs in the NebulaMat workspace.

## Run a request

The materials page writes a request such as
`materials/design/iteration-1/mattergen/request.json`. From the workspace,
run it with the MatterGen Python interpreter:

```bash
python runtime/mattergen/mattergen_runner.py \
  --request materials/design/iteration-1/mattergen/request.json
```

Use `--dry-run` to validate the request and print the resolved generation plan
without importing MatterGen or downloading a checkpoint. Install the default
model from the desktop Scientific environment page first. The app points
`NEBULAMAT_MATTERGEN_MODELS` at the shared workspace asset and refuses to run a
named pretrained model until its config and checkpoint have passed the pinned
SHA-256 checks. A successful run writes `mattergen-run.json`, the upstream
ZIP/EXTXYZ outputs, and individual `structure-*.cif` files that NebulaMat's
crystal inspector can preview.

MatterGen's upstream CUDA path is primarily Linux + NVIDIA GPU. Native Windows
may require WSL2 or a registered Linux/Slurm/SSH GPU machine if compatible
PyTorch/PyG wheels are unavailable. MatterGen samples are candidates, not
stable or experimentally validated materials. For electrocatalysis, pass
generated bulk candidates through the optional MatterSim-v1.0.0-5M relaxation
screen, then generate surfaces and adsorbate structures for the fairchem/UMA
`uma-s-1p2p1` / `oc25` screen after MatterSim bulk/slab preparation. Calibrate
shortlisted adsorption energies with the existing VASP review workflow. UMA outputs are an
initial ML screening artifact, not experimental evidence; keep the three-energy
protocol and input hashes with the candidate record.
