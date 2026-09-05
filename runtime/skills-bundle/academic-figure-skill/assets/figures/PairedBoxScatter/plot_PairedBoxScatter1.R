library(ggplot2)
library(dplyr)
library(tidyr)

set.seed(20260418)

# 1. 模拟数据
n <- 14
id <- paste0("S", sprintf("%02d", 1:n))

before <- c(5.2, 4.8, 5.5, 6.1, 5.7, 4.9, 5.3, 6.0, 5.1, 5.8, 4.7, 5.4, 6.2, 5.0)
delta <- c(1.0, 0.7, -0.2, 1.2, 0.9, 0.6, 1.1, -0.1, 0.8, 0.5, 1.3, 0.4, 0.6, 0.9)
after <- before + delta

wide_df <- data.frame(
  id = id,
  Before = before,
  After = after
)

long_df <- wide_df %>%
  pivot_longer(cols = c(Before, After), names_to = "group", values_to = "value") %>%
  mutate(
    group = factor(group, levels = c("Before", "After")),
    x_plot = as.numeric(group) + runif(n(), -0.055, 0.055)
  )

# =========================
# 2. 统计检验
# =========================

paired_test <- t.test(wide_df$Before, wide_df$After, paired = TRUE)
print(paired_test)

summary_df <- long_df %>%
  group_by(group) %>%
  summarise(
    mean = mean(value),
    sd = sd(value),
    n = n(),
    .groups = "drop"
  )
print(summary_df)

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

# =========================
# 3. 作图
# =========================

max_y <- max(long_df$value)
min_y <- min(long_df$value)
star_y <- max_y + 0.45
ptext_y <- star_y + 0.18
plot_top <- ptext_y + 0.25

fill_colors <- c("Before" = "#DCEAF7", "After" = "#F9D9D6")
point_colors <- c("Before" = "#4C78A8", "After" = "#D95F5F")

p <- ggplot(long_df, aes(x = group, y = value)) +
  geom_boxplot(
    aes(fill = group),
    width = 0.48,
    outlier.shape = NA,
    alpha = 0.9,
    color = "#2F2F2F",
    linewidth = 0.55
  ) +
  geom_line(
    aes(x = x_plot, y = value, group = id),
    color = "#A0A0A0",
    alpha = 0.75,
    linewidth = 0.45
  ) +
  geom_point(
    aes(x = x_plot, color = group),
    size = 2.7,
    alpha = 0.95
  ) +
  annotate("segment", x = 1, xend = 2, y = star_y, yend = star_y,
           linewidth = 0.65, color = "black") +
  annotate("segment", x = 1, xend = 1, y = star_y - 0.08, yend = star_y,
           linewidth = 0.65, color = "black") +
  annotate("segment", x = 2, xend = 2, y = star_y - 0.08, yend = star_y,
           linewidth = 0.65, color = "black") +
  annotate("text", x = 1.5, y = star_y + 0.02, label = sig_label,
           size = 5.3, fontface = "bold", family = "sans") +
  annotate("text", x = 1.5, y = ptext_y, label = p_label,
           size = 3.8, fontface = "plain", family = "sans") +
  scale_fill_manual(values = fill_colors) +
  scale_color_manual(values = point_colors) +
  labs(
    x = NULL,
    y = "Relative expression",
    title = "Paired comparison"
  ) +
  coord_cartesian(ylim = c(min_y - 0.35, plot_top), clip = "off") +
  theme_classic(base_size = 13) +
  theme(
    plot.title = element_text(hjust = 0.5, face = "bold", size = 14),
    axis.title.y = element_text(face = "bold", size = 12, color = "black"),
    axis.text = element_text(size = 11, color = "black"),
    axis.line = element_line(linewidth = 0.6, color = "black"),
    axis.ticks = element_line(linewidth = 0.55, color = "black"),
    legend.position = "none",
    plot.margin = margin(10, 18, 10, 10)
  )

print(p)

# =========================
# 4. 导出结果
# =========================

write.csv(long_df, "plot_data1.csv", row.names = FALSE)

ggsave(
  filename = "Figrue1-1.png",
  plot = p,
  width = 3,
  height = 4.2,
  dpi = 600,
  bg = "white"
)

ggsave(
  filename = "Figrue1-1.pdf",
  plot = p,
  width = 3,
  height = 4.2,
  bg = "white"
)
