import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
from matplotlib.patches import Wedge
from matplotlib.colors import Normalize
from matplotlib.cm import ScalarMappable
from matplotlib import colormaps
import pandas as pd
import matplotlib.patches as patches


# ================================================================
# 1. 样式设置
# ================================================================
def setup_plot_style():
    plt.rcParams.update({
        "font.family": "Arial",
        "font.size": 12,
        "axes.edgecolor": "black",
        "axes.linewidth": 1.0,
        "axes.labelcolor": "black",
        "xtick.color": "black",
        "ytick.color": "black",
        "text.color": "black"
    })

# ================================================================
# 2. 百分比与半径计算（预测类别归一化）
# ================================================================
def calculate_percentages_and_radii(tp, fp, fn, tn, max_r):
    """
    按预测类别归一化：
      预测为正：TP + FP = 100%
      预测为负：FN + TN = 100%
    """
    percentages = {
        "TP": tp / (tp + fp) * 100 if (tp + fp) != 0 else 0,
        "FP": fp / (tp + fp) * 100 if (tp + fp) != 0 else 0,
        "FN": fn / (fn + tn) * 100 if (fn + tn) != 0 else 0,
        "TN": tn / (fn + tn) * 100 if (fn + tn) != 0 else 0
    }

    max_val = max(percentages.values()) if max(percentages.values()) > 0 else 1
    radii = {k: max_r * np.sqrt(v / max_val) for k, v in percentages.items()}
    return percentages, radii


# ================================================================
# 3. 颜色映射
# ================================================================
def create_colormap_option8(percentages):
    cmap = colormaps["viridis"]  # 可换成 "plasma"、"coolwarm_r"、"magma" 等
    norm_percentages = {k: v / 100 for k, v in percentages.items()}
    return cmap, norm_percentages

# ================================================================
# 4. 绘制扇形（左上TP，右上FN，左下FP，右下TN）
# ================================================================
def draw_sectors(ax, center, radii, cmap, norm_percentages):
    cx, cy = center
    angles = {
        "TP": (90, 180),
        "FN": (0, 90),
        "FP": (180, 270),
        "TN": (270, 360)
    }
    for key, (theta1, theta2) in angles.items():
        color = cmap(norm_percentages[key])
        wedge = Wedge(center=(cx, cy), r=radii[key],
                      theta1=theta1, theta2=theta2,
                      facecolor=color, edgecolor="white", lw=1.2)
        ax.add_patch(wedge)


# ================================================================
# 5. 绘制象限边框
# ================================================================
def add_quadrant_borders(ax, max_r):
    ax.plot([0.5 - max_r, 0.5 + max_r], [0.5, 0.5], color="black", lw=1.3)
    ax.plot([0.5, 0.5], [0.5 - max_r, 0.5 + max_r], color="black", lw=1.3)
    rect = plt.Rectangle((0.5 - max_r, 0.5 - max_r), 2 * max_r, 2 * max_r,
                         fill=False, edgecolor="black", lw=1.3)
    ax.add_patch(rect)


# ================================================================
# 6. 扇区标签
# ================================================================
def add_sector_center_labels(ax, max_r):
    labels = {
        "TP": (0.5 - max_r * 0.35, 0.5 + max_r * 0.35),
        "FN": (0.5 + max_r * 0.35, 0.5 + max_r * 0.35),
        "FP": (0.5 - max_r * 0.35, 0.5 - max_r * 0.35),
        "TN": (0.5 + max_r * 0.35, 0.5 - max_r * 0.35)
    }
    for k, (x, y) in labels.items():
        ax.text(x, y, k, ha="center", va="center",
                fontsize=14, color="black", fontweight="bold")


# ================================================================
# 7. 百分比显示
# ================================================================
def add_labels(ax, max_r, percentages):
    label_positions = {
        "TP": (0.5 - max_r * 0.35, 0.5 + max_r * 0.7),
        "FN": (0.5 + max_r * 0.35, 0.5 + max_r * 0.7),
        "FP": (0.5 - max_r * 0.35, 0.5 - max_r * 0.7),
        "TN": (0.5 + max_r * 0.35, 0.5 - max_r * 0.7)
    }
    for k, (x, y) in label_positions.items():
        ax.text(x, y, f"{percentages[k]:.1f}%", ha="center", va="center",
                fontsize=10, color="black")


# ================================================================
# 8. 坐标与标签（带灰框版本）
# ================================================================
def add_axis_labels(ax, max_r, line_width=1.2, font_size=8):
    """
    添加带灰色框的坐标轴标签（Predicted/Actual Positive/Negative）
    """
    label_w = max_r * 0.2   # 左侧框宽度（相对于主图）
    label_h = max_r * 0.2   # 顶部框高度

    # === 左侧 Actual Positive ===
    ax.add_patch(patches.Rectangle(
        (0.5 - max_r - label_w, 0.5),
        label_w, max_r, facecolor='#F2F2F2',
        edgecolor='black', linewidth=line_width))
    ax.text(0.5 - max_r - label_w / 2, 0.5 + max_r / 2,
            'Positive', rotation=90, ha='center', va='center',
            fontsize=font_size, weight='bold', color='black', fontfamily='Arial')

    # === 左侧 Actual Negative ===
    ax.add_patch(patches.Rectangle(
        (0.5 - max_r - label_w, 0.5 - max_r),
        label_w, max_r, facecolor='#F2F2F2',
        edgecolor='black', linewidth=line_width))
    ax.text(0.5 - max_r - label_w / 2, 0.5 - max_r / 2,
            'Negative', rotation=90, ha='center', va='center',
            fontsize=font_size, weight='bold', color='black', fontfamily='Arial')

    # === 顶部 Predicted Positive ===
    ax.add_patch(patches.Rectangle(
        (0.5 - max_r, 0.5 + max_r),
        max_r, label_h, facecolor='#F2F2F2',
        edgecolor='black', linewidth=line_width))
    ax.text(0.5 - max_r / 2, 0.5 + max_r + label_h / 2,
            'Positive', ha='center', va='center',
            fontsize=font_size, weight='bold', color='black', fontfamily='Arial')

    # === 顶部 Predicted Negative ===
    ax.add_patch(patches.Rectangle(
        (0.5, 0.5 + max_r),
        max_r, label_h, facecolor='#F2F2F2',
        edgecolor='black', linewidth=line_width))
    ax.text(0.5 + max_r / 2, 0.5 + max_r + label_h / 2,
            'Negative', ha='center', va='center',
            fontsize=font_size, weight='bold', color='black', fontfamily='Arial')

    # === 添加总体标题 ===
    ax.text(0.5, 0.5 + max_r + label_h * 1.6, "Predicted Class",
            ha='center', va='center', fontsize=font_size, fontweight='bold')
    ax.text(0.5 - max_r - label_w * 1.6, 0.5, "Actual Class",
            ha='center', va='center', rotation=90,
            fontsize=font_size, fontweight='bold')


# ================================================================
# 9. 精度指标（Precision, Recall, F1）
# ================================================================
def add_metric_grid(ax, max_r, tp, fp, fn, tn,
                    line_width=1.2, font_size=8):
    """
    底部两行灰框标签：
    第1行：左 Precision | 右 Recall（上边框与混淆矩阵底边重合）
    第2行：整行 F1-Score（紧贴其下）
    风格与 add_axis_labels 一致（灰底 + 黑边 + 加粗字体）
    """
    # === 计算指标 ===
    precision = tp / (tp + fp) if (tp + fp) != 0 else 0
    recall    = tp / (tp + fn) if (tp + fn) != 0 else 0
    f1        = (2 * precision * recall / (precision + recall)) if (precision + recall) != 0 else 0

    # === 文本 ===
    t_prec  = f"Precision={precision*100:.1f}%"
    t_recal = f"Recall={recall*100:.1f}%"
    t_f1    = f"F1-Score={f1*100:.1f}%"

    # === 尺寸参数 ===
    row_h = max_r * 0.22   # 每行灰框高度
    x_left = 0.5 - max_r
    mid_x = 0.5
    y_bottom_matrix = 0.5 - max_r  # 主矩阵底边 y 坐标

    # === 第1行 Precision/Recall 的 y 坐标 ===
    # 使其上边框正好与矩阵底边对齐
    y_row1_top = y_bottom_matrix
    y_row1_center = y_row1_top - row_h / 2

    # === 第2行 F1 的 y 坐标（紧贴第1行）===
    y_row2_top = y_row1_top - row_h
    y_row2_center = y_row2_top - row_h / 2

    # ---------- 第1行：Precision ----------
    ax.add_patch(patches.Rectangle(
        (x_left, y_row1_top - row_h),  # 左下角
        max_r, row_h,
        facecolor="#F2F2F2", edgecolor="black", linewidth=line_width))
    ax.text(x_left + max_r / 2, y_row1_center, t_prec,
            ha="center", va="center", fontsize=font_size,
            weight="bold", color="black", fontfamily="Arial")

    # ---------- 第1行：Recall ----------
    ax.add_patch(patches.Rectangle(
        (mid_x, y_row1_top - row_h),
        max_r, row_h,
        facecolor="#F2F2F2", edgecolor="black", linewidth=line_width))
    ax.text(mid_x + max_r / 2, y_row1_center, t_recal,
            ha="center", va="center", fontsize=font_size,
            weight="bold", color="black", fontfamily="Arial")

    # ---------- 第2行：F1 ----------
    ax.add_patch(patches.Rectangle(
        (x_left, y_row2_top - row_h),  # 左下角
        2 * max_r, row_h,
        facecolor="#F2F2F2", edgecolor="black", linewidth=line_width))
    ax.text(mid_x, y_row2_center, t_f1,
            ha="center", va="center", fontsize=font_size,
            weight="bold", color="black", fontfamily="Arial")
# ================================================================
# 10. 紧凑独立颜色条
# ================================================================
def add_custom_colorbar(fig, ax, cmap, shift_x=-0.075):
    norm = Normalize(vmin=1, vmax=100)
    sm = ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cbar = fig.colorbar(sm, ax=ax, fraction=0.035, pad=0.02, aspect=11.5)
    cbar.set_label("Percentage (%)", rotation=270, labelpad=6, fontsize=9)
    ticks = [0, 20, 40, 60, 80, 100]
    cbar.set_ticks(ticks)
    cbar.set_ticklabels([f"{t}%" for t in ticks])
    cbar.ax.tick_params(labelsize=9, width=0.8, length=0.5, color="black")
    cbar.outline.set_linewidth(0.8)
    pos = cbar.ax.get_position()
    cbar.ax.set_position([
        pos.x0 + shift_x,
        pos.y0,
        pos.width + 0.002,
        pos.height
    ])
    return cbar


# ================================================================
# 11. 主函数
# ================================================================
def plot_model_sector_matrices(model_results):
    setup_plot_style()
    fig = plt.figure(figsize=(12, 10))
    gs = GridSpec(nrows=2, ncols=2, figure=fig, hspace=0., wspace=0.)
    axes = [fig.add_subplot(gs[i, j]) for i in range(2) for j in range(2)]
    labels = ['(a)', '(b)', '(c)', '(d)']

    for ax, result, label in zip(axes, model_results, labels):
        tp, fp, fn, tn = result['tp'], result['fp'], result['fn'], result['tn']
        model_short = result['name']
        max_r = 0.28

        percentages, radii = calculate_percentages_and_radii(tp, fp, fn, tn, max_r)
        cmap, norm_percentages = create_colormap_option8(percentages)
        draw_sectors(ax, (0.5, 0.5), radii, cmap, norm_percentages)
        add_quadrant_borders(ax, max_r)
        add_sector_center_labels(ax, max_r)
        add_labels(ax, max_r, percentages)
        add_axis_labels(ax, max_r)  
        add_metric_grid(ax, max_r, tp, fp, fn, tn)

        # 子图标题
        ax.text(0.5, 0.5 + max_r * 1.65, f"{model_short}",
                ha='center', va='bottom', fontsize=13, fontweight='bold', transform=ax.transAxes)

        # 图注标签 (a)-(d)
        ax.text(0.12, 0.92, label, transform=ax.transAxes,
                fontsize=14, fontweight='bold', ha='left', va='top')

        ax.set_xlim(0.5 - max_r * 1.8, 0.5 + max_r * 1.8)
        ax.set_ylim(0.5 - max_r * 1.8, 0.5 + max_r * 1.8)
        ax.set_aspect('equal')
        ax.axis('off')

        add_custom_colorbar(fig, ax, cmap)

    return fig
    
# ================================================================
# 12. 示例数据
# ================================================================
df = pd.read_csv('./dataset.csv')
model_results = df.to_dict(orient='records')
fig = plot_model_sector_matrices(model_results)
plt.savefig("Confusion_Matrix.pdf", dpi=300, bbox_inches="tight")
plt.show()