
# 运行前安装：
# install.packages(c("MASS", "Matrix", "GGally", "ggplot2", "dplyr"))

library(MASS)
library(Matrix)
library(GGally)
library(ggplot2)
library(dplyr)

set.seed(20260402)

# -----------------------------
# 0) 参数设置
# -----------------------------
n_group <- 3
n_each <- 45
# 固定分组顺序（用于图例与分面显示顺序）
# 底部直方图分行顺序：Group1(上) -> Group2(中) -> Group3(下)
group_names <- c("Group1", "Group2", "Group3")
var_names <- paste0("Pheno", 1:6)

# CNS风格配色（蓝-红-黄），与分组顺序一一对应
group_cols <- c("Group1" = "#3C5488", "Group2" = "#53adb8", "Group3" = "#F2A900")

# -----------------------------
# 3) 读入CSV并计算相关矩阵
# -----------------------------
plot_df <- read.csv("simulated_data.csv", check.names = FALSE)
plot_df$Group <- factor(plot_df$Group, levels = group_names)

R_all <- cor(plot_df[, var_names], method = "pearson", use = "complete.obs")

# -----------------------------
# 4) 自定义 ggpairs 面板
# -----------------------------
p_stars <- function(p) {
  if (is.na(p)) return("")
  if (p < 0.001) return("***")
  if (p < 0.01) return("**")
  if (p < 0.05) return("*")
  if (p < 0.1) return(".")
  ""
}

upper_group_cor <- function(data, mapping, ...) {
  x <- GGally::eval_data_col(data, mapping$x)
  y <- GGally::eval_data_col(data, mapping$y)
  g <- data$Group

  ct_all <- suppressWarnings(cor.test(x, y, method = "pearson"))
  txt_all <- sprintf("Corr: %.3f%s", unname(ct_all$estimate), p_stars(ct_all$p.value))

  ann <- data.frame(
    x = 0.04,
    y = c(0.90, 0.66, 0.42, 0.18),
    label = c(txt_all, "", "", ""),
    grp = c("all", group_names)
  )

  for (i in seq_along(group_names)) {
    gi <- group_names[i]
    idx <- g == gi
    cti <- suppressWarnings(cor.test(x[idx], y[idx], method = "pearson"))
    ann$label[i + 1] <- sprintf("%s: %.3f%s", gi, unname(cti$estimate), p_stars(cti$p.value))
  }

  ggplot() +
    annotate("rect", xmin = -Inf, xmax = Inf, ymin = -Inf, ymax = Inf,
             fill = "white", color = NA) +
    geom_text(data = ann %>% filter(grp == "all"),
              aes(x = x, y = y, label = label),
              hjust = 0, vjust = 1, size = 4.7, color = "#4F4F4F") +
    geom_text(data = ann %>% filter(grp != "all"),
              aes(x = x, y = y, label = label, color = grp),
              hjust = 0, vjust = 1, size = 4.6, fontface = "bold", alpha = 0.92) +
    scale_color_manual(values = group_cols) +
    coord_cartesian(xlim = c(0, 1), ylim = c(0, 1), expand = FALSE) +
    theme_void() +
    theme(
      legend.position = "none",
      panel.border = element_rect(color = "#4D4D4D", fill = NA, linewidth = 0.9)
    )
}

lower_group_scatter <- function(data, mapping, ...) {
  ggplot(data = data, mapping = mapping) +
    geom_point(aes(color = Group), size = 2.0, alpha = 0.75) +
    geom_smooth(aes(color = Group, fill = Group), method = "lm", se = TRUE,
                linewidth = 0.9, alpha = 0.16) +
    scale_color_manual(values = group_cols) +
    scale_fill_manual(values = group_cols) +
    theme_bw(base_size = 10) +
    theme(
      legend.position = "none",
      panel.background = element_rect(fill = "white", color = NA),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(color = "#ECECEC", linewidth = 0.22)
    )
}

diag_group_density <- function(data, mapping, ...) {
  x <- GGally::eval_data_col(data, mapping$x)
  d <- data.frame(x = x, Group = data$Group)

  ggplot(d, aes(x = x, color = Group, fill = Group)) +
    geom_density(alpha = 0.20, linewidth = 0.95, adjust = 0.95) +
    scale_color_manual(values = group_cols) +
    scale_fill_manual(values = group_cols) +
    theme_bw(base_size = 10) +
    theme(
      legend.position = "none",
      panel.background = element_rect(fill = "white", color = NA),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(color = "#ECECEC", linewidth = 0.22)
    )
}

# 数值-分组（右侧列）: 箱线图
combo_box <- function(data, mapping, ...) {
  ggplot(data = data, mapping = mapping) +
    geom_boxplot(aes(fill = Group), width = 0.62, alpha = 0.35,
                 color = "#2F2F2F", outlier.size = 1.6, outlier.alpha = 0.35) +
    scale_fill_manual(values = group_cols) +
    theme_bw(base_size = 10) +
    theme(
      legend.position = "none",
      panel.background = element_rect(fill = "white", color = NA),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(color = "#ECECEC", linewidth = 0.22)
    )
}

# 分组-数值（底部行）: 各组直方图“分行显示”，不重叠
combo_hist <- function(data, mapping, ...) {
  x <- GGally::eval_data_col(data, mapping$x)
  d <- data.frame(x = x, Group = factor(data$Group, levels = group_names))

  ggplot(d, aes(x = x, fill = Group)) +
    geom_histogram(bins = 12, alpha = 0.95, color = "#FFFFFF", linewidth = 0.18) +
    scale_fill_manual(values = group_cols) +
    facet_grid(Group ~ ., scales = "free_y", switch = "y") +
    theme_bw(base_size = 9) +
    theme(
      legend.position = "none",
      panel.background = element_rect(fill = "white", color = NA),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(color = "#ECECEC", linewidth = 0.20),
      strip.background = element_rect(fill = "white", color = "#DDDDDD", linewidth = 0.3),
      strip.text.y.left = element_text(angle = 0, size = 7, color = "#444444"),
      strip.placement = "outside",
      axis.title = element_blank(),
      axis.text.y = element_text(size = 6)
    )
}

diag_group_bar <- function(data, mapping, ...) {
  ggplot(data, aes(x = Group, fill = Group)) +
    geom_bar(alpha = 0.9, width = 0.85) +
    scale_fill_manual(values = group_cols) +
    theme_bw(base_size = 10) +
    theme(
      legend.position = "none",
      panel.background = element_rect(fill = "white", color = NA),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(color = "#ECECEC", linewidth = 0.22)
    )
}

# -----------------------------
# 5) 合并图（含Group列）：底部直方图按组分行，不重叠
# -----------------------------
p_all <- GGally::ggpairs(
  plot_df,
  columns = c(var_names, "Group"),
  mapping = aes(color = Group, fill = Group),
  upper = list(
    continuous = upper_group_cor,
    combo = combo_box,
    discrete = GGally::wrap("countDiag")
  ),
  lower = list(
    continuous = lower_group_scatter,
    combo = combo_hist,
    discrete = GGally::wrap("countDiag")
  ),
  diag = list(
    continuous = diag_group_density,
    discrete = diag_group_bar
  ),
  axisLabels = "show"
)

p_all <- p_all + theme(
  strip.background = element_rect(fill = "white", color = "#4D4D4D", linewidth = 0.9),
  strip.text = element_text(size = 10, face = "bold", color = "#222222"),
  panel.border = element_rect(color = "#4D4D4D", fill = NA, linewidth = 0.9),
  legend.position = "bottom",
  legend.title = element_blank(),
  panel.background = element_rect(fill = "white", color = NA),
  plot.background = element_rect(fill = "white", color = NA)
)

ggsave("Figure.pdf", plot = p_all, width = 15.5, height = 15, dpi = 320, bg = "white")

# -----------------------------
# 6) 每个 Group 单独绘图（不放在一张图里）
# -----------------------------

# 单组上三角：相关系数 + 显著性
upper_single_cor <- function(data, mapping, ...) {
  x <- GGally::eval_data_col(data, mapping$x)
  y <- GGally::eval_data_col(data, mapping$y)
  ct <- suppressWarnings(cor.test(x, y, method = "pearson"))
  txt <- sprintf("Corr: %.3f%s", unname(ct$estimate), p_stars(ct$p.value))

  ggplot() +
    annotate("rect", xmin = -Inf, xmax = Inf, ymin = -Inf, ymax = Inf,
             fill = "white", color = NA) +
    annotate("text", x = 0.05, y = 0.70, label = txt,
             hjust = 0, vjust = 1, size = 4.8, color = "#4F4F4F") +
    coord_cartesian(xlim = c(0, 1), ylim = c(0, 1), expand = FALSE) +
    theme_void() +
    theme(panel.border = element_rect(color = "#4D4D4D", fill = NA, linewidth = 0.9))
}

# 单组下三角：散点 + 拟合线
lower_single_scatter <- function(data, mapping, ...) {
  gi <- as.character(unique(data$Group))[1]
  col_i <- group_cols[[gi]]

  ggplot(data = data, mapping = mapping) +
    geom_point(color = col_i, size = 2.0, alpha = 0.78) +
    geom_smooth(method = "lm", se = TRUE, color = col_i, fill = col_i,
                linewidth = 0.9, alpha = 0.16) +
    theme_bw(base_size = 10) +
    theme(
      legend.position = "none",
      panel.background = element_rect(fill = "white", color = NA),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(color = "#ECECEC", linewidth = 0.22)
    )
}

# 单组对角线：密度曲线
diag_single_density <- function(data, mapping, ...) {
  gi <- as.character(unique(data$Group))[1]
  col_i <- group_cols[[gi]]
  x <- GGally::eval_data_col(data, mapping$x)
  d <- data.frame(x = x)

  ggplot(d, aes(x = x)) +
    geom_density(fill = col_i, color = col_i, alpha = 0.22, linewidth = 0.95, adjust = 0.95) +
    theme_bw(base_size = 10) +
    theme(
      legend.position = "none",
      panel.background = element_rect(fill = "white", color = NA),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(color = "#ECECEC", linewidth = 0.22)
    )
}

for (gi in group_names) {
  df_i <- plot_df %>% filter(Group == gi)

  p_i <- GGally::ggpairs(
    df_i,
    columns = var_names,
    upper = list(continuous = upper_single_cor),
    lower = list(continuous = lower_single_scatter),
    diag  = list(continuous = diag_single_density),
    axisLabels = "show"
  )

  p_i <- p_i +
    theme(
      strip.background = element_rect(fill = "white", color = "#4D4D4D", linewidth = 0.9),
      strip.text = element_text(size = 11, face = "bold", color = "#222222"),
      panel.border = element_rect(color = "#4D4D4D", fill = NA, linewidth = 0.9),
      panel.background = element_rect(fill = "white", color = NA),
      plot.background = element_rect(fill = "white", color = NA)
    )

  out_file <- paste0("Figure_", gi, ".pdf")
  ggsave(out_file, plot = p_i, width = 13, height = 12, dpi = 320, bg = "white")

  cat(sprintf("已输出 %s\n", out_file))
}

print(round(R_all, 3))