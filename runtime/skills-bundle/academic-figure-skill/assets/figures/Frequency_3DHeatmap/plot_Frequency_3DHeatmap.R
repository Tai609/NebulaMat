# # 安装R包
# library(devtools)
# install_github("jokergoo/ComplexHeatmap")

#####################1.频率热图2D##########################################
library(ComplexHeatmap)
library(RColorBrewer)

dat = data.matrix(read.csv(
  './dataset.csv',
  row.names = 1,
  stringsAsFactors = FALSE
))


n_col = ncol(dat)
phen_mean = colMeans(dat)
group_vec = rep(c(rep("A", 30), rep("B", 20)))
anno_color = list(anno = c("A" = "#e0526d", "B" = "#6dc050"))

han = HeatmapAnnotation(
  points = anno_points(phen_mean),
  anno = group_vec,
  col = anno_color
)


F3D = frequencyHeatmap(
  dat, 
  use_3d = TRUE, 
  breaks = "Sturges",
  stat = "count",
  col = brewer.pal(9, "RdYlBu"),# Blues, Greens, Oranges, RdYlBu
  color_space = "LAB",
  title = "3D Frequency heatmap",
  ylab = "Phenotype Value",
  ylim = NULL,
  range = ylim,
  title_gp = gpar(fontsize = 14),
  ylab_gp = gpar(fontsize = 12),
  tick_label_gp = gpar(fontsize = 10),
  column_order = NULL,
  column_names_side = "bottom",
  show_column_names = TRUE,
  column_names_max_height = unit(6, "cm"),
  column_names_gp = gpar(fontsize = 12),
  column_names_rot = 90,
  cluster_columns = FALSE,
  top_annotation = han,

  heatmap_legend_param = list(
    title = "count",
    title_gp = gpar(fontsize = 11),
    legend_direction = "vertical"
  )
)


# 1. 导出PDF
pdf("heatmap5.pdf", width = 9, height = 3)
draw(F3D)
dev.off()

# 2. 导出PNG
png("heatmap5.png", width = 9, height = 3, units = "in", res = 300)
draw(F3D)
dev.off()
