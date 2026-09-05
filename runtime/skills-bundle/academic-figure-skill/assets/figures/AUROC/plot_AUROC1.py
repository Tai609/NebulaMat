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

for col in tpr_cols:
    fpr = df[fpr_col].values
    tpr = df[col].values
    mask = np.isfinite(fpr) & np.isfinite(tpr)
    fpr_clean = fpr[mask]
    tpr_clean = tpr[mask]
    sort_idx = np.argsort(fpr_clean)
    fpr_sorted = fpr_clean[sort_idx]
    tpr_sorted = tpr_clean[sort_idx]
    auc_val = metrics.auc(fpr_sorted, tpr_sorted)
    plt.plot(fpr_sorted, tpr_sorted, label=f"{col} (AUC={auc_val:.3f})", linewidth=2)

# 0.5基线
plt.plot([0,1], [0,1], linestyle='--', color='gray')

plt.xlabel("False-positive rate (FPR)")
plt.ylabel("True-positive rate (TPR)")
plt.title("Death")
plt.legend(loc="lower right", frameon=False)
plt.xlim(0,1)
plt.ylim(0,1)

# 去掉网格
plt.grid(False)

# 保存
out_path = "./图1.png"
plt.savefig(out_path, dpi=300, bbox_inches="tight")
plt.savefig('AUROC.pdf', bbox_inches='tight', dpi=300)
plt.show()