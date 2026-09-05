# Academic Figure Skill Multi-Panel Composition — R engine
# Source: source("references/compose.R")
# Depends: ggplot2, patchwork, showtext

suppressPackageStartupMessages({
  library(ggplot2)
  library(patchwork)
  library(showtext)
})

showtext_auto()

# ═══════════════════════════════════════════════════════════
# Panel Aspect Ratios (height/width)
# ═══════════════════════════════════════════════════════════
PANEL_ASPECT <- c(
  heatmap = 1.0, corr_heatmap = 1.0, correlation_heatmap = 1.0,
  correlation_matrix = 1.0, grouped_correlation_matrix = 1.0,
  pca = 1.0, rda = 1.0,
  radar = 1.0, confusion_matrix = 1.0, upset = 0.95,
  mantel_correlation = 1.0,
  auroc = 0.85, volcano = 0.85, roc = 0.85,
  violin = 0.75, box = 0.75, line = 0.75, trend = 0.75,
  bar = 0.70, forest = 0.70, scatter = 0.75,
  ridge = 0.65, kde = 0.65, density = 0.65,
  sankey = 0.50, bubble = 0.75,
  dotplot = 0.75, manifold = 1.0, singlecell = 0.85
)

# ═══════════════════════════════════════════════════════════
# Unified CNS Baseline Theme
# ═══════════════════════════════════════════════════════════
# Font scale: fewer panels = bigger fonts. Keyed to panel count.
FONT_SCALE <- c("1" = 1.25, "2" = 1.20, "3" = 1.15, "4" = 1.10, "5" = 1.05, "6" = 1.00)
.default_scale <- function(n) if (n <= 6) FONT_SCALE[[as.character(n)]] else 0.95

theme_cns <- function(n_panels = 4) {
  s <- .default_scale(n_panels)
  theme_bw(base_size = round(8 * s), base_family = "Arial") +
    theme(
      axis.title = element_text(size = round(8 * s)),
      axis.text = element_text(size = round(7 * s), color = "#333333"),
      legend.title = element_text(size = round(8 * s)),
      legend.text = element_text(size = round(7 * s)),
      legend.background = element_blank(),
      legend.key = element_blank(),
      panel.grid = element_blank(),
      panel.border = element_rect(color = "black", linewidth = 0.5),
      plot.title = element_text(size = round(9 * s), face = "bold")
    )
}

# Default for single-panel / backward compat
theme_cns_default <- theme_cns(4)

#' Get optimal aspect ratio for a panel type
get_aspect <- function(panel_type) {
  panel_type <- tolower(gsub("[ _-]", "_", panel_type))
  for (key in names(PANEL_ASPECT)) {
    if (grepl(key, panel_type, fixed = TRUE)) {
      return(PANEL_ASPECT[[key]])
    }
  }
  return(0.85)
}

#' Calculate symmetric grid layout
layout_symmetric <- function(panel_types, fig_width_mm = 183) {
  n <- length(panel_types)
  aspects <- sapply(panel_types, get_aspect)

  if (n == 1)      { cols <- 1; rows <- 1 }
  else if (n == 2) { cols <- 2; rows <- 1 }
  else if (n == 3) { cols <- 3; rows <- 1 }
  else if (n == 4) { cols <- 2; rows <- 2 }
  else if (n <= 6) { cols <- 3; rows <- 2 }
  else if (n <= 9) { cols <- 3; rows <- 3 }
  else             { cols <- 4; rows <- ceiling(n / 4) }

  spacing <- list(
    "1x1" = c(0, 0),     "2x1" = c(0.25, 0),
    "3x1" = c(0.22, 0),  "2x2" = c(0.25, 0.28),
    "3x2" = c(0.22, 0.25), "3x3" = c(0.22, 0.25),
    "4x3" = c(0.24, 0.26), "4x4" = c(0.26, 0.28)
  )
  key <- paste0(rows, "x", cols)
  if (key %in% names(spacing)) {
    ws_hs <- spacing[[key]]
  } else {
    ws_hs <- c(0.24, 0.26)
  }
  wspace <- ws_hs[1]; hspace <- ws_hs[2]

  row_heights <- sapply(1:rows, function(r) {
    start_idx <- (r - 1) * cols + 1
    end_idx <- min(r * cols, n)
    max(aspects[start_idx:end_idx])
  })

  margin <- 0.10
  panel_w_mm <- (fig_width_mm * (1 - 2 * margin)) / (cols + (cols - 1) * wspace)

  list(cols = cols, rows = rows, row_heights = row_heights,
       wspace = wspace, hspace = hspace, panel_w_mm = panel_w_mm)
}

#' Compose multi-panel figure from ggplot objects
#'
#' @param plots List of ggplot objects
#' @param panel_types Character vector of figure types
#' @param fig_width_mm Journal column width (89 or 183)
#' @param output_prefix Base filename for export
#' @param panel_labels Custom labels (auto-generates a,b,c... if NULL)
#' @param add_theme Apply unified CNS theme to all plots (default TRUE)
#'
#' @return Combined patchwork object
compose_figure <- function(
    plots,
    panel_types,
    fig_width_mm = 183,
    output_prefix = "figure",
    panel_labels = NULL,
    add_theme = TRUE
) {
  n <- length(plots)
  if (is.null(panel_labels)) {
    panel_labels <- letters[1:n]
  }

  # Apply unified theme to all plots (scaled to panel count)
  if (add_theme) {
    plots <- lapply(plots, function(p) p + theme_cns(n))
  }

  # Layout calculation
  layout <- layout_symmetric(panel_types, fig_width_mm)

  # Guardrail
  if (layout$panel_w_mm < 35) {
    stop(sprintf("Panel width %.0fmm < 35mm floor. Split into multiple figures.",
                 layout$panel_w_mm))
  }
  if (layout$panel_w_mm < 45) {
    warning(sprintf("Panel width %.0fmm < 45mm. Text may be compact.",
                    layout$panel_w_mm))
  }

  # Add panel labels
  plots_labeled <- lapply(seq_along(plots), function(i) {
    plots[[i]] + labs(tag = panel_labels[i]) +
      theme(plot.tag = element_text(face = "bold", size = 9, family = "Arial"))
  })

  # Compose with patchwork
  if (layout$rows == 1) {
    combined <- wrap_plots(plots_labeled, ncol = layout$cols)
  } else {
    combined <- wrap_plots(plots_labeled, ncol = layout$cols,
                           nrow = layout$rows,
                           byrow = TRUE)
  }

  combined <- combined + plot_layout(
    widths = rep(1, layout$cols),
    heights = layout$row_heights,
    guides = "collect"
  )

  # Calculate figure dimensions
  fig_height_mm <- layout$panel_w_mm * sum(layout$row_heights) * 1.35
  fig_height_mm <- min(fig_height_mm, 247)

  # Export: PDF (vector) + PNG (Cairo native font, no showtext path conversion)
  ggsave(paste0(output_prefix, ".pdf"), combined,
         width = fig_width_mm, height = fig_height_mm,
         units = "mm", device = cairo_pdf, dpi = 300)
  # For PNG: disable showtext so Cairo renders fonts natively (not via paths).
  # showtext paths → pixel grid at 300dpi = jagged. Cairo native = smooth.
  if (exists("showtext_auto")) showtext_auto(FALSE)
  png(paste0(output_prefix, ".png"), width = fig_width_mm, height = fig_height_mm,
      units = "mm", res = 300, type = "cairo")
  print(combined); dev.off()
  if (exists("showtext_auto")) showtext_auto(TRUE)

  cat(sprintf("Figure: %dmm wide, %dx%d, %d panels\n",
              fig_width_mm, layout$rows, layout$cols, n))
  cat(sprintf("Panel width: %.0fmm\n", layout$panel_w_mm))
  cat(sprintf("Row heights: %s\n", paste(round(layout$row_heights, 2), collapse = ", ")))
  cat(sprintf("Exported: %s.pdf + %s.png\n", output_prefix, output_prefix))

  invisible(combined)
}
