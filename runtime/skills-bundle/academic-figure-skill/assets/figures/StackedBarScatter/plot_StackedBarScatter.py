import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import scipy.stats as stats
from itertools import combinations
from matplotlib.patches import Patch
import os

def plot_jitter_mean_sig(
    df: pd.DataFrame,                 # DataFrame，列为分组，值为该组样本
    group_order=None,                 # list[str]，分组顺序；None则使用df列顺序
    palette=None,                     # list[color]，每组颜色；None自动生成（前三组固定色）
    # --- 几何布局（保持原始组间距） ---
    x_start=-0.3,                     # float，第一组的x起点
    x_step=0.5,                       # float，相邻两组的水平间距（不变则保证组距恒定）
    jitter=0.08,                      # float，散点水平抖动幅度（0~0.15自然）
    line_half_width=0.05,             # float，均值横线的半宽（控制黑色均值线长度）
    # --- 旧式显著性（数据坐标）参数（通常不启用，仅兼容保留） ---
    y_sig_base=None,                  # float，数据坐标系下的显著性起始高度
    y_sig_gap=0.5,                    # float，数据坐标系下的显著性层间距
    # --- 画布与图例（自适应 + 右侧单行图例） ---
    fig_size=None,                    # (w,h) inches，None则自适应计算
    base_plot_width=4.5,              # float，3组时主图基础宽度（不含图例）
    extra_width_per_group=0.5,        # float，超过3组每增加1组主图额外加宽
    legend_reserved_width=2.0,        # float，为右侧单行图例预留的最小宽度
    base_plot_height=4.0,             # float，基础高度
    height_growth_per_sig=0.25,       # float，有显著性层时额外增高（轴域绘制时一般很小）
    # --- 轴与风格 ---
    ytick_step=2,                     # float，Y轴刻度间隔；None则保持matplotlib默认
    font_size=12,                     # int/float，整体字号（含p文本）
    alpha=0.5,                        # float，散点透明度
    seed=2025,                        # int，随机种子（抖动可复现）
    y_label="Iba1 contacts to NET fibers (vol.%)",  # str，Y轴标题
    # --- 顶部显著性在轴域坐标绘制（不撑高Y轴） ---
    fix_ylim=True,                    # bool，True锁定Y轴范围，不因p值数量改变
    y_fixed_min=None,                 # float，手动锁定Y下界；None则由数据自动一次性确定
    y_fixed_max=None,                 # float，手动锁定Y上界；None则由数据自动一次性确定
    use_axes_fraction=True,           # bool，True用轴域坐标绘制显著性，Y轴不被撑高
    sig_y0_frac=1.02,                 # float，显著性起始层的轴域y位置（1为轴顶沿）
    sig_gap_frac=0.10,                # float，相邻显著性层之间的轴域间距
    top_extra_frac=0.22,              # float，figure顶部预留比例（容纳多层标注防裁切）
    # --- 顶部显著性避免遮挡（区间打包） ---
    avoid_overlap=True,               # bool，是否进行区间打包（避免横线/文本互相遮挡）
    bar_pad_frac_of_step=0.12,        # float，横线两端在数据坐标中的额外留白（相对x_step比例）
    label_char_frac=0.012,            # float，估计单字符在数据宽度中的占比（用于估算文本宽）
    widest_on_top=True,               # bool，跨度（x2-x1）最大的比较条提升到最顶层
    # --- 显示/保存 ---
    show_p=True,                      # bool，是否显示顶部p值与横线
    save_path=None,                   # str，保存路径，如"fig.pdf"/"fig.png"；None不保存
    save_format=None,                 # str，'pdf'或'png'；优先级高于文件扩展名
    dpi=300,                          # int，保存分辨率（对PNG生效；PDF矢量不依赖dpi）
    transparent=False                 # bool，保存是否透明背景
):
    """
    多组可扩展：散点抖动 + 均值/SEM + 顶部显著性（不改变Y轴范围） + 右侧单行竖排图例。
    - 组间距保持固定（x_start/x_step），适配2组、3组或更多组。
    - 顶部显著性：全排列两两比较，按“左→右”顺序；区间打包避免重叠；可“最宽置顶”。
    - 显著性在轴域坐标绘制，Y轴刻度不会随p值数量增长而变化。
    - 图例固定在右侧、单行竖排，不与主图重叠；画布宽度自适应组数与图例宽。
    
    # 参数手册（快速参考）
    # =============================
    # df                : DataFrame。每列代表一个组，列内是该组样本数值。
    # group_order       : 指定分组顺序（列表）；None使用df列顺序。
    # palette           : 每组颜色列表；None自动生成（前3组固定为灰/蓝/粉）。
    #
    # x_start           : 第一组的x坐标起点。改大/改小会整体平移整排组的位置。
    # x_step            : 相邻组的水平间距。保持不变即可保证“组间距恒定”的风格。
    # jitter            : 散点的水平抖动幅度（0~0.15常用区间）。0表示无抖动。
    # line_half_width   : 均值横线的半宽，控制黑色均值线长度。
    #
    # y_sig_base        : 仅在 use_axes_fraction=False 时生效；显著性层的起始高度（数据坐标）。
    # y_sig_gap         : 仅在 use_axes_fraction=False 时生效；显著性层的高度间距（数据坐标）。
    #
    # fig_size          : (宽,高) 英寸。None时自动按组数/图例/显著性估算。
    # base_plot_width   : 3组时主图（不含图例）基础宽度。
    # extra_width_per_group : 超过3组，每增加1组时主图额外加宽的英寸数。
    # legend_reserved_width : 右侧单行图例至少预留宽度（自动按组数校正，取较大值）。
    # base_plot_height  : 基础高度。
    # height_growth_per_sig : 如显示显著性，主图的额外增高（轴域绘制时通常保持较小值）。
    #
    # ytick_step        : Y轴刻度间隔；None使用matplotlib默认。
    # font_size         : 统一字号（含p文本与ylabel）；过大可能导致顶部拥挤。
    # alpha             : 散点透明度。
    # seed              : 随机种子，保证抖动可复现。
    # y_label           : Y轴标题文本。
    #
    # fix_ylim          : True时锁定Y轴，不随p值层数增长改变范围。
    # y_fixed_min       : 手动锁定Y轴下界；None则由数据一次性决定（常与fix_ylim配合）。
    # y_fixed_max       : 手动锁定Y轴上界；None则由数据一次性决定（常与fix_ylim配合）。
    # use_axes_fraction : True时在轴域坐标绘制显著性（不影响Y轴范围），推荐启用。
    # sig_y0_frac       : 显著性起始层在轴域坐标的y值（1为轴顶沿，>1在图外上方）。
    # sig_gap_frac      : 显著性层与层之间的轴域坐标间距（0.08~0.12较常用）。
    # top_extra_frac    : 预留给顶部显著性的figure空间比例；显著性层多时可适当增大。
    #
    # avoid_overlap     : 是否进行“区间打包”以避免横线和文本遮挡（此处默认True）。
    # bar_pad_frac_of_step : 横线两端的水平额外留白（相对x_step的比例，默认0.12）。
    # label_char_frac   : 估计单字符占据的数据宽比例，用于估测p文本宽度（经验参数）。
    # widest_on_top     : “最宽区间置顶”，跨度最大的比较条会被提升到最高层，增强层次感。
    #
    # show_p            : 是否绘制顶部显著性（横线 + p文本）。False时只画散_


    """

    # 1) 分组与颜色
    groups = list(group_order) if group_order is not None else list(df.columns)
    n = len(groups)

    if palette is None:
        base3 = ["#a1a0a5", "#8bacd3", "#c28bb7"]
        if n <= 3:
            palette = base3[:n]
        else:
            tab = [plt.get_cmap("tab10")(i) for i in range(10)]
            palette = base3 + [tab[i] for i in range(n - 3)]
    else:
        assert len(palette) >= n, "palette 颜色数量不足覆盖所有分组"

    # 2) X位置（固定间距）
    x_positions = np.array([x_start + i * x_step for i in range(n)])
    x_map = dict(zip(groups, x_positions))

    # 3) 统计与全排列p值（按中点→宽度排序，保证左→右）
    summary = df[groups].agg(['mean', 'sem']).T
    data_min = float(df[groups].min().min())
    data_max = float(df[groups].max().max())

    all_pairs = list(combinations(groups, 2))
    raw_p_values = []
    for g1, g2 in all_pairs:
        stat, p = stats.ttest_ind(df[g1].dropna(), df[g2].dropna(), equal_var=False)
        raw_p_values.append((g1, g2, p))

    def pair_sort_key(t):
        g1, g2, _ = t
        x1, x2 = x_map[g1], x_map[g2]
        return ((x1 + x2) / 2.0, abs(x2 - x1))
    p_values = sorted(raw_p_values, key=pair_sort_key)

    # 4) 画布与右侧留白（自适应宽度 + 顶部预留）
    have_sig = show_p and len(p_values) > 0
    auto_height = base_plot_height + (height_growth_per_sig if have_sig else 0.0)
    auto_plot_width = base_plot_width + max(0, n - 3) * extra_width_per_group
    per_item_inch = 0.28  # 右侧单行图例每个项目的预估宽度
    wanted_legend_width = max(legend_reserved_width, per_item_inch * n + 0.6)
    auto_width = auto_plot_width + wanted_legend_width
    if fig_size is None:
        fig_size = (auto_width, auto_height)

    fig = plt.figure(figsize=fig_size)
    plt.rcParams.update({'font.size': font_size})
    ax = plt.gca()

    right_pad_frac = min(0.75, wanted_legend_width / fig_size[0] + 0.02)
    top_pad = min(0.45, max(0.12, top_extra_frac if have_sig else 0.14))
    plt.subplots_adjust(left=0.12, right=1 - right_pad_frac, top=1 - top_pad, bottom=0.10)

    # 5) 散点 + 均值/SEM
    rng = np.random.default_rng(seed)
    for i, g in enumerate(groups):
        xv = x_map[g]
        yv = df[g].values
        x_jit = rng.uniform(-jitter, jitter, size=len(yv))
        ax.scatter(xv + x_jit, yv, color=palette[i], edgecolor=palette[i],
                   s=50, alpha=alpha, zorder=3)

        m = summary.loc[g, 'mean']
        s = summary.loc[g, 'sem']
        ax.plot([xv - line_half_width, xv + line_half_width], [m, m],
                color='black', lw=3, zorder=4, solid_capstyle='butt')
        ax.plot([xv, xv], [m - s, m + s], color='black', lw=1.5, zorder=4)
        ax.plot([xv - line_half_width, xv + line_half_width], [m + s, m + s],
                color='black', lw=1.2, zorder=4)
        ax.plot([xv - line_half_width, xv + line_half_width], [m - s, m - s],
                color='black', lw=1.2, zorder=4)

    # 6) 锁定Y轴范围（不因显著性层数改变）
    if fix_ylim:
        y0 = data_min if y_fixed_min is None else y_fixed_min
        y1_base = max(8.5, data_max + 0.6)
        y1 = y1_base if y_fixed_max is None else y_fixed_max
        ax.set_ylim(y0 if y_fixed_min is not None else min(0, y0), y1)
    else:
        y_top_needed = max(8.5, data_max + 0.7)
        ax.set_ylim(min(0, data_min), y_top_needed)

    ax.set_xlim(x_positions.min() - 0.4, x_positions.max() + 0.4)

    # 7) 顶部显著性（轴域坐标，左→右；区间打包；可最宽置顶）
    if show_p and len(p_values) > 0 and use_axes_fraction:
        trans = ax.get_xaxis_transform()  # x=数据；y=轴域
        x_lo, x_hi = ax.get_xlim()
        data_span = x_hi - x_lo
        bar_pad = bar_pad_frac_of_step * x_step

        # 构建区间（含文本宽估计）
        intervals, widths = [], []
        for g1, g2, p in p_values:
            x1, x2 = sorted([x_map[g1], x_map[g2]])
            label = "p < 0.001" if p < 0.001 else f"p = {p:.3f}"
            est_half = 0.5 * min(0.20, label_char_frac * len(label)) * data_span
            intervals.append({
                "left":  x1 - bar_pad - est_half,
                "right": x2 + bar_pad + est_half,
                "x1": x1, "x2": x2,
                "label": label
            })
            widths.append(abs(x2 - x1))

        # 贪心区间打包（左→右放入尽可能低层，避免重叠）
        levels, level_of = [], []
        def no_conflict(cur, used_list):
            return all(cur["right"] <= L or cur["left"] >= R for (L, R) in used_list)

        for inter in intervals:
            placed = False
            for li, used in enumerate(levels):
                if no_conflict(inter, used):
                    used.append((inter["left"], inter["right"]))
                    level_of.append(li)
                    placed = True
                    break
            if not placed:
                levels.append([(inter["left"], inter["right"])])
                level_of.append(len(levels) - 1)

        # 最宽置顶：将跨度最大的比较条所在层移到最高层（其余层相对次序不变）
        if widest_on_top and intervals:
            widest_idx = int(np.argmax(widths))
            widest_lvl = level_of[widest_idx]
            max_lvl = max(level_of) if level_of else 0
            if widest_lvl != max_lvl:
                uniq = sorted(set(level_of))
                new_order = [l for l in uniq if l != widest_lvl] + [widest_lvl]
                remap = {old: i for i, old in enumerate(new_order)}
                level_of = [remap[l] for l in level_of]
                max_lvl = max(level_of)

        # 顶部留白二次调整，防裁切
        max_level = max(level_of) if level_of else 0
        need_top = sig_y0_frac + max_level * sig_gap_frac + 0.06
        if need_top > 1.0:
            plt.subplots_adjust(top=1 - min(0.75, max(top_pad, need_top - 1 + 0.02)))

        # 绘制横线与文本（不裁切）
        for inter, lvl in zip(intervals, level_of):
            y_frac = sig_y0_frac + lvl * sig_gap_frac
            ax.plot([inter["x1"] + bar_pad, inter["x2"] - bar_pad], [y_frac, y_frac],
                    lw=1.2, color='black', transform=trans, clip_on=False, zorder=5)
            ax.text((inter["x1"] + inter["x2"]) / 2.0, y_frac + 0.01, inter["label"],
                    ha='center', va='bottom', fontsize=font_size,
                    transform=trans, clip_on=False, zorder=5)

    # 8) 坐标轴与外观
    if ytick_step is not None and ytick_step > 0:
        y_min_cur, y_max_cur = ax.get_ylim()
        yticks = np.arange(np.floor(y_min_cur / ytick_step) * ytick_step,
                           y_max_cur + 1e-6, ytick_step)
        ax.set_yticks(yticks)
    ax.set_ylabel(y_label, fontsize=font_size, color='black')

    for sp in ['top', 'right', 'bottom']:
        ax.spines[sp].set_visible(False)
    ax.spines['left'].set_color('black')
    ax.spines['left'].set_linewidth(1.2)
    ax.tick_params(axis='y', colors='black', width=1.2, length=6,
                   direction='out', labelsize=font_size)
    ax.tick_params(axis='x', bottom=False, labelbottom=False)
    ax.yaxis.set_tick_params(left=True, width=1.2, color='black')
    ax.yaxis.grid(False)

    # 9) 右侧单行竖排图例（不与主图重叠）
    handles = [Patch(facecolor=palette[i], edgecolor='none', label=groups[i]) for i in range(n)]
    leg = ax.legend(
        handles=handles,
        frameon=False,
        loc='upper left',
        bbox_to_anchor=(1.02, 1.00),
        fontsize=8,
        ncol=len(groups),  # 单行
        handlelength=0.5,
        handleheight=2.5,
        markerscale=1.0,
        columnspacing=-1,
        borderpad=-1,
        handletextpad=0.6,
        borderaxespad=0.0
    )
    for text in leg.get_texts():
        text.set_rotation(90)
        text.set_ha('center')
        text.set_va('bottom')
        x, y = text.get_position()
        text.set_position((x - 15, y + 20))

    plt.tight_layout()

    # 10) 保存（可选）
    if save_path is not None:
        fmt = (save_format or os.path.splitext(save_path)[1].lower().lstrip('.')).lower()
        if fmt not in {"pdf", "png"}:
            raise ValueError("save_format / 文件扩展名必须是 'pdf' 或 'png'")
        plt.savefig(save_path, format=fmt, dpi=dpi, bbox_inches="tight", transparent=transparent)

    return fig, ax
    
# 1) 原始三组
df = pd.DataFrame({
    "C57BL/6J": [5.66,5.73,5.21,5.20,2.84,5.31,5.78,3.31,6.57,5.28,6.28,4.39,4.44,4.56,5.70,3.65,3.86,4.27],
    "APPNL-G-F": [2.51,3.65,3.14,4.04,4.78,2.45,4.57,4.78,4.19,3.98,2.88,3.12,4.68,5.33,6.15,4.21,4.66,3.62],
    "APPNL-G-F x TSPO-KO": [3.07,4.27,1.90,3.65,0.79,4.87,4.25,4.33,5.38,6.45,4.15,3.09,4.92,3.82,2.59,3.34,1.76,3.16]
})
fig, ax = plot_jitter_mean_sig(df,show_p=True, save_path="figureA.pdf",fig_size=(2.5, 4))  # 自适应画布，图例在右，不重叠
plt.show()

# 2) 只有两列也可以（组间距不变、图例不重叠）
fig, ax = plot_jitter_mean_sig(df[["C57BL/6J","APPNL-G-F"]],show_p=False, save_path="figureB1.pdf",fig_size=(2.5, 4))
plt.show()

# 3) N 组（自动扩宽主图与画布；图例仍在右侧不重叠）
df_more = df.copy()
df_more["NewGroupA"] = df_more["C57BL/6J"] + np.random.default_rng(1).normal(0,0.25,len(df))
df_more["NewGroupB"] = df_more["APPNL-G-F"] + np.random.default_rng(2).normal(0,0.25,len(df))
fig, ax = plot_jitter_mean_sig(df_more,show_p=False, save_path="figureC1.pdf",fig_size=(4, 4))
plt.show()