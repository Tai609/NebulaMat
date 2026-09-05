# DeepMD Dataset Distribution Maps with DPA1 Descriptors

> Load this when: visualizing DeepMD/dpdata dataset coverage, comparing data-source overlap, checking whether new frames fill a missing region, or making PCA/t-SNE plots of dataset distributions. This is a diagnostic workflow, not a production training recipe.

## Core idea

A raw coordinate PCA/t-SNE plot often clusters by atom count, cell size, or arbitrary coordinate origin. A more useful DeepMD-specific diagnostic is to first train a very short DPA1/attention descriptor model, freeze it, then use the frozen model to embed every dataset frame with `DeepPotential.eval_descriptor()`. PCA on these learned descriptors often separates chemically meaningful environments better than PCA/t-SNE on flattened coordinates.

The short model is only an embedding generator. It does not need production accuracy. In
practice, a DPA1-style model trained for about `1000-10000` training steps can be enough
to organize the dataset. This step count is unrelated to the default `10000` filtered
DFT-frame floor for the training dataset. Do not use this short model for MD or final
error claims.

Run this after the first DP model has been trained and tested. For the fixed
DeepMD+LAMMPS QA package, the default PCA scope is all compatible DFT-labeled frames in
the `train`, `val`, and `test` splits, even when the dataset looks simple. For very
heterogeneous datasets, it is also useful before a long final training job. The plot is
especially useful for deciding which additional AIMD temperature or initial model should
be labeled next.

Workflow:

```text
dpdata datasets -> short DPA1 training -> dp freeze -o graph-dpa1.pb
  -> eval_descriptor for each dataset -> flatten/pad descriptors
  -> PCA to 2D -> color by dataset family/source
```

The shipped helper `__NEBULAMAT_AICC_ROOT__/tools/deepmd/scripts/deepmd_descriptor_pca.py` implements the
standard DFT-all QA plot and discovers both `data/<split>/<system>/set.000` and
`data/<system>/<split>/set.000` layouts:

```bash
uv run __NEBULAMAT_AICC_ROOT__/tools/deepmd/scripts/deepmd_descriptor_pca.py \
  --model graph.pb \
  --data-root data \
  --out-dir analysis/deepmd_descriptor_pca_dft_all \
  --figure figures/deepmd_descriptor_pca_dft_all.png
```

If a DeepMD conda/module environment is required to load the model, run the same script
with that environment's `python` and keep the command as provenance. If that environment
lacks `matplotlib`, use `--skip-plot` in the DeepMD environment, then run the same
script from a plotting-capable environment with `--skip-extract --skip-pca` to make the
figure from the saved `X_2d.npy` and `labels.json`.

## Short DPA1 embedding model

Use the same `type_map` as the dataset and a descriptor that can represent the chemistry. A DPA1/attention setup such as `se_atten_v2` is a good embedding model when available in the installed DeePMD-kit version. Keep the run short:

```json
{
  "model": {
    "type_map": ["Elem1", "Elem2", "Elem3"],
    "descriptor": {
      "type": "se_atten_v2",
      "sel": 120,
      "rcut_smth": 1.0,
      "rcut": 7.0,
      "neuron": [25, 50, 100],
      "axis_neuron": 16,
      "attn": 128,
      "attn_layer": 2,
      "attn_dotr": true,
      "attn_mask": false,
      "seed": 1
    },
    "fitting_net": {"neuron": [100, 100, 100], "seed": 1}
  },
  "training": {
    "training_data": {"systems": ["/path/to/dataset/a", "/path/to/dataset/b"]},
    "numb_steps": 1000,
    "disp_file": "lcurve.out",
    "disp_freq": 100,
    "save_freq": 1000
  }
}
```

Then freeze the embedding model:

```bash
dp train input.json > log.train
dp freeze -o graph-dpa1.pb
```

If the project already has a short DPA1 run, reuse its `graph-dpa1.pb`. Record the DeePMD-kit version because descriptor APIs differ between major versions, especially `deepmd.tf.infer.DeepPotential` versus newer interfaces.

## Extract descriptors and run PCA

The practical script pattern is:

```python
import os
import dpdata
import numpy as np
from deepmd.tf.infer import DeepPotential
from sklearn.decomposition import PCA

os.environ["DP_INFER_BATCH_SIZE"] = "1024"
data_dir = "/path/to/deepmd_npy_dataset_root"
model_path = "graph-dpa1.pb"

dp = DeepPotential(model_path)
labels = []
max_length = 0
count = 0

for sub_dir in sorted(os.listdir(data_dir)):
    full_path = os.path.join(data_dir, sub_dir)
    if not os.path.isdir(full_path):
        continue
    count += 1
    sys = dpdata.LabeledSystem(full_path, fmt="deepmd/npy")
    cells = sys.data["cells"].astype(np.float32)
    coords = sys.data["coords"].astype(np.float32)
    atom_types = sys.data["atom_types"]
    highD = dp.eval_descriptor(coords, cells, atom_types)

    # eval_descriptor's return shape is DeePMD-kit-version-dependent: some versions
    # return (n_frames, n_atoms, n_descriptor), others already return it flattened
    # as (n_frames, n_atoms * n_descriptor). Handle both: only reshape if 3-D.
    if highD.ndim == 3:
        n_frames, n_atoms, n_embed = highD.shape
        flat = highD.reshape(n_frames, n_atoms * n_embed)
    else:
        flat = highD  # already (n_frames, n_atoms * n_descriptor)
    max_length = max(max_length, flat.shape[1])
    np.save(f"highD_{count}.npy", flat)
    labels.extend([sub_dir] * n_frames)

np.save("labels.npy", np.array(labels, dtype=object))

all_data = []
for i in range(1, count + 1):
    flat = np.load(f"highD_{i}.npy")
    padded = np.zeros((flat.shape[0], max_length), dtype=np.float32)
    padded[:, :flat.shape[1]] = flat
    all_data.append(padded)

X = np.concatenate(all_data, axis=0)
X_2d = PCA(n_components=2).fit_transform(X)
np.save("X_2d.npy", X_2d)
```

Padding is a pragmatic way to combine datasets with different atom counts. It is acceptable for a coverage diagnostic, but the plot should not be treated as a quantitative metric. If many systems have very different atom counts, also inspect family-wise plots or per-atom/pooled descriptor alternatives.

## Empirical batch-PCA variant

A practical in-house workflow used a deliberately pragmatic variant that can give clearer visual separation than global PCA for mixed surface/cluster/gas datasets:

1. Save each dataset folder's flattened DPA1 descriptors as `highD_1.npy`, `highD_2.npy`, ... .
2. Track the maximum flattened descriptor length and zero-pad shorter datasets to that length.
3. Load a small group of dataset files, for example 10 folders at a time.
4. Run `PCA(n_components=2).fit_transform()` separately for that group.
5. Save `X_2d_batch_0.npy`, `X_2d_batch_1.npy`, ... .
6. Concatenate the 2D batch outputs and plot them with the saved folder labels.

Sketch:

```python
batch_size = 10
all_data = []
batch_count = 0
for i in range(1, count + 1):
    flat = np.load(f"highD_{i}.npy")
    padded = np.zeros((flat.shape[0], max_length), dtype=np.float32)
    padded[:, :flat.shape[1]] = flat
    all_data.append(padded)

    if len(all_data) == batch_size or i == count:
        X_batch = np.concatenate(all_data, axis=0)
        X_2d_batch = PCA(n_components=2).fit_transform(X_batch)
        np.save(f"X_2d_batch_{batch_count}.npy", X_2d_batch)
        batch_count += 1
        all_data = []

X_2d_combined = np.concatenate(
    [np.load(f"X_2d_batch_{i}.npy") for i in range(batch_count)],
    axis=0,
)
```

This is not a mathematically strict common PCA coordinate system, because each batch has its own fitted components. Treat it as an exploratory visualization trick that can make dataset families easier to inspect. For reproducible quantitative reporting, prefer a single global PCA fit or `IncrementalPCA` fit over the same feature matrix.

## Plot and interpret

Plot points by dataset folder, then group labels by chemistry when the folder names are too detailed:

```python
import numpy as np
import matplotlib.pyplot as plt

labels = np.load("labels.npy", allow_pickle=True)
X = np.load("X_2d.npy")

def group(label):
    # Customize these rules for the local folder naming convention.
    if label.startswith(("surface", "slab")):
        return "surface"
    if label.startswith("bulk"):
        return "bulk"
    if label.startswith("gas"):
        return "gas"
    if label.startswith(("interface", "hetero")):
        return "interface"
    if label.startswith(("active", "addition", "new")):
        return "new_data"
    return "other"

groups = [group(x) for x in labels]
for g in sorted(set(groups)):
    idx = [i for i, x in enumerate(groups) if x == g]
    plt.scatter(X[idx, 0], X[idx, 1], s=6, alpha=0.15, label=g)
plt.xlabel("PCA 1")
plt.ylabel("PCA 2")
plt.legend()
plt.savefig("dataset_pca.png", dpi=400, bbox_inches="tight")
```

Use the plot to ask operational questions:

- Are production/exploration frames inside or near the training cloud?
- Do new active-learning frames fill a sparse region or duplicate existing data?
- Are gas, bulk, surface, adsorbate, nanoparticle, and interface data separated as expected?
- Are validation/test frames actually out-of-source, or are they duplicates of training folders?
- Do high model-deviation frames cluster in one under-sampled region?

A separated island is not automatically bad; it may be a necessary part of the target chemistry. A dense overlap is not automatically good; labels may still be noisy or biased. Use this plot beside `dp test`, model deviation, and physics checks.

## t-SNE alternative

t-SNE can be tried on raw padded coordinates or on a PCA-precompressed coordinate matrix:

```python
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE

X_scaled = StandardScaler().fit_transform(padded_features)
X_pca = PCA(n_components=0.95).fit_transform(X_scaled)
X_tsne = TSNE(n_components=2, perplexity=30, random_state=42).fit_transform(X_pca)
```

For this dataset-inspection use case, t-SNE is often less stable and less interpretable than PCA of DPA1 descriptors. Treat it as a supplementary visualization only. Report `perplexity`, random seed, preprocessing, and whether the input was raw coordinates, PCA-compressed coordinates, or DPA1 descriptors.

## Guardrails

- Do not mix incompatible `type_map` orders. The embedding model and every dataset must use the same element order.
- For the fixed DPMD handoff QA package, include every compatible DFT `train`, `val`,
  and `test` frame by default. If memory requires deterministic sampling, record raw and
  sampled frame counts by split and source.
- Plotting DPMD production frames on the PCA map is optional follow-up evidence. It does
  not replace the required DFT-all split coverage map.
- Do not compare descriptor maps from different `graph-dpa1.pb` files unless the model and preprocessing are fixed.
- Do not call PCA/t-SNE clusters proof of accuracy; they show coverage and similarity, not force-field quality.
- Keep labels, folder names, frame counts, and plotting group rules beside the figure.
- Large datasets should save intermediate `highD_*.npy` files and run PCA in manageable batches or with an incremental PCA workflow.
