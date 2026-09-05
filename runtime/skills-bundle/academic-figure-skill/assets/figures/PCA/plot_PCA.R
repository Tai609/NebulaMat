
library(ggplot2)
library(dplyr)
library(tidyr)
library(FactoMineR)
library(factoextra)
library(patchwork)
library(stringr)

plot_metabolite_pca <- function(
    data_file,
    metcat_file,
    color_file,
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
  
  # =========================
  # Load files
  # =========================
  
  color_df <- read.csv(color_file, sep="\t")
  
  data_df <- read.csv(data_file, sep="\t")
  
  metcat_df <- read.csv(metcat_file, sep="\t") %>%
    mutate(
      compound = stringr::str_extract(
        .data[[compound_col]],
        "M_(.+)_e",
        group = 1
      )
    )
  
  # =========================
  # Merge category annotation
  # =========================
  
  data_df <- data_df %>%
    left_join(
      metcat_df,
      by = compound_col
    ) %>%
    replace(is.na(.), "uncategorized")
  
  # =========================
  # Aggregate by metabolite category
  # =========================
  
  metcat_data_df <- data_df %>%
    group_by(
      .data[[community_col]],
      met_category
    ) %>%
    summarise(
      value = sum(.data[[value_col]]),
      .groups = "drop"
    )
  
  # =========================
  # Pivot to wide format
  # =========================
  
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
        select(
          all_of(c(
            community_col,
            category_col,
            size_col
          ))
        ) %>%
        distinct(),
      by = community_col
    )
  
  # rownames
  row.names(data_wide) <- data_wide[[community_col]]
  
  data_wide <- data_wide %>%
    select(-all_of(community_col))
  
  # =========================
  # PCA
  # =========================
  
  res.pca <- PCA(
    data_wide,
    scale.unit = scale.unit,
    graph = FALSE
  )
  
  # =========================
  # PCA biplot
  # =========================
  
  pca_plot <- fviz_pca_biplot(
    res.pca,
    label = "none",
    palette = c(color_df$colors, "grey"),
    col.var = "grey50",
    pointsize = data_wide_info[[size_col]],
    repel = TRUE,
    geom = "point",
    alpha = 0.7,
    habillage = ordered(
      data_wide_info[[category_col]],
      levels = c(color_df$category, "Random")
    ),
    addEllipse = TRUE,
    pointshape = 16,
    invisible = "quali"
  ) +
    guides(size = guide_legend(title = "Community size")) +
    theme_bw() +
    theme(
      axis.text = element_text(size = 15),
      axis.title = element_text(size = 16)
    )
  
  # =========================
  # PC1 contribution
  # =========================
  
  pc1_contrib <- fviz_contrib(
    res.pca,
    choice = "var",
    axes = 1,
    top = top_contrib,
    fill = "royalblue",
    color = "black",
    sort.val = "asc"
  ) +
    theme_minimal() +
    ylab("Dim1 contrib. (%)") +
    coord_flip() +
    theme(
      title = element_blank(),
      axis.title.y = element_blank(),
      axis.text.x = element_text(
        angle = 90,
        vjust = 1,
        hjust = 1
      ),
      axis.text = element_text(size = 8),
      axis.title = element_text(size = 12)
    )
  
  # =========================
  # PC2 contribution
  # =========================
  
  pc2_contrib <- fviz_contrib(
    res.pca,
    choice = "var",
    axes = 2,
    top = top_contrib,
    fill = "royalblue",
    color = "black",
    sort.val = "asc"
  ) +
    theme_minimal() +
    ylab("Dim2 contrib. (%)") +
    coord_flip() +
    theme(
      title = element_blank(),
      axis.title.y = element_blank(),
      axis.text.x = element_text(
        angle = 90,
        vjust = 1,
        hjust = 1
      ),
      axis.text = element_text(size = 8),
      axis.title = element_text(size = 12)
    )
  
  # =========================
  # Combine figure
  # =========================
  
  assembled_fig <- pca_plot /
    (pc1_contrib + pc2_contrib) +
    plot_layout(heights = c(2, 1))
  
  # =========================
  # Save
  # =========================
  
  ggsave(
    paste0(output_prefix, ".pdf"),
    assembled_fig,
    width = width,
    height = height,
    dpi = dpi
  )
  
  ggsave(
    paste0(output_prefix, ".png"),
    assembled_fig,
    width = width,
    height = height,
    dpi = dpi
  )
  
  ggsave(
    paste0(output_prefix, ".svg"),
    assembled_fig,
    width = width,
    height = height,
    dpi = dpi
  )
  
  # =========================
  # Return results
  # =========================
  
  return(list(
    pca = res.pca,
    plot = assembled_fig,
    wide_data = data_wide,
    metadata = data_wide_info
  ))
}



result <- plot_metabolite_pca(
  data_file = "./Data/smetana_sum_normalized_by_categories.tsv",
  metcat_file = "./Data/metabolite_categories.tsv",
  color_file = "./Data/metabolite_categories_colors.tsv",
  output_prefix = "./Fig/coactivity_pca"
)

result$plot

