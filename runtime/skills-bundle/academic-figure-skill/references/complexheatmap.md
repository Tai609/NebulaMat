# R ComplexHeatmap 发表级热图规范

适用于:基因表达热图、SNP效应热图、GWAS结果矩阵、相关性矩阵等。

## 基础字体与主题设置

```r
library(ComplexHeatmap)
library(circlize)
library(grid)

ht_opt(
  heatmap_column_names_gp = gpar(fontfamily = "Arial", fontsize = 6),
  heatmap_row_names_gp = gpar(fontfamily = "Arial", fontsize = 6),
  legend_title_gp = gpar(fontfamily = "Arial", fontsize = 7, fontface = "bold"),
  legend_labels_gp = gpar(fontfamily = "Arial", fontsize = 6)
)
```

> 注：R 默认设备可能不支持 Arial，若导出后字体渲染异常，改用 `showtext` 包嵌入字体，或导出时用 `cairo_pdf()` 设备。

## 配色

避免 ComplexHeatmap 默认的红蓝跳变色阶，改用连续渐变色，推荐 `colorRamp2` 显式定义拐点：

```r
col_fun <- colorRamp2(
  c(-2, 0, 2),
  c("#2166AC", "#F7F7F7", "#B2182B")   # 冷色-中性-暖色，对色盲相对友好
)
```

分类变量（如注释条 annotation）避免用饱和度过高的默认色，参考 `color-palettes.md`。

## 聚类树

聚类树线条不宜过粗，避免喧宾夺主：

```r
Heatmap(mat,
  col = col_fun,
  clustering_method_rows = "ward.D2",
  row_dend_gp = gpar(lwd = 0.5),
  column_dend_gp = gpar(lwd = 0.5),
  row_dend_width = unit(8, "mm"),      # 聚类树不宜过宽，压缩视觉占比
  column_dend_height = unit(8, "mm")
)
```

## 注释条（annotation bar）

行/列注释条颜色需与正文配色体系保持一致，且图例要清晰标注类别含义：

```r
ha <- HeatmapAnnotation(
  Environment = anno_simple(env_labels, col = env_colors),
  annotation_name_gp = gpar(fontsize = 6),
  simple_anno_size = unit(2, "mm")     # 注释条宽度克制，不抢主图视觉重心
)
```

## 图例位置与合并

多个图例默认会占用大量空间，建议合并到图外一侧并统一朝向：

```r
draw(ht, heatmap_legend_side = "right", annotation_legend_side = "right",
     merge_legend = TRUE)
```

## 导出

```r
cairo_pdf("heatmap.pdf", width = 183/25.4, height = 120/25.4)  # 双栏宽度示例，单位英寸
draw(ht)
dev.off()

png("heatmap_preview.png", width = 183, height = 120, units = "mm", res = 300)
draw(ht)
dev.off()
```

## 常见陷阱

- **默认色阶（红-白-蓝跳变过硬）**：显式用 `colorRamp2` 控制拐点和色彩过渡
- **行/列名过长遮挡热图主体**：超过一定长度考虑只标注关键行/列（`show_row_names = FALSE` + 手动标注感兴趣的行），或调整 `row_names_max_width`
- **图例过多堆叠**：用 `merge_legend = TRUE` 合并同类图例，减少视觉噪音
- **未设置随机种子导致聚类顺序每次运行不一致**：`set.seed()` 固定，保证图表可复现
