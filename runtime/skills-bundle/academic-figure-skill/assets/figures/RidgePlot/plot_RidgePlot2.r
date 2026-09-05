if (!require("ggridges")) install.packages("ggridges")
if (!require("ggplot2")) install.packages("ggplot2")
if (!require("dplyr")) install.packages("dplyr")
library(ggridges)
library(ggplot2)
library(dplyr)

set.seed(123)

df_sim <- read.csv('./dataa.csv')

df_sim$Feature <- factor(
  df_sim$Feature,
  levels = paste0("Feature ", LETTERS[6:1])
)


p <- ggplot(df_sim, aes(x = value, y = Feature)) +
  
  geom_hline(aes(yintercept = Feature), color = "black", linewidth = 0.5) +
  
  geom_density_ridges(
    aes(fill = Feature),
    alpha = 0.85,
    color = "black",
    linewidth = 0.8,
    scale = 1,         
    trim = TRUE     
  ) +
  
  scale_fill_manual(values = c(
    "#4A5FB4", 
    "#639FD1", 
    "#9CD6EB",
    "#FDD888", 
    "#F2784B", 
    "#A81238"
  )) +
  
  xlim(10, 80) +
  
  expand_limits(y = 7.5) +
  
  labs(
    title = "Ridgeline Plot",
    x = "Value", y = "Features"
  ) +
  
  theme_bw() +
  theme(
    plot.title = element_text(hjust = 0.5, size = 12, face = "bold"),
    axis.title = element_text(size = 12),
    axis.text = element_text(size = 10),
    legend.position = "none",
    panel.grid = element_blank(),
    panel.border = element_rect(color = "black", linewidth = 1, fill = NA)
  )

ggsave(
  filename = "ridgeline_plot.pdf",  
  plot = p,                         
  device = "pdf",                  
  width = 8,                        
  height = 4,                    
  dpi = 300                       
)
