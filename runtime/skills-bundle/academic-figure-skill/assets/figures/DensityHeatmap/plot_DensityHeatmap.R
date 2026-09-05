# # 安装R包
# library(devtools)
# install_github("jokergoo/ComplexHeatmap")

library(ComplexHeatmap)
library(circlize)

phen = read.csv('./pheno.csv')

plot = densityHeatmap(phen,
               show_column_names = T, #按照列聚类
               ylab ="Phenotype Values",
               title = "Distribution as heatmap",
               cluster_columns = T,
               clustering_distance_columns = "ks",#euclidean、pearson
               clustering_method_columns = "complete",#ward.D2、average
               col = topo.colors(10),
)
# 1. 导出PDF
pdf("heatmap5.pdf", width = 6, height = 6)
draw(plot)
dev.off() 

# 2. 导出PNG
png("heatmap5.png", width = 6, height = 6, units = "in", res = 300)
draw(plot)
dev.off() 

# 热图+聚类+注释########################################################################################
col_fun <- colorRamp2(c(-3, 0, 3), c("navy", "white", "firebrick3"))
anno_plot = densityHeatmap(phen, height = unit(6, "cm")) %v%
  HeatmapAnnotation(Means = anno_barplot(colMeans(phen),height = unit(2, "cm"),gp = gpar(fill = "#CCCCCC")))%v%
  Heatmap(matrix(rnorm(12*12), ncol = 12), name = "phen", height = unit(6, "cm"),col = col_fun )

# 1. 导出PDF
pdf("heatmap6.pdf", width = 6, height = 6)
draw(anno_plot)
dev.off() 

# 2. 导出PNG
png("heatmap6.png", width = 6, height = 6, units = "in", res = 300)
draw(anno_plot)
dev.off() 

#################注释+热图##############################################################################
n_col = ncol(phen)
phen_mean = colMeans(phen)
group_vec = rep(c(rep("A", 4), rep("B", 8)))
# group_vec = rep(c("A", "B"), each = n_col / 2)
anno_color = list(anno = c("A" = "red", "B" = "blue"))

han = HeatmapAnnotation(
  points = anno_points(phen_mean),
  anno = group_vec,
  col = anno_color
)


plot = densityHeatmap(phen,
                      show_column_names = T,
                      ylab ="Phenotype Values",
                      title = "Distribution as heatmap",
                      top_annotation = han
)%v% Heatmap(phen, height = unit(6, "cm")) #按照行聚类

# 1. 导出PDF
pdf("heatmap8.pdf", width = 6, height = 6)
draw(plot)
dev.off() 

# 2. 导出PNG
png("heatmap8.png", width = 6, height = 6, units = "in", res = 300)
draw(plot)
dev.off() 

