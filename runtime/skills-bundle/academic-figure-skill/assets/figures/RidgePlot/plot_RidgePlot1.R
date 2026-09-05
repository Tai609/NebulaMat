suppressPackageStartupMessages({
  library(ggplot2)
  library(ggridges)
  library(readr)
  library(dplyr)
  library(tidyr)
  library(forcats)
})

wide_df <- read_csv("data.csv", show_col_types = FALSE)

region_levels <- c(
  "Afrotropic", "Antarctic", "Australasia", "Indomalaya", "Nearctic",
  "Neotropic", "Oceania", "Palearctic", "Multiple"
)

plot_df <- wide_df %>%
  pivot_longer(
    cols = all_of(region_levels),
    names_to = "region",
    values_to = "value"
  ) %>%
  filter(!is.na(value)) %>%
  mutate(
    region = factor(region, levels = rev(region_levels)),
    top_title = "Publication year",
    right_title = "Terrestrial realms"
  )

n_df <- plot_df %>%
  count(region, name = "n") %>%
  mutate(label = paste0("n = ", n))

line_df <- plot_df %>%
  mutate(
    y_id = as.numeric(region),
    y0 = y_id - 0.14,
    y1 = y_id + 0.14
  )


# pal <- c(
#   "Afrotropic" = "#E8E063",
#   "Antarctic" = "#BFC3C7",
#   "Australasia" = "#F08C49",
#   "Indomalaya" = "#D85D69",
#   "Nearctic" = "#B84F87",
#   "Neotropic" = "#8D42AA",
#   "Oceania" = "#6C3EA4",
#   "Palearctic" = "#4A3B86",
#   "Multiple" = "#9AA0A6"
# )

# pal <- c(
#   "Afrotropic" = "#62a9a3",
#   "Antarctic" = "#619da5",
#   "Australasia" = "#c6f257",
#   "Indomalaya" = "#b0ee67",
#   "Nearctic" = "#9cea7c",
#   "Neotropic" = "#89e38c",
#   "Oceania" = "#78dd9b",
#   "Palearctic" = "#69c2a4",
#   "Multiple" = "#9AA0A6"
# )

pal <- c(
  "Afrotropic" = "#4477AA",
  "Antarctic" = "#66CCEE",
  "Australasia" = "#228833",
  "Indomalaya" = "#CCBB44",
  "Nearctic" = "#EE6677",
  "Neotropic" = "#AA3377",
  "Oceania" = "#BBBBBB",
  "Palearctic" = "#9977BB",
  "Multiple" = "#555555"
)
p <- ggplot(plot_df, aes(x = value, y = region, fill = region)) +
  geom_hline(
    yintercept = seq_along(region_levels),
    linetype = "dashed",
    linewidth = 0.65,
    color = "#B9B9B9"
  ) +
  
  geom_density_ridges(
    scale = 0.82,
    rel_min_height = 0.001,
    bandwidth = 2.8,
    alpha = 0.92,
    color = "#222222",
    linewidth = 0.9
  ) +
  
  geom_segment(
    data = line_df,
    aes(x = value, xend = value, y = y0, yend = y1),
    inherit.aes = FALSE,
    color = "#222222",
    linewidth = 0.22,
    alpha = 0.85
  ) +
  
  geom_text(
    data = n_df,
    aes(x = -Inf, y = region, label = label),
    inherit.aes = FALSE,
    hjust = 0,
    vjust = -0.8,
    position = position_nudge(x = 8),
    size = 12.0 / .pt,
    color = "#222222"
  ) +
  
  
  facet_grid(
    rows = vars(right_title),  
    cols = vars(top_title), 
    labeller = labeller(
      top_title = ~"Publication year",
      right_title = ~"Terrestrial realms"
    )
  ) +
  
  scale_fill_manual(values = pal, drop = FALSE) +
  
  scale_x_continuous(expand = expansion(mult = c(0.12, 0.08))) +
  scale_y_discrete(expand = expansion(mult = c(0.08, 0.10))) +
  labs(x = NULL, y = NULL) +
  coord_cartesian(clip = "off") +
  theme_minimal(base_size = 11) +
  theme(
    legend.position = "none",
    panel.background = element_rect(fill = "white", color = NA),
    panel.grid = element_blank(),
    
    
    axis.text.y = element_text(size = 20, color = "#111111"),
    axis.text.x = element_text(size = 14, color = "#111111"),
    axis.ticks.x = element_line(linewidth = 0.75, color = "black"),
    axis.ticks.length.x = unit(4, "pt"),
    
    strip.background = element_rect(
      fill = "#D4D4D4",    
      color = "black",    
      linewidth = 0.75
    ),
    strip.text.x = element_text(
      size = 22,
      color = "#111111",
      margin = margin(6, 0, 6, 0)
    ),
    strip.text.y.right = element_text(
      angle = -90,
      size = 22,
      color = "#111111",
      margin = margin(0, 6, 0, 6)
    ),
    strip.placement = "outside",  
    
    panel.border = element_rect(fill = NA, color = "black", linewidth = 0.75),
    panel.spacing = unit(6, "pt"),
    
    plot.background = element_rect(fill = "white", color = "black", linewidth = 0.75),
    plot.margin = margin(t = 6, r = 26, b = 6, l = 26)
  )

ggsave(
  filename = "Ridge2.pdf",
  plot = p,
  width = 850 / 120,
  height = 786 / 120,
  dpi = 120,
  bg = "white"
)