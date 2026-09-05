# Figure Type Directory Map

Maps user language (Chinese + English) to exact `assets/figures/<dir>/` paths.
Step 4 reads this table FIRST, then falls back to `ls figures/` for unmatched types.

**Usage:** Find the user's description in the "Keywords" column → use the exact directory path.
One user request can match multiple directories — the engine picks the closest semantic match.

| Directory | Keywords (user language) | What it produces |
|-----------|--------------------------|-----------------|
| **GroupedBarChart** | 分组柱状图, grouped bar, 分组条图, bar chart with error bars, 横向柱状图 | Grouped bars with individual points + error bars + significance |
| **BarAblation** | 消融实验, ablation, 模块拆除, 组件移除对比, remove-one-at-a-time | Ablation study bars — each bar shows performance after removing one component |
| **BarComparison** | 模型对比, method comparison, 算法对比, benchmark, 性能对比, model vs model | Side-by-side method comparison bars |
| **BarCategorical** | 分类柱状图, category bar, 类别统计, correctness by category, 子类别, subcategory | Bars grouped by category / subcategory with counts or scores |
| **BarComposition** | 组成柱状图, composition bar, 堆叠构成, brute force, rewriting, 重写比例 | Composition/breakdown bars — what fraction each component contributes |
| **BarDistribution** | 分布柱状图, distribution bar, 自校正, self-correction, 前后对比 | Distribution-style bars — before/after, self-correction panels |
| **StackedBarScatter** | 堆叠柱状散点, stacked bar scatter, 堆叠柱+散点, jitter bar scatter | Stacked bar charts with overlaid scatter/jitter points |
| **GroupedViolin** | 分组小提琴, grouped violin, 小提琴+散点, violin with points | Violin plots with individual data points and significance brackets |
| **Violin** | 小提琴图, violin plot, 小提琴 | Standard violin plot |
| **3DHeatmap** | 3D热图, 3D heatmap, 三维热图, Heatmap3D, 3D热图 | 3D heatmap via ComplexHeatmap::Heatmap3D() |
| **heatmap** | 热图, heatmap, 表达热图, 聚类热图, expression heatmap | Generic heatmap with clustering, row/column dendrograms, z-score color |
| **DensityHeatmap** | 密度热图, density heatmap, 分布热图, distribution as heatmap | densityHeatmap() with annotations + appended Heatmap |
| **Frequency_3DHeatmap** | 3D频率热图, frequency heatmap, 频率统计热图, Sturges | 3D frequency heatmap with use_3d=TRUE, Sturges breaks |
| **CorrelationMatrix** | 相关矩阵, correlation matrix, 相关性热图, correlation heatmap, ggpairs, pair plot | Correlation matrix via ggpairs with upper/lower/diag panels |
| **GroupedCorrelationMatrix** | 分组相关矩阵, grouped correlation, 组间相关矩阵, group relation, 分组相关热图 | Correlation matrix with group-level annotations |
| **PCA** | PCA, 主成分分析, 主成分, principal component | PCA via FactoMineR/ggplot2 with 95% confidence ellipses |
| **RDA** (via cross-type from PCA) | RDA, 冗余分析, 冗余, redundancy analysis | RDA triplot (samples + species + environmental arrows) |
| **AUROC** | AUROC, ROC, ROC曲线, AUC, receiver operating | Multi-model AUROC curves |
| **ConfusionMatrix** | 混淆矩阵, confusion matrix, 分类评估, sector confusion | Sector confusion matrix with Precision/Recall/F1 |
| **Radar** | 雷达图, radar, 极坐标, polar, 蜘蛛图, spider chart | Multi-axis radar/polar comparison |
| **SankeyDiagram** | 桑基图, Sankey, 流图, 流量图, flow diagram | Multi-level Sankey flow diagram |
| **RidgePlot** | 山脊图, ridge plot, ridgeline, 密度山脊, 分布山脊 | Ridgeline density plots (ggridges style) |
| **KernelDensity** | 核密度, kernel density, KDE, 密度估计, 2D密度 | 2D kernel density estimation with contour |
| **MarginalDensity** | 边际密度, marginal density, 边际散点密度, scatter+marginal | Scatter plot with marginal density distributions |
| **PairedBoxScatter** | 配对箱线, paired box, 配对箱散点, before-after box | Paired box-scatter with connecting lines |
| **MantelCorrelation** | Mantel相关, Mantel test, 环境因子相关, microbial correlation | Mantel correlation with linkET — heatmap + connection curves |
| **Manifold** | 流形, manifold, 流形可视化, Swiss roll, diffusion | Manifold visualization / Swiss roll / diffusion plots |
| **LineTrend** | 趋势线, trend, 时间序列, time series, 折线图, 参数扫描, sweep | Line/trend plots — time series, parameter sweeps, post-training trends |
| **MarkerGeneDotPlot** | 标记基因点图, marker gene, dot plot, 基因表达点图 | Marker gene expression dot plot |
| **volcano** (via `volcano/`) | 火山图, volcano, 差异表达, differential expression | Volcano plot with significance thresholds |
| **UpSet** (via cross-type from ConfusionMatrix) | UpSet, upset plot, 交集图, 集合交集 | UpSet intersection plot |
| **Forest** (via cross-type from Bar) | 森林图, forest plot, CI, 置信区间, 效应量 | Forest plot with confidence intervals |
| **Single-cell** (via cross-type from PCA) | 单细胞轨迹, pseudotime, trajectory, 单细胞动力 | Single-cell trajectory / pseudotime plot |
| **Bubble Scatter** (via cross-type from Scatter) | 气泡散点, bubble, 气泡图, bubble scatter | Scatter with bubble size as third variable |
