import os
import itertools

import numpy as np
import pandas as pd
import matplotlib as mpl
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import seaborn as sns
import scipy as sci
import scipy.optimize as sciopt
from statannotations.Annotator import Annotator

# =============================================================================
# ★ 集中配置区：所有可调参数在此修改
# =============================================================================
CONFIG = {
    # ------ 输出路径 ------
    "figure_dir": "./figures",
    "table_dir":  "./tables",

    # ------ 数据列名 ------
    "col_x":    "length",           # x 轴：基因组大小
    "col_y":    "number_of_cds",    # y 轴：CDS 数量
    "col_type": "type",             # 分组列
    "col_drep": "is_drep95",        # dRep 过滤列

    # ------ 分组类别及顺序 ------
    "type_order": ["SAG", "MAG", "WGS"],

    # ------ 质量等级配置 ------
    # key: 质量标签, value: (图例前缀, 对应的 df 布尔列名)
    "qualities": {
        "HQ":  ("HQ",         "is_hq"),
        "MHQ": ("HQ+MHQ",     "is_mhq"),
        "MQ":  ("HQ+MHQ+MQ",  None),    # None 表示 df.any(axis=1)
    },

# ------ 学术配色（SAG / MAG / WGS）Nature风格 ------
    # 主图散点 & 边缘 KDE
    "palette_joint": {
        "SAG": "#3B6C9E",   # 深蓝（Nature经典蓝）
        "MAG": "#D67A3A",   # 赭石橙（Nature暖色）
        "WGS": "#7F7F7F",   # 中性灰（Nature常用灰）
    },
    # 残差箱线图（WGS / MAG / SAG 顺序）- 更淡的版本用于子图
    "palette_box": {
        "WGS": "#B0B0B0",   # 浅灰
        "MAG": "#E8A670",   # 浅橙
        "SAG": "#6B9EC7",   # 浅蓝
    },
    # 线性拟合线颜色
    "color_fit_line": "#8B3A3A",    # 深赤褐色（Nature常用红棕）

    # ------ 图形尺寸 ------
    "joint_height": 4.5,

    # ------ 坐标轴范围 ------
    "xlim": (3e5, 3e7),
    "ylim": (400, 15000),

    # ------ 残差 inset 位置 (x0, y0, width, height)，ax_joint 坐标系 ------
    "inset_bbox": (0.42, 0.09, 0.6, 0.25),
}

# =============================================================================
# 工具函数
# =============================================================================

def _lin_law(x, a, b):
    """对数空间线性模型。"""
    return a * x + b


def _make_inset_ax(fig, parent_ax, bbox):
    """
    在 parent_ax 的相对坐标 bbox=(x0,y0,w,h) 处创建 inset axes。
    使用 fig.add_axes 替代 inset_axes，避免新版 matplotlib 中
    AnchoredLocator.figure=None 导致 savefig 崩溃。
    """
    trans     = parent_ax.transAxes
    fig_trans = fig.transFigure.inverted()
    x0, y0, w, h = bbox
    pts     = trans.transform([[x0, y0], [x0 + w, y0 + h]])
    pts_fig = fig_trans.transform(pts)
    fig_bbox = [
        pts_fig[0, 0], pts_fig[0, 1],
        pts_fig[1, 0] - pts_fig[0, 0],
        pts_fig[1, 1] - pts_fig[0, 1],
    ]
    return fig.add_axes(fig_bbox)


def _save_figure(fig, figure_dir, stem, formats=("svg", "pdf", "png")):
    """将 fig 保存为多种格式。"""
    for ext in formats:
        out_dir = os.path.join(figure_dir, ext)
        os.makedirs(out_dir, exist_ok=True)
        fig.savefig(
            os.path.join(out_dir, f"{stem}.{ext}"),
            bbox_inches="tight",
            dpi=300,
            facecolor="white",
        )


# =============================================================================
# 核心绘图函数
# =============================================================================

def plot_cds_vs_genome_size(
    df,
    config=None,
    custom_display_fn=None,
):
    """
    绘制 CDS 数量 vs 基因组大小的 jointplot，
    并进行线性回归 + Mann-Whitney U 检验。

    Parameters
    ----------
    df : pd.DataFrame
        包含所需列的数据框。
    config : dict, optional
        配置字典，默认使用全局 CONFIG。
    custom_display_fn : callable, optional
        用于展示结果表格的函数，如 custom_display。

    Returns
    -------
    mannwhitneyu_results_df : pd.DataFrame
        所有 Mann-Whitney U 检验结果。
    """
    cfg = config or CONFIG

    # 解包常用配置
    col_x    = cfg["col_x"]
    col_y    = cfg["col_y"]
    col_type = cfg["col_type"]
    col_drep = cfg["col_drep"]
    type_order   = cfg["type_order"]
    pal_joint    = cfg["palette_joint"]
    pal_box      = cfg["palette_box"]
    inset_bbox   = cfg["inset_bbox"]
    figure_dir   = cfg["figure_dir"]
    table_dir    = cfg["table_dir"]

    os.makedirs(figure_dir, exist_ok=True)
    os.makedirs(table_dir,  exist_ok=True)

    # 结果表
    results_df = pd.DataFrame(
        columns=["variable", "category_1", "category_2", "quality", "stat", "pvalue"]
    ).astype({"stat": float, "pvalue": float})

    # 按质量等级迭代
    for quality, (legend_prefix, qual_col) in cfg["qualities"].items():

        # ------ 过滤数据 ------
        if qual_col is None:
            qual_mask = df.any(axis=1)
        else:
            qual_mask = df[qual_col]
        subdf = df.loc[df[col_drep] & qual_mask, [col_y, col_type, col_x]].copy()

        # 颜色列表（按 type_order 排序）
        joint_colors = [pal_joint[t] for t in type_order]

        # ------ 主图：jointplot ------
        g = sns.jointplot(
            data=subdf,
            kind="scatter",
            x=col_x,
            y=col_y,
            hue=col_type,
            alpha=0.5,
            joint_kws=dict(s=20),
            marginal_kws=dict(bw_adjust=0.2),
            palette=joint_colors,
            hue_order=type_order,
            height=cfg["joint_height"],
        )

        g.ax_joint.grid(which="major", axis="both", linestyle="--", zorder=0)
        g.ax_joint.set(
            xscale="log", yscale="log",
            xlabel="Genome total size [bp]",
            ylabel="Number of predicted CDS",
            ylim=cfg["ylim"],
            xlim=cfg["xlim"],
        )

        # 更新图例标签（加 N 数）
        counts  = subdf[col_type].value_counts().to_dict()
        new_leg = {
            t: f"{legend_prefix} {t} (N={counts.get(t, 0)})"
            for t in type_order
        }
        handles, labels = g.ax_joint.get_legend_handles_labels()
        labels = [new_leg.get(lab, lab) for lab in labels]
        g.ax_joint.legend(handles=handles, labels=labels, fontsize=8, loc="upper left")

        g.ax_marg_x.ticklabel_format(axis="y", style="plain")

        # ------ 线性回归（log-log）------
        popt, _ = sciopt.curve_fit(
            _lin_law,
            np.log(subdf[col_x]),
            np.log(subdf[col_y]),
        )
        subdf["_fit"]          = np.exp(_lin_law(np.log(subdf[col_x]), *popt))
        subdf["residuals_log"] = np.log(subdf[col_y]) - np.log(subdf["_fit"])
        subdf[f"{col_y}_log"]  = np.log(subdf[col_y])
        subdf[f"{col_x}_log"]  = np.log(subdf[col_x])

        xx = np.exp(np.linspace(np.log(subdf[col_x].min()),
                                np.log(subdf[col_x].max()), 3))
        g.ax_joint.plot(
            xx, np.exp(_lin_law(np.log(xx), *popt)),
            color=cfg["color_fit_line"], linestyle="--", linewidth=1,
        )

        # ------ Mann-Whitney U 检验 ------
        test_vars = ("residuals_log", f"{col_y}_log", f"{col_x}_log")
        for t1, t2 in itertools.combinations(type_order, 2):
            for var in test_vars:
                if var not in subdf.columns:
                    continue
                stat, pval = sci.stats.mannwhitneyu(
                    subdf.loc[subdf[col_type] == t1, var],
                    subdf.loc[subdf[col_type] == t2, var],
                    alternative="two-sided",
                )
                results_df = pd.concat(
                    [results_df,
                     pd.DataFrame(
                         [[var, t1, t2, legend_prefix, stat, pval]],
                         columns=results_df.columns,
                     )],
                    ignore_index=True,
                )

        # ------ 残差 inset 箱线图 ------
        res_ax = _make_inset_ax(g.fig, g.ax_joint, inset_bbox)

        box_order  = list(reversed(type_order))          # WGS / MAG / SAG
        box_colors = [pal_box[t] for t in box_order]

        boxplot_args = dict(
            data=subdf,
            x="residuals_log",
            y=col_type,
            hue=col_type,
            palette=box_colors,
            hue_order=box_order,
            order=box_order,
            legend=False,
            linewidth=1,
            fliersize=1,
        )
        sns.boxplot(**boxplot_args, orient="h", ax=res_ax)

        pairs = list(itertools.combinations(box_order, 2))
        annotator = Annotator(ax=res_ax, pairs=pairs, **boxplot_args, orient="h")
        annotator.configure(test="Mann-Whitney", text_format="star",
                            loc="inside", verbose=0)
        annotator.new_plot(res_ax, plot="boxplot", **boxplot_args, orient="h")
        annotator.apply_and_annotate()

        res_ax.set(xlabel=None, ylabel=None)
        res_ax.yaxis.set_visible(False)
        res_ax.set_title("Residuals (log)", fontsize=8, pad=3)
        for s in res_ax.spines:
            res_ax.spines[s].set_visible(False)

        # inset 背景圆角框
        p_bbox = mpatches.FancyBboxPatch(
            xy=(0, 0), width=1, height=1,
            facecolor="white", edgecolor="grey",
            alpha=mpl.rcParams["legend.framealpha"],
            boxstyle="round,pad=0,rounding_size=0.05",
            snap=True, zorder=0,
            transform=res_ax.transAxes, clip_on=False, lw=1,
            mutation_aspect=inset_bbox[2] / inset_bbox[3],
        )
        res_ax.add_patch(p_bbox)
        res_ax.patch = p_bbox

        # ------ 保存图片 ------
        stem = f"dRep95_{quality}_CDSvsGenomeSize_byorigin"
        _save_figure(g.fig, figure_dir, stem)
        plt.close(g.fig)

    # ------ 保存检验结果表 ------
    if custom_display_fn is not None:
        mask = results_df.isna()
        mask["pvalue"] = results_df["pvalue"] <= 0.05
        styled = custom_display_fn(
            results_df, exclude_diag=False, mask=mask, hl_max=False
        ).format("{:e}", subset=["pvalue"], precision=2)
        display(styled)

        stem = os.path.join(table_dir, "dRep95_CDSvsGenomeSize_byorigin_mannwhitneyu-test")
        styled.to_excel(stem + ".xlsx")
        styled.to_html(stem  + ".html")
        styled.to_latex(stem + ".tex")
    
    results_df.to_csv(
        os.path.join(table_dir, "dRep95_CDSvsGenomeSize_byorigin_mannwhitneyu-test.tsv"),
        sep="\t", index=False,
    )

    return results_df
    
cogcat_df = pd.read_csv('./data.csv')
results = plot_cds_vs_genome_size(
    df=cogcat_df,
    config=CONFIG,
    custom_display_fn=custom_display, 
)