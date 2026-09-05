# 加载包
library(linkET)
library(RColorBrewer)
library(tidyverse)
library(ggnewscale)

# 加载你的数据
varespec <- read.csv('./dataset/varespec.csv')
varechem <- read.csv('./dataset/varechem.csv')

mantel <- mantel_test(varespec, varechem,
                      spec_select = list(
                        `Taxonomic\ncomposition\n(16S OTUs)` = 1:18,
                        `Gene\nfunctional\ncomposition` = 19:32,
                        `Taxonomic\ncomposition\n(mOTUs)` = 33:44
                      )) %>%
  mutate(rd = cut(r, breaks = c(-Inf, 0.2, 0.3, Inf),
                  labels = c("< 0.2", "0.2 - 0.3", ">= 0.3")),
         pd = cut(p, breaks = c(-Inf, 0.005, 0.01, 0.05, Inf),
                  labels = c("< 0.005", "0.005 - 0.01", "0.01 - 0.05", ">= 0.05")))


p1 <- qcorrplot(correlate(varechem), 
                grid_col = "grey50",
                grid_size = 0.5,
                type = "lower", 
                diag = FALSE) +
  geom_square() +
  geom_mark(size = 4,
            only_mark = T,
            sig_level = c(0.05, 0.01, 0.001),
            sig_thres = 0.05,
            colour = 'white') +
  geom_couple(data = mantel,
              aes(color = pd, size = rd),  
              label.size = 3.88,
              label.family = "",
              label.fontface = 1,
              nudge_x = 0.2,
              curvature = nice_curvature(by = "from"),
              point_fill = "white",
              point_color = "gray50") +    

scale_fill_gradient2(
  limits = c(-0.8, 0.8),
  mid = "white",
  low = "#2a7bbb",    
  high = "#e67e22", 
  breaks = seq(-0.8, 0.8, 0.4)
) +
  scale_size_manual(values = c(0.5, 1.5, 3)) +
  # 连线配色也同步换成柔和期刊色
  scale_color_manual(values = c("#2d5d7a","#5a90b3","#f39c12","#cccccc")) +  
  guides(size = guide_legend(title = "Mantel's r",                               
                             order = 2,                               
                             keyheight = unit(0.5, "cm")),           
         colour = guide_legend(title = "Mantel's p",                                  
                               order = 1,                                 
                               keyheight = unit(0.5, "cm")),           
         fill = guide_colorbar(title = "Pearson's r", 
                               keyheight = unit(2.2, "cm"),
                               keywidth = unit(0.5, "cm"),
                               order = 3)) + 
  theme(legend.box.spacing = unit(0, "pt"))

ggsave(p1, file = "figure1.pdf", width = 8.8, height = 6, dpi = 300)
p1