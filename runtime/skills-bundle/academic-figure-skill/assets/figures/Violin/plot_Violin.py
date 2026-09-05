import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
import itertools
from statannotations.Annotator import Annotator
import random
import re

random.seed(0)

import matplotlib as mpl
mpl.rcParams['figure.dpi'] = 300
mpl.rcParams['savefig.dpi'] = 300
plt.rcParams['svg.fonttype'] = "none"


def _find_columns(df, query_cols):
    def normalize(s):
        return re.sub(r"[^a-zA-Z0-9]", "", str(s)).lower()
    df_cols = {normalize(c): c for c in df.columns}
    matched = []
    for q in query_cols:
        nq = normalize(q)
        if nq in df_cols:
            matched.append(df_cols[nq])
        else:
            # fuzzy fallback
            found = None
            for k, v in df_cols.items():
                if nq in k or k in nq:
                    found = v
                    break
            if found:
                matched.append(found)
    return matched


def violin_plot_with_stats(
    df: pd.DataFrame,
    value_cols: list,
    group_col: str,
    categories: tuple = None,
    palette: str = "coolwarm_r",
    figsize: tuple = (6, 4),
    test: str = "Mann-Whitney",
    correction: str = "Bonferroni",
    orient: str = "h",
    xlim: tuple = None,
    save_path: str = None,
    show_stats: bool = True
):


    existing_cols = _find_columns(df, value_cols)
    if len(existing_cols) == 0:
        raise ValueError(
            f"No matching value columns found.\nRequested: {value_cols}\nAvailable: {df.columns.tolist()}"
        )


    if group_col not in df.columns:
        raise ValueError(f"group_col '{group_col}' not found in df columns.")

    df = df.dropna(subset=[group_col])


    if categories is None:
        categories = tuple(df[group_col].dropna().unique())
    else:
        categories = tuple([c for c in categories if c in df[group_col].unique()])
    if len(categories) < 2:
        show_stats = False


    df_melt = df.set_index([group_col])[existing_cols].melt(ignore_index=False).reset_index()


    g = sns.catplot(
        data=df_melt,
        kind="violin",
        row="variable" if len(existing_cols) > 1 else None,
        x="value" if orient=="h" else group_col,
        y=group_col if orient=="h" else "value",
        palette=palette,
        order=categories,
        height=figsize[1],
        aspect=figsize[0]/figsize[1],
        sharex=False,
        cut=0,
    )


    if show_stats and len(categories) > 1:
        pairs = list(itertools.combinations(categories, 2))
        axes = g.axes.flatten() if len(existing_cols) > 1 else [g.ax]

        for i, ax in enumerate(axes):
            try:
                ax.set_ylabel("")

                # 当前 subplot 对应的 variable
                variable = existing_cols[i] if len(existing_cols) > 1 else existing_cols[0]

                annotator = Annotator(
                    ax=ax,
                    data=df_melt[df_melt['variable'] == variable],
                    x="value" if orient=="h" else group_col,
                    y=group_col if orient=="h" else "value",
                    order=categories,
                    pairs=pairs,
                    orient=orient,
                )

                annotator.configure(
                    test=test,
                    text_format="star",
                    loc="inside",
                    verbose=0,
                    comparisons_correction=correction,
                )
                annotator.apply_and_annotate()

            except Exception as e:
                print(f"[Warn] stats skipped on subplot {i}: {e}")

            if xlim is not None:
                ax.set_xlim(*xlim)

    if save_path:
        g.figure.savefig(save_path, bbox_inches="tight", dpi=300)

    return g
    
    
df = pd.read_csv("./dataset.csv")

g = violin_plot_with_stats(
    df=df,
    value_cols=["phylo distance", "functional distance"], 
    group_col="category",
    categories=("negative assoc.", "unlinked", "positive assoc."),
    palette="coolwarm_r",
    figsize=(6,3),
    orient="h",
    xlim=(0,1.3),
    save_path="./violin_plot.png",
    show_stats=True
)