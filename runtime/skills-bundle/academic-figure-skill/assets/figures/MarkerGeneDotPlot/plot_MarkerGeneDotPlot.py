from pathlib import Path
import pandas as pd
import numpy as np
import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from matplotlib import transforms


CELL_TYPES = [
    "VCT", "EVT", "SCT", "DSC", "eS", "FB", "PV", "eEpi", "Cili",
    "mVEC", "fVEC", "LEC", "B", "T", "dNK", "M", "HB", "DC", "Ery"
]

GENES = [
    "TP63", "TIMP3", "IFI6", "HLA-G", "PRG2", "ERVW-1", "HOPX", "DKK1", "VIM",
    "PGR", "IGF1", "BMP5", "DPPN", "ACTA2", "AFF2", "POU5F1", "PAEP", "KRT7",
    "TP73", "PECAM1", "VWF", "MECOM", "PROX1", "CCL21", "IGHM", "BCL11A",
    "CD3D", "GNLY", "NKG7", "MS4A7", "CD14", "MRC1", "LYVE1", "HLA-DRA",
    "CD74", "HBA1", "HBB"
]

LEFT_NUMBERS = [18, 19, 17, 15, 16, 14, 13, 8, 9, 10, 11, 12, 6, 7, 5, 2, 1, 3, 4]
LEFT_COLORS = [
    "#5a4a9c", "#f06597", "#3f7fbf", "#4caf50", "#33a37a",
    "#8b5a3c", "#c4876a", "#6f8ed6", "#2ba88f", "#e55c30",
    "#f0b44d", "#c8bc2f", "#a843a8", "#8f8fbe", "#8fa34d",
    "#c0a28a", "#d2b681", "#9ea8b8", "#8a7466"
]
mpl.rcParams["font.family"] = "sans-serif"
mpl.rcParams["font.sans-serif"] = ["Arial", "DejaVu Sans", "Liberation Sans"]
mpl.rcParams["pdf.fonttype"] = 42   
mpl.rcParams["ps.fonttype"] = 42

def plot_reference_style(dot_df: pd.DataFrame, out_png: Path, out_pdf: Path | None = None) -> None:
    required = {"cell_type", "gene", "pct_exp", "avg_exp_scaled"}
    missing = required - set(dot_df.columns)
    df = dot_df.copy()
    df["cell_type"] = pd.Categorical(df["cell_type"], categories=CELL_TYPES, ordered=True)
    df["gene"] = pd.Categorical(df["gene"], categories=GENES, ordered=True)
    df = df.dropna(subset=["cell_type", "gene"]).sort_values(["cell_type", "gene"]).reset_index(drop=True)

    x_map = {g: i for i, g in enumerate(GENES)}
    y_map = {c: i for i, c in enumerate(CELL_TYPES)}
    df["x"] = df["gene"].map(x_map).astype(float)
    df["y"] = df["cell_type"].map(y_map).astype(float)

    fig = plt.figure(figsize=(10, 5), dpi=300)
    fig.patch.set_facecolor("white")

    ax = fig.add_axes([0.10, 0.14, 0.71, 0.76])
    ax.set_facecolor("white")

    cmap = LinearSegmentedColormap.from_list(
        "nature_bwr",
        ["#2c5aa0", "#6f8fc8", "#f5f5f5", "#e89b8e", "#c23a2b"],
    )

    p = np.clip(df["pct_exp"].to_numpy(), 0.0, 60.0)
    s_min, s_max = 5.0, 140.0
    sizes = s_min + (s_max - s_min) * np.sqrt(p / 60.0)

    sc = ax.scatter(
        df["x"],
        df["y"],
        s=sizes,
        c=np.clip(df["avg_exp_scaled"].to_numpy(), 0.0, 1.0),
        cmap=cmap,
        vmin=0,
        vmax=1,
        edgecolors="#6e6e6e",
        linewidths=0.6,
        alpha=1.0,
    )

    ax.set_xlim(-0.8, len(GENES) - 0.2)
    ax.set_ylim(-0.8, len(CELL_TYPES) - 0.2)
    ax.invert_yaxis()

    ax.set_xticks(range(len(GENES)))
    ax.set_xticklabels(GENES, rotation=90, ha="center", va="top", fontsize=12, fontstyle="italic")
    ax.set_yticks(range(len(CELL_TYPES)))
    ax.set_yticklabels(CELL_TYPES, fontsize=14)
    ax.tick_params(axis="y", pad=8)

    ax.tick_params(axis="x", length=3, width=0.8, color="#666666")
    ax.tick_params(axis="y", length=0)

    for side in ["top", "right", "left", "bottom"]:
        ax.spines[side].set_visible(True)
        ax.spines[side].set_color("#8d8d8d")
        ax.spines[side].set_linewidth(1.0)

    # 把编号圆点放到左侧边框外部（axes外），避免与y轴标签重叠
    trans = transforms.blended_transform_factory(ax.transAxes, ax.transData)
    x_out = -0.12
    for i, ct in enumerate(CELL_TYPES):
        y = y_map[ct]
        ax.scatter(
            x_out,
            y,
            s=160,
            c=LEFT_COLORS[i],
            edgecolors="#6d6d6d",
            linewidths=0.6,
            zorder=7,
            transform=trans,
            clip_on=False,
        )
        ax.text(
            x_out,
            y,
            str(LEFT_NUMBERS[i]),
            color="black",
            fontsize=9,
            ha="center",
            va="center",
            fontweight="bold",
            zorder=8,
            transform=trans,
            clip_on=False,
        )

    leg_ax = fig.add_axes([0.845, 0.50, 0.14, 0.38])
    leg_ax.set_axis_off()
    levels = [60, 50, 40, 30, 20, 10]
    ys = np.linspace(0.85, 0.15, len(levels))
    for yv, lv in zip(ys, levels):
        s = s_min + (s_max - s_min) * np.sqrt(lv / 60.0)
        leg_ax.scatter(0.25, yv, s=s, c="#8f8f8f", edgecolors="#5e5e5e", linewidths=1.0)
        leg_ax.text(0.42, yv, f"{lv}", va="center", fontsize=12)
    leg_ax.text(0.00, 0.50, "Fraction of cells\nin group (%)", rotation=90,
                va="center", ha="center", fontsize=13)
    leg_ax.set_xlim(0, 1)
    leg_ax.set_ylim(0, 1)

    cax = fig.add_axes([0.872, 0.15, 0.016, 0.24])
    cb = plt.colorbar(sc, cax=cax)
    cb.set_ticks([0.0, 0.5, 1.0])
    cb.ax.tick_params(labelsize=12)
    cb.outline.set_edgecolor("#5e5e5e")
    cb.outline.set_linewidth(1.0)

    fig.text(0.842, 0.27, "Mean expression\nin group", rotation=90,
             va="center", ha="center", fontsize=13)

    plt.savefig(out_png, dpi=300)
    if out_pdf is not None:
        plt.savefig(out_pdf, format="pdf")
    plt.close(fig)


def main() -> None:
    if "__file__" in globals():
        base = Path(__file__).resolve().parent
    else:
        base = Path.cwd()

    data_path = base / "dataset.csv"
    dot_df = pd.read_csv(data_path)
    plot_reference_style(
        dot_df,
        out_png=base / "Figure.png",
        out_pdf=base / "Figure.pdf",
    )

if __name__ == "__main__":
    main()