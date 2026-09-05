# 运行前请先安装依赖：
# install.packages(c("MASS", "GGally", "ggplot2", "dplyr", "patchwork", "ggplotify", "viridis"))

library(MASS)
library(GGally)
library(ggplot2)
library(dplyr)
library(patchwork)
library(ggplotify)
library(viridis)

set.seed(20260402)

# -----------------------------
# 3) 从CSV读入，并基于读入数据计算相关性
# -----------------------------
sim_df_from_csv <- read.csv("simulated_data.csv", check.names = FALSE)

# 数值列名（用于 ggpairs）
var_names <- names(sim_df_from_csv)

R_from_csv <- cor(sim_df_from_csv, method = "pearson", use = "complete.obs")

# -----------------------------
# 4) 用“读入后的数据”绘制相关性矩阵图
# -----------------------------

corr_fill <- scale_fill_gradient2(
  low = "#2b83ba", mid = "#f2f2f2", high = "#d7191c",
  midpoint = 0.77, limits = c(0.58, 0.96),
  name = "Pearson r",
  guide = guide_colorbar(barheight = grid::unit(70, "pt"), barwidth = grid::unit(10, "pt"))
)

p_stars <- function(p) {
  if (is.na(p)) return("")
  if (p < 0.001) return("***")
  if (p < 0.01) return("**")
  if (p < 0.05) return("*")
  if (p < 0.1) return(".")
  ""
}

upper_cor_tile <- function(data, mapping, ...) {
  x <- GGally::eval_data_col(data, mapping$x)
  y <- GGally::eval_data_col(data, mapping$y)
  ct <- suppressWarnings(cor.test(x, y, method = "pearson"))
  r <- unname(ct$estimate)
  p <- ct$p.value

  label_txt <- sprintf("r=%.2f\np=%.2g%s", r, p, p_stars(p))

  ggplot(data = data.frame(x = 1, y = 1, r = r, lab = label_txt), aes(x, y)) +
    geom_tile(aes(fill = r), color = "#3a3a3a", linewidth = 0.8) +
    geom_text(aes(label = lab), color = "white", size = 4.4, fontface = "bold", lineheight = 1.05) +
    corr_fill +
    xlim(0.5, 1.5) + ylim(0.5, 1.5) +
    theme_void() +
    theme(legend.position = "none")
}

lower_scatter_r2 <- function(data, mapping, ...) {
  x <- GGally::eval_data_col(data, mapping$x)
  y <- GGally::eval_data_col(data, mapping$y)

  d <- data.frame(x = x, y = y)

  ggplot(d, aes(x, y)) +
    # 先铺一层很淡的散点（示例中有轻微点云）
    geom_point(color = "#6EC5D8", alpha = 0.18, size = 0.7) +
    # 再叠加填充型二维核密度（接近示例的“团块”效果）
    stat_density_2d(
      aes(fill = after_stat(level)),
      geom = "polygon",
      contour = TRUE,
      bins = 10,
      alpha = 0.95,
      color = NA
    ) +
    # 叠加细轮廓线，增强层级感
    stat_density_2d(
      aes(color = after_stat(level)),
      linewidth = 0.28,
      bins = 10,
      show.legend = FALSE
    ) +
    # 使用现成颜色映射库（viridis/turbo），高密度端偏暖色（红）
    scale_fill_viridis_c(option = "turbo", direction = 1) +
    scale_color_viridis_c(option = "turbo", direction = 1) +
    theme_bw(base_size = 10) +
    theme(
      legend.position = "none",
      panel.grid = element_blank()
    )
}

diag_hist_density <- function(data, mapping, ...) {
  x <- GGally::eval_data_col(data, mapping$x)
  ggplot(data = data.frame(x = x), aes(x)) +
    geom_histogram(aes(y = after_stat(density)), bins = 16,
                   fill = "#f8fbff", color = "#333333", linewidth = 0.45) +
    geom_density(color = "#c58b82", linewidth = 1.0) +
    theme_bw(base_size = 10) +
    theme(panel.grid = element_blank())
}

# 注意：这里使用的是“从CSV读入的数据”
p_main <- GGally::ggpairs(
  sim_df_from_csv,
  columns = seq_along(var_names),
  upper = list(continuous = upper_cor_tile),
  lower = list(continuous = lower_scatter_r2),
  diag  = list(continuous = diag_hist_density),
  axisLabels = "none",
  columnLabels = var_names,
  showStrips = TRUE,
  switch = "both"
)

p_main <- p_main + theme(
  strip.background = element_rect(fill = "white", color = "#4a4a4a", linewidth = 0.8),
  strip.text = element_text(size = 11, face = "bold", color = "#222222"),
  panel.border = element_rect(color = "#4a4a4a", fill = NA, linewidth = 0.8),
  panel.background = element_rect(fill = "white", color = NA),
  plot.background = element_rect(fill = "white", color = NA),
  axis.text.x = element_blank(),
  axis.text.y = element_blank(),
  axis.ticks.x = element_blank(),
  axis.ticks.y = element_blank()
)

# 右侧相关性范围图例（竖向：从上到下；刻度在右侧）
legend_df <- data.frame(y = seq(0.58, 0.96, length.out = 240), x = 1)
p_legend <- ggplot(legend_df, aes(x = x, y = y, fill = y)) +
  geom_tile() +
  scale_fill_gradient2(low = "#2b83ba", mid = "#f2f2f2", high = "#d7191c",
                       midpoint = 0.77, limits = c(0.58, 0.96), guide = "none") +
  scale_y_continuous(
    limits = c(0.58, 0.96),
    breaks = c(0.58, 0.67, 0.77, 0.86, 0.96),
    position = "right"
  ) +
  scale_x_continuous(limits = c(0.5, 1.5), breaks = NULL) +
  labs(y = "Correlation range", x = NULL) +
  theme_minimal(base_size = 10) +
  theme(
    panel.grid = element_blank(),
    axis.text.x = element_blank(),
    axis.ticks.x = element_blank(),
    axis.title.x = element_blank(),
    panel.background = element_rect(fill = "white", color = NA),
    plot.background = element_rect(fill = "white", color = NA),
    axis.title.y.right = element_text(size = 10, face = "bold"),
    axis.text.y.right = element_text(color = "#222222")
  )

# 主图(ggmatrix)先转换为可拼接对象，再与右侧图例组合
p_main_plot <- ggplotify::as.ggplot(~print(p_main))
p_final <- p_main_plot + p_legend + patchwork::plot_layout(widths = c(30, 2))

ggsave("Figure.pdf", plot = p_final, width = 13.8, height = 12, dpi = 320, bg = "white")

print(p_final)
