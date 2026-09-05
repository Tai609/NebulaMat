library(ggplot2)
library(dplyr)
library(tidyr)
library(FactoMineR)
library(factoextra)
library(patchwork)
library(stringr)

# ==============================
# 通用 PCA 绘图函数
# ==============================
plot_metabolite_pca_science <- function(
    data_file,
    metcat_file,
    color_file = NULL,     # 可留空，统一使用 Science 配色
    output_prefix = "PCA_result",
    value_col = "smetana_sum_normalized",
    compound_col = "compound",
    community_col = "community",
    category_col = "category",
    size_col = "size",
    top_contrib = 20,
    scale.unit = TRUE,
    width = 7,
    height = 7,
    dpi = 300
){
  
  # ------------------------------
  # 1. Load data
  # ------------------------------
  data_df <- read.csv(data_file, sep="\t")
  metcat_df <- read.csv(metcat_file, sep="\t") %>%
    mutate(
      compound = stringr::str_extract(
        .data[[compound_col]],
        "M_(.+)_e",
        group = 1
      )
    )
  
  # ------------------------------
  # 2. Merge metabolite category
  # ------------------------------
  data_df <- data_df %>%
    left_join(metcat_df, by = compound_col) %>%
    replace(is.na(.), "uncategorized")
  
  # ------------------------------
  # 3. Aggregate by metabolite category
  # ------------------------------
  metcat_data_df <- data_df %>%
    group_by(.data[[community_col]], met_category) %>%
    summarise(value = sum(.data[[value_col]]), .groups = "drop")
  
  # ------------------------------
  # 4. Pivot to wide format
  # ------------------------------
  data_wide <- metcat_data_df %>%
    pivot_wider(
      id_cols = all_of(community_col),
      names_from = met_category,
      values_from = value,
      values_fill = 0
    )
  
  # metadata
  data_wide_info <- data_wide[, community_col, drop=FALSE] %>%
    left_join(
      data_df %>%
        select(all_of(c(community_col, category_col, size_col))) %>%
        distinct(),
      by = community_col
    )
  
  row.names(data_wide) <- data_wide[[community_col]]
  data_wide <- data_wide %>% select(-all_of(community_col))
  
  # ------------------------------
  # 5. PCA
  # ------------------------------
  res.pca <- PCA(data_wide, scale.unit = scale.unit, graph = FALSE)
  
  # ------------------------------
  # 6. PCA biplot
  # ------------------------------
  pca_plot <- fviz_pca_biplot(
    res.pca,
    label = "none",
    palette = science_colors,
    col.var = "grey50",
    pointsize = data_wide_info[[size_col]],
    repel = TRUE,
    geom = "point",
    alpha = 0.8,
    habillage = ordered(
      data_wide_info[[category_col]],
      levels = unique(data_wide_info[[category_col]])
    ),
    addEllipse = TRUE,
    pointshape = 16,
    invisible = "quali"
  ) +
    guides(size = guide_legend(title = "Community size")) +
    theme_bw(base_size = 14) +
    theme(
      panel.grid = element_blank(),
      axis.text = element_text(size = 14),
      axis.title = element_text(size = 16),
      legend.text = element_text(size = 12),
      legend.title = element_text(size = 13)
    )
  
  # ------------------------------
  # 7. PC contributions
  # ------------------------------
  pc1_contrib <- fviz_contrib(
    res.pca, choice = "var", axes = 1, top = top_contrib,
    fill = "#1f77b4", color = "black", sort.val = "asc"
  ) + coord_flip() +
    theme_minimal() +
    ylab("Dim1 contrib. (%)") +
    theme(
      title = element_blank(),
      axis.title.y = element_blank(),
      axis.text.x = element_text(angle = 90, vjust = 1, hjust=1),
      axis.text = element_text(size = 10)
    )
  
  pc2_contrib <- fviz_contrib(
    res.pca, choice = "var", axes = 2, top = top_contrib,
    fill = "#ff7f0e", color = "black", sort.val = "asc"
  ) + coord_flip() +
    theme_minimal() +
    ylab("Dim2 contrib. (%)") +
    theme(
      title = element_blank(),
      axis.title.y = element_blank(),
      axis.text.x = element_text(angle = 90, vjust = 1, hjust=1),
      axis.text = element_text(size = 10)
    )
  
  # ------------------------------
  # 8. Assemble figure
  # ------------------------------
  assembled_fig <- pca_plot / (pc1_contrib + pc2_contrib) +
    plot_layout(heights = c(2,1))
  
  # ------------------------------
  # 9. Save outputs
  # ------------------------------
  ggsave(paste0(output_prefix, ".pdf"), assembled_fig, width = width, height = height, dpi = dpi)
  ggsave(paste0(output_prefix, ".png"), assembled_fig, width = width, height = height, dpi = dpi)
  ggsave(paste0(output_prefix, ".svg"), assembled_fig, width = width, height = height, dpi = dpi)
  
  # ------------------------------
  # 10. Return results
  # ------------------------------
  return(list(
    pca = res.pca,
    plot = assembled_fig,
    wide_data = data_wide,
    metadata = data_wide_info
  ))
}


science_colors <- c(
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
  "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
  "#bcbd22", "#17becf"
)

result <- plot_metabolite_pca_science(
  data_file = "./Data/smetana_sum_normalized_by_categories.tsv",
  metcat_file = "./Data/metabolite_categories.tsv",
  output_prefix = "./Fig/coactivity_pca_science"
)
result$plot