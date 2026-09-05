import matplotlib.pyplot as plt
import numpy as np

# 数据准备
settings = ['Setting 1', 'Setting 2']
methods = ['Lasso', 'ENet', 'SGLasso', 'Pclogit', 'CDReg w/o S', 'CDReg w/o C', 'CDReg']

# AUROC均值数据
means_setting1 = [0.597, 0.600, 0.644, 0.614, 0.557, 0.571, 0.653]
means_setting2 = [0.618, 0.620, 0.665, 0.636, 0.575, 0.594, 0.687]

# 标准差数据
std_setting1 = [0.019, 0.019, 0.018, 0.015, 0.043, 0.036, 0.018]
std_setting2 = [0.010, 0.011, 0.017, 0.008, 0.038, 0.052, 0.022]

# P值数据
p_values_setting1 = [6.62E-07, 1.49E-06, 1.55E-03, 2.00E-05, 8.50E-05, 1.76E-05, None]
p_values_setting2 = [5.61E-06, 6.11E-06, 1.12E-03, 5.13E-06, 7.38E-06, 5.34E-04, None]

# 原始数据点
data_points_setting1 = [
    [0.603, 0.611, 0.613, 0.588, 0.591, 0.569, 0.56, 0.612, 0.607, 0.618],
    [0.598, 0.623, 0.607, 0.588, 0.593, 0.57, 0.566, 0.622, 0.612, 0.618],
    [0.645, 0.655, 0.65, 0.635, 0.62, 0.633, 0.613, 0.644, 0.674, 0.669],
    [0.624, 0.629, 0.616, 0.604, 0.616, 0.586, 0.596, 0.607, 0.632, 0.632],
    [0.544, 0.582, 0.494, 0.587, 0.575, 0.607, 0.557, 0.483, 0.615, 0.53],
    [0.56, 0.608, 0.58, 0.579, 0.587, 0.551, 0.484, 0.617, 0.59, 0.553],
    [0.66, 0.657, 0.65, 0.645, 0.625, 0.656, 0.623, 0.661, 0.677, 0.677]
]

data_points_setting2 = [
    [0.634, 0.61, 0.606, 0.614, 0.623, 0.637, 0.604, 0.62, 0.619, 0.611],
    [0.635, 0.611, 0.608, 0.62, 0.626, 0.639, 0.609, 0.625, 0.618, 0.606],
    [0.657, 0.634, 0.643, 0.658, 0.669, 0.674, 0.682, 0.685, 0.659, 0.691],
    [0.642, 0.62, 0.633, 0.636, 0.625, 0.645, 0.64, 0.644, 0.639, 0.642],
    [0.547, 0.538, 0.51, 0.548, 0.602, 0.567, 0.604, 0.574, 0.632, 0.625],
    [0.685, 0.574, 0.583, 0.616, 0.612, 0.662, 0.544, 0.582, 0.592, 0.494],
    [0.685, 0.643, 0.694, 0.664, 0.676, 0.704, 0.715, 0.721, 0.676, 0.692]
]

# 设置图形 - 竖向柱状图
fig, ax = plt.subplots(figsize=(10, 6))

# 设置柱状图位置
x = np.arange(len(settings))
height = 0.1  # 每个方法在同一个setting中的高度
spacing = -0.20  # 两个setting之间的间距

# 颜色设置 - 使用Set3配色方案
colors = plt.cm.Set3(np.linspace(0, 1, len(methods)))

# 绘制竖向柱状图
for i, method in enumerate(methods):
    # Setting 1的柱子位置
    bar_pos1 = i * height - (len(methods) * height + spacing) / 2
    
    # Setting 2的柱子位置
    bar_pos2 = i * height + (len(methods) * height + spacing) / 2
    
    # 绘制Setting 1的柱子
    bar1 = ax.bar(x[0] + bar_pos1, means_setting1[i], width=height, 
                  yerr=std_setting1[i], capsize=3, alpha=0.8, 
                  color=colors[i], label=method)
    
    # 绘制Setting 2的柱子
    bar2 = ax.bar(x[1] + bar_pos1, means_setting2[i], width=height, 
                  yerr=std_setting2[i], capsize=3, alpha=0.8, 
                  color=colors[i])
    
    # 在柱子顶部显示具体数值
    ax.text(x[0] + bar_pos1, means_setting1[i] + std_setting1[i] - 0.1, f'{means_setting1[i]:.3f}', rotation=90,
            ha='center', va='bottom', fontsize=10)
    ax.text(x[1] + bar_pos1, means_setting2[i] + std_setting2[i] - 0.1, f'{means_setting2[i]:.3f}', rotation=90,
            ha='center', va='bottom', fontsize=10)
    
    # 添加Setting 1的数据点
    x_points1 = np.random.normal(x[0] + bar_pos1, height/4, size=len(data_points_setting1[i]))
    ax.scatter(x_points1, data_points_setting1[i], color=colors[i], alpha=0.6, s=30, edgecolors='black', linewidth=0.5)
    
    # 添加Setting 2的数据点
    x_points2 = np.random.normal(x[1] + bar_pos1, height/4, size=len(data_points_setting2[i]))
    ax.scatter(x_points2, data_points_setting2[i], color=colors[i], alpha=0.6, s=30, edgecolors='black', linewidth=0.5)
    
    # 添加Setting 1的P值标注
    if p_values_setting1[i] is not None:
        ax.text(x[0] + bar_pos1, means_setting1[i] + std_setting1[i] + 0.05,
                f'p={p_values_setting1[i]:.1e}', ha='center', va='bottom', fontsize=10, rotation=90)
    
    # 添加Setting 2的P值标注
    if p_values_setting2[i] is not None:
        ax.text(x[1] + bar_pos1, means_setting2[i] + std_setting2[i] + 0.05,
                f'p={p_values_setting2[i]:.1e}', ha='center', va='bottom', fontsize=10, rotation=90)

# 设置X轴标签和刻度
ax.set_xticks([0, 1])  # 两个setting的中心位置
ax.set_xticklabels(settings)

# 设置Y轴
ax.set_ylabel('AUROC')
ax.set_ylim(0.45, 0.8)

# 在0.5刻度处添加灰色虚线
ax.axhline(y=0.5, color='gray', linestyle='--', alpha=0.7, linewidth=1)

# 添加网格
# ax.grid(True, axis='y', alpha=0.3)

# 移除上边框和右边框
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

# 将图例放在上方，水平排列
ax.legend(bbox_to_anchor=(0.5, 1.15), loc='center', ncol=len(methods), 
          frameon=False, fontsize=10)

plt.savefig('comparison_results横板.pdf', bbox_inches='tight', dpi=300)
plt.savefig('comparison_results横板.png', bbox_inches='tight', dpi=300)

# 调整布局
plt.tight_layout()
plt.show()