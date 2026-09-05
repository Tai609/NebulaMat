import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn import metrics

# 设置数据路径并加载数据
path = "./data/dataset.csv"
df = pd.read_csv(path)

# 第一列为 FPR，接下来的五列为对应模型的 TPR
fpr_col = df.columns[0]
tpr_cols = df.columns[1:6].tolist()

# 绘图
plt.figure(figsize=(6, 6))

# 设置全局字体
plt.rcParams.update({
    "font.size": 14,          # 全局字体大小
    "axes.titlesize": 14,     # 标题字体大小
    "axes.labelsize": 14,     # 坐标轴标签字体大小
    "xtick.labelsize": 12,    # X 轴刻度字体大小
    "ytick.labelsize": 12,    # Y 轴刻度字体大小
    "legend.fontsize": 12     # 图例字体大小
})

# 定义曲线颜色列表
curve_colors = ['blue', 'red', 'green', 'orange', 'purple']

# 定义阴影颜色列表（可以自定义不同的颜色）
shadow_colors = ['#b3cee0', '#c8e8cb', '#e4d0e5', '#fdd9b2', '#e6d7c3']
for i, col in enumerate(tpr_cols):
    fpr = df[fpr_col].values
    tpr = df[col].values
    mask = np.isfinite(fpr) & np.isfinite(tpr)
    fpr_clean = fpr[mask]
    tpr_clean = tpr[mask]
    sort_idx = np.argsort(fpr_clean)
    fpr_sorted = fpr_clean[sort_idx]
    tpr_sorted = tpr_clean[sort_idx]
    auc_val = metrics.auc(fpr_sorted, tpr_sorted)
    
    # 获取当前曲线的颜色和阴影颜色
    current_curve_color = curve_colors[i % len(curve_colors)]
    current_shadow_color = shadow_colors[i % len(shadow_colors)]
    
    # 绘制曲线下阴影（自定义颜色，透明度30%）
    plt.fill_between(fpr_sorted, tpr_sorted, alpha=0.3, color=current_shadow_color)
    
    # 绘制ROC曲线
    plt.plot(fpr_sorted, tpr_sorted, label=f"{col} (AUC={auc_val:.3f})", 
             linewidth=2, color=current_curve_color)

# 0.5 基线
plt.plot([0,1], [0,1], linestyle='--', color='gray')

plt.xlabel("False-positive rate (FPR)")
plt.ylabel("True-positive rate (TPR)")
plt.title("Death")
plt.legend(loc="lower right", frameon=False)  # 去掉图例边框
plt.xlim(0,1)
plt.ylim(0,1)

# 去掉网格
plt.grid(False)

# 去掉图框的上边框和右边框
# plt.gca().spines['top'].set_visible(False)
# plt.gca().spines['right'].set_visible(False)

# 保存
out_path = "./图3.png"
plt.savefig(out_path, dpi=300, bbox_inches="tight")
plt.show()