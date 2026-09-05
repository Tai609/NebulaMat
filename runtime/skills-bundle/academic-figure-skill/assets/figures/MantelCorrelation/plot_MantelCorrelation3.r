# 加载包
library(linkET)
library(vegan)
library(RColorBrewer)
library(tidyverse)
library(ggnewscale)

# 数据
varespec <- read.csv('./dataset/varespec.csv')
varechem <- read.csv('./dataset/varechem.csv')

# 计算 Mantel 检验
mantel <- mantel_test(varespec, varechem,
                      spec_select = list(
                        `Taxonomic\ncomposition\n(16S OTUs)` = 1:18,
                        `Gene\nfunctional\ncomposition` = 19:32,
                        `Taxonomic\ncomposition\n(mOTUs)` = 33:44
                      )) %>%
  mutate(
    rd = cut(r, breaks = c(-Inf, 0.2, 0.3, Inf),
             labels = c("< 0.2", "0.2 - 0.3", ">= 0.3")),
    pd = cut(p, breaks = c(-Inf, 0.005, 0.01, 0.05, Inf),
             labels = c("< 0.005", "0.005 - 0.01", "0.01 - 0.05", ">= 0.05"))
  )

# 固定环境因子顺序
env_ordered <- varechem %>% select(all_of(colnames(varechem)))

p2 <- qcorrplot(correlate(env_ordered, method = "pearson"),
                type = "lower",    # 左下角气泡热图
                diag = FALSE,
                grid_col = NA) +
  
  # 1. 气泡底层圈
  geom_point(shape = 21, size = 8, fill = NA, stroke = 0.35, color = "black") +
  
  # 2. 气泡颜色 + 大小
  geom_point(aes(size = abs(r), fill = r), 
             shape = 21, stroke = 0.35, color = "gray50") +
  
  # 显著性星号
  geom_mark(
    size = 4.5,          
    colour = "white",    
    sig_level = c(0.05, 0.01, 0.001), 
    sig_thres = 0.05,               
    only_mark = TRUE               
  ) +
  
  scale_size(range = c(1, 8), guide = "none") +
  new_scale("size") +
  
  # Mantel 连线（灰色空心圆点）
  geom_couple(
    data = mantel,
    aes(color = pd, size = rd),
    curvature = nice_curvature(by = "from"),
    nudge_x = 0.1,
    point_fill = "white",    # 空心
    point_color = "gray50"   # 灰色圆圈
  ) +
  
  # ===================== 【替换：Science 蓝白橙配色】=====================
scale_fill_gradient2(
  limits = c(-1,1),
  mid = "white",
  low = "#2a7bbb",    # 高级冷蓝
  high = "#e67e22",   # 暖橙色
  breaks = seq(-1,1,0.5)
) +
  
  # 连线颜色同步更换
  scale_size_manual(values = c(0.5,1.5,3)) +
  scale_color_manual(values = c("#2d5d7a","#5a90b3","#f39c12","#cccccc")) +
  
  # 图例
  guides(
    size = guide_legend(title="Mantel's r", order=2, keyheight=unit(0.5,"cm")),
    colour = guide_legend(title="Mantel's p", order=1, keyheight=unit(0.5,"cm")),
    fill = guide_colorbar(title="Pearson's r", keyheight=unit(2.2,"cm"), keywidth=unit(0.5,"cm"), order=3)
  ) +
  
  theme_minimal() +
  theme(
    panel.grid = element_blank(),
    legend.box.spacing = unit(0,"pt"),
    legend.position = "right",
    axis.title = element_blank(),
    
    # X 轴：竖直 + 底部对齐
    axis.text.x = element_text(
      angle = 90,
      hjust = 1,
      vjust = 0.5,
      size = 10,
      color = "black"
    ),
    axis.text.y = element_text(size=10, color="black"),
    
    plot.margin = margin(t=20, r=20, b=20, l=20)
  )

print(p2)

# 保存PDF
ggsave(p2, file="figure2.pdf", width=12, height=8, dpi=300)