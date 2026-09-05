# -*- coding: utf-8 -*-

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.stats import mannwhitneyu
from typing import List, Tuple, Optional, Callable, Sequence

def plot_violin_significance(
    df: pd.DataFrame,
    groups_order: Sequence[str],
    pairs: List[Tuple[str, str]],
    colors: Optional[Sequence[str]] = None,           # 自定义颜色序列
    color_map: Optional[Callable[[str], str]] = None, # 或用函数自动根据组名返回颜色
    figsize: Tuple[float, float] = (7, 5),            # 画布大小
    ylim: Optional[Tuple[float, float]] = None,       # y轴范围，可自动扩展
    ylabel: str = "Prediction gap (years)",
    show_points: bool = True,
    jitter_sd: float = 0.06,
    pad_above_violin: float = 0.8,
    base_gap_coef: float = 0.08,
    overlap_coef: float = 0.45,
    span_weight_step: float = 0.25,
    text_offset: float = 0.25,
    line_width: float = 1.0,
    text_size: float = 9.0,
    save_path: Optional[str] = None,
    p_filter: Optional[Callable[[float], bool]] = None,   # 筛选p值（如 lambda p: p<0.05）
    test_func: Callable[[np.ndarray, np.ndarray], float] = None,  # 可替换为 t 检验
):
    """绘制提琴图 + 显著性横线"""

    # ==== 默认统计函数与文本格式 ====
    if test_func is None:
        def test_func(a, b): return mannwhitneyu(a, b, alternative="two-sided").pvalue
    def p_text(p):
        if p <= 1e-5: return "P ≤ 1×10⁻⁵"
        elif p < 0.001: return "P < 0.001"
        else: return f"P = {p:.2g}"

    # ==== 提取数据 ====
    cols = [c for c in groups_order if c in df.columns]
    data = [df[c].dropna().to_numpy() for c in cols]
    positions = np.arange(1, len(data) + 1)
    name2idx = {n: i for i, n in enumerate(cols)}

    # ==== 计算 p 值 ====
    pairs_idx = [(name2idx[a], name2idx[b]) for a, b in pairs if a in name2idx and b in name2idx]
    pvals = {p: test_func(data[p[0]], data[p[1]]) for p in pairs_idx}
    if p_filter:
        pvals = {p: v for p, v in pvals.items() if p_filter(v)}
    labels = {p: p_text(v) for p, v in pvals.items()}

    # ==== 画布 ====
    fig, ax = plt.subplots(figsize=figsize)
    
    # ==== 自动配色 ====
    if color_map:
        colors = [color_map(name) for name in cols]
    elif colors is None:
        colors = plt.cm.tab20(np.linspace(0, 1, len(cols)))

    # ==== 提琴图 ====
    parts = ax.violinplot(data, positions=positions, showmeans=False,
                          showmedians=False, showextrema=False, widths=0.85)
    for i, body in enumerate(parts["bodies"]):
        body.set_facecolor(colors[i % len(colors)])
        body.set_edgecolor("black")
        body.set_linewidth(0.8)
        body.set_alpha(1.0)

    # ==== 获取顶部y值 ====
    y_tops = []
    for i, body in enumerate(parts["bodies"]):
        verts = body.get_paths()[0].vertices
        ymin, ymax = verts[:, 1].min(), verts[:, 1].max()
        y_tops.append(ymax)
        ax.plot([positions[i], positions[i]], [ymin, ymax],
                color="black", lw=0.8, alpha=0.8, zorder=2)

    # ==== 散点 ====
    if show_points:
        np.random.seed(42)
        for i, vals in enumerate(data):
            jitter = np.random.normal(0, jitter_sd, len(vals))
            ax.scatter(np.full_like(vals, positions[i]) + jitter, vals,
                       s=10, color="black", alpha=0.6, zorder=3)

    # ==== 坐标 ====
    ax.set_xlim(0.5, len(data) + 0.5)
    if ylim:
        ax.set_ylim(*ylim)
    ax.set_ylabel(ylabel)
    ax.set_xticks(positions)
    ax.set_xticklabels([c.replace(" ", "\n") for c in cols], rotation=0)
    ax.yaxis.grid(True, linestyle="-", linewidth=0.4, alpha=0.5)
    ax.set_axisbelow(True)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)

    # ==== 显著性横线 ====
    def overlaps(a1, a2, b1, b2):
        return not (a2 <= b1 or a1 >= b2)

    pairs_xy = [(a + 1, b + 1, labels[(a, b)]) for (a, b) in pairs_idx if (a, b) in labels]
    pairs_xy.sort(key=lambda t: (t[1] - t[0], t[0]))
    base_gap = max(1.0, base_gap_coef * np.mean([len(s) for _, _, s in pairs_xy]))

    placed = []
    for x1, x2, lab in pairs_xy:
        y = max(y_tops[x1 - 1], y_tops[x2 - 1]) + pad_above_violin
        span = x2 - x1
        span_weight = 1.0 + max(0, (2 - span)) * span_weight_step

        bumped = True
        while bumped:
            bumped = False
            for px1, px2, py in placed:
                if overlaps(x1, x2, px1, px2):
                    overlap_len = max(0.0, min(x2, px2) - max(x1, px1))
                    min_gap = base_gap * (5 + overlap_coef * overlap_len) * span_weight
                    if y < py + min_gap:
                        y = py + min_gap
                        bumped = True
                        break
        ax.plot([x1, x2], [y, y], lw=line_width, c="black", zorder=4)
        ax.text((x1 + x2) / 2, y + text_offset, lab, ha="center", va="bottom",
                fontsize=text_size, color="black", zorder=5)
        placed.append((x1, x2, y))

    # ==== 自动扩展y轴 ====
    if placed:
        top_y = max(y for *_, y in placed) + 1.2
        lo, hi = ax.get_ylim()
        ax.set_ylim(lo, max(hi, top_y))

    plt.tight_layout()
    if save_path:
        plt.savefig(save_path, dpi=300, bbox_inches="tight")
    return fig, ax


df = pd.read_csv("Violin-data.csv")

groups = [
    "HC LAC male","HC LAC female",
    "MCI male","MCI female",
    "AD male","AD female",
    "bvFTD male","bvFTD female"
]
pairs = [
    ("HC LAC male","HC LAC female"),
    ("MCI male","MCI female"),
    ("AD male","AD female"),
    ("bvFTD male","bvFTD female"),
    ("HC LAC female","AD female"),
    ("HC LAC male","AD female"),
]

colors = ["#bad7e9", "#dff6ff",
          "#bdd2e6", "#d5d7d8",
          "#c7e8c2", "#d8fed7",
          "#fdbaa3", "#fedcdd"]

plot_violin_significance(
    df, groups, pairs,
    colors=colors,
    figsize=(6, 4),
    p_filter=lambda p: p < 0.05,
    save_path="violin.png"
)

plt.show()