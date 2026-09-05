library(ggplot2)
library(dplyr)
library(tidyr)

set.seed(20260418)

# ============================================================
# 函数：只画 散点 + 配对连线 + 显著性（无箱体）
# ============================================================
plot_points_only_paired <- function(data,
                                    id_col = "id",
                                    group_col = "group",
                                    value_col = "value",
                                    group_levels = c("Before", "After"),
                                    title = "Paired comparison",
                                    y_label = "Relative expression",
                                    output_prefix = NULL,
                                    point_offsets = c(Before = 0.18, After = -0.18),
                                    base_size = 13) {
  
  df <- data %>%
    transmute(
      id = .data[[id_col]],
      group = factor(.data[[group_col]], levels = group_levels),
      value = .data[[value_col]]
    )
  
  g1 <- group_levels[1]
  g2 <- group_levels[2]
  
  test_df <- df %>%
    select(id, group, value) %>%
    pivot_wider(names_from = group, values_from = value)
  
  paired_test <- t.test(test_df[[g1]], test_df[[g2]], paired = TRUE)
  p_value <- paired_test$p.value
  
  p_label <- if (p_value < 0.001) {
    "Paired t-test, p < 0.001"
  } else {
    paste0("Paired t-test, p = ", format.pval(p_value, digits = 3, eps = 0.001))
  }
  
  sig_label <- dplyr::case_when(
    p_value < 0.001 ~ "***",
    p_value < 0.01 ~ "**",
    p_value < 0.05 ~ "*",
    TRUE ~ "ns"
  )
  
  # 散点位置
  point_df <- df %>%
    mutate(
      point_x = ifelse(group == g1, 1 + point_offsets[[g1]], 2 + point_offsets[[g2]])
    )
  
  max_y <- max(df$value)
  min_y <- min(df$value)
  star_y <- max_y + 0.45
  ptext_y <- star_y + 0.18
  plot_top <- ptext_y + 0.25
  
  point_colors <- c(Before = "#4C78A8", After = "#D95F5F")
  
  # ================== 核心：只画散点 + 连线 ==================
  p <- ggplot() +
    # 配对连线
    geom_line(
      data = point_df,
      aes(x = point_x, y = value, group = id),
      color = "#A0A0A0",
      alpha = 0.75,
      linewidth = 0.45
    ) +
    # 散点
    geom_point(
      data = point_df,
      aes(x = point_x, y = value, color = group),
      size = 2.7,
      alpha = 0.95
    ) +
    # 显著性标注
    annotate("segment", x = 1, xend = 2, y = star_y, yend = star_y, linewidth = 0.65) +
    annotate("segment", x = 1, xend = 1, y = star_y-0.08, yend = star_y, linewidth=0.65) +
    annotate("segment", x = 2, xend = 2, y = star_y-0.08, yend = star_y, linewidth=0.65) +
    annotate("text", x=1.5, y=star_y+0.02, label=sig_label, size=5.3, fontface="bold") +
    annotate("text", x=1.5, y=ptext_y, label=p_label, size=3.8) +
    
    scale_x_continuous(breaks = c(1, 2), labels = c(g1, g2), limits = c(0.5, 2.5)) +
    scale_color_manual(values = point_colors[group_levels]) +
    labs(x = NULL, y = y_label, title = title) +
    coord_cartesian(ylim = c(min_y - 0.35, plot_top), clip = "off") +
    theme_classic(base_size = base_size) +
    theme(
      plot.title = element_text(hjust = 0.5, face = "bold", size=14),
      axis.title.y = element_text(face="bold", size=12),
      axis.text = element_text(size=11),
      legend.position = "none",
      plot.margin = margin(10,18,10,10)
    )
  
  if (!is.null(output_prefix)) {
    ggsave(paste0(output_prefix, "_points_only.png"), p, width=3, height=4.2, dpi=600, bg="white")
    ggsave(paste0(output_prefix, "_points_only.pdf"), p, width=3, height=4.2, bg="white")
  }
  
  return(p)
}

# ============================================================
# 数据 & 调用
# ============================================================
n <- 14
id <- paste0("S", sprintf("%02d", 1:n))
before <- c(5.2, 4.8, 5.5, 6.1, 5.7, 4.9, 5.3, 6.0, 5.1, 5.8, 4.7, 5.4, 6.2, 5.0)
delta  <- c(1.0, 0.7, -0.2, 1.2, 0.9, 0.6, 1.1, -0.1, 0.8, 0.5, 1.3, 0.4, 0.6, 0.9)
after  <- before + delta

wide_df <- data.frame(id = id, Before = before, After = after)
long_df <- wide_df %>%
  pivot_longer(cols = c(Before, After), names_to = "group", values_to = "value") %>%
  mutate(group = factor(group, levels = c("Before", "After")))

# 调用画图（只有散点）
p <- plot_points_only_paired(
  data = long_df,
  point_offsets = c(Before = 0.12, After = -0.12),  # 散点位置不变
  output_prefix = "Figure3-1"
)

print(p)