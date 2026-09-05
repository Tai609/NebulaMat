# # 安装R包
# library(devtools)
# install_github("jokergoo/ComplexHeatmap")

#####################1.热图2D##########################################
library(ComplexHeatmap)
library(circlize)
library(grid)

dat = data.matrix(read.csv(
  './dataset.csv',
  row.names = 1,
  stringsAsFactors = FALSE
))

col_sum <- colSums(dat)
row_sum <- rowSums(dat)

# Top annotation：刻度 0-350
ha1 = HeatmapAnnotation(
  dist1 = anno_barplot(
    col_sum,
    bar_width  = 1,
    gp         = gpar(col = "white", fill = "#FFE200"),
    border     = FALSE,
    axis_param = list(
      at     = c(0, 50, 100, 150, 200, 250, 300, 350),
      labels = c("0", "50", "100", "150", "200", "250", "300", "350")
    ),
    height = unit(2, "cm")
  ),
  show_annotation_name = FALSE
)

# Row annotation：刻度 0-300
ha2 = rowAnnotation(
  dist2 = anno_barplot(
    row_sum,
    bar_width  = 1,
    gp         = gpar(col = "white", fill = "#FFE200"),
    border     = FALSE,
    axis_param = list(
      at     = c(0, 100, 200, 300),
      labels = c("0", "100", "200", "300")
    ),
    width = unit(2, "cm")
  ),
  show_annotation_name = FALSE
)

mat_max <- max(dat)
col_fun = colorRamp2(
  c(0, mat_max * 0.25, mat_max * 0.5, mat_max * 0.75, mat_max),
  c("white", "cornflowerblue", "yellow", "orange", "red")
)

ht = Heatmap(
  dat,
  name            = "Phen Values",
  col             = col_fun,
  rect_gp         = gpar(col = "white"),
  
  #############聚类############
  cluster_rows    = T,
  show_row_dend   = T,
  row_dend_side   = "left",   
  
  cluster_columns  = T,
  show_column_dend = T,
  column_dend_side = "bottom", 
  ##############################
  
  show_row_names    = TRUE,
  row_names_side    = "left",
  row_names_gp      = gpar(fontsize = 10),
  
  show_column_names = TRUE,
  column_names_rot  = 90,
  column_names_gp   = gpar(fontsize = 10),
  column_names_side = "bottom",
  
  column_title   = "Heatmap of dataset matrix",
  top_annotation = ha1,
  
  heatmap_legend_param = list(
    at     = pretty(as.vector(dat), 5),
    labels = format(pretty(as.vector(dat), 5), big.mark = ",")
  )
) + ha2

draw(
  ht,
  ht_gap  = unit(2, "mm"),
  padding = unit(c(5, 5, 30, 10), "mm")
)

# 1. 导出PDF
pdf("heatmap2.pdf", width = 9, height = 9)
draw(ht)
dev.off()

# 2. 导出PNG
png("heatmap2.png", width = 9, height = 9, units = "in", res = 300)
draw(ht)
dev.off()

###############################2.3D热图############################
col_fun = colorRamp2(c(0, mat_max * 0.25, mat_max * 0.5, mat_max * 0.75, mat_max),
                     c("white", "cornflowerblue", "yellow", "orange", "red"))
Hea3D = Heatmap3D(dat, 
          name = "values", 
          col = col_fun,
          row_names_side = "left", 
          
          #############聚类############
          cluster_rows    = T,
          show_row_dend   = T,
          row_dend_side   = "left",   
          
          cluster_columns  = T,
          show_column_dend = T,
          column_dend_side = "bottom", 
          ##############################
          
          row_names_gp = gpar(fontsize = 10),
          column_names_gp   = gpar(fontsize = 10),
          column_title = 'Heatmap of dataset matrix',
          
          heatmap_legend_param = list(at = c(0, 2, 4, 6,8,10), 
                                      labels = c("0", "2", "4", "6","8","10")),
          # new arguments for Heatmap3D()
          bar_rel_width = 0.5, bar_rel_height = 0.5, bar_max_length = unit(1., "cm")
)

# 1. 导出PDF
pdf("heatmap4.pdf", width = 9, height = 9)
draw(Hea3D)
dev.off()

# 2. 导出PNG
png("heatmap4.png", width = 9, height = 9, units = "in", res = 300)
draw(Hea3D)
dev.off()
