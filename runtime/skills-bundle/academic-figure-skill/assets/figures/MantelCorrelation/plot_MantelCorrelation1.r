#安装 linkET 包
# install.packages('devtools')
# devtools::install_github('Hy4m/linkET')

# ===================== 1. 清空环境 + 加载必备包 =====================
rm(list = ls())  # 清空环境，避免冲突
library(linkET)   # 核心包（你已成功安装）
library(ggplot2)
library(dplyr)

# ===================== 2. 读取数据 =====================
# 确保你的文件在工作目录下：微生物数据.txt、环境数据.txt
micro <- read.delim('./dataset/微生物数据.txt', row.names = 1)
env <- read.delim('./dataset/环境数据.txt', row.names = 1)

# ===================== 3. 计算 Mantel 相关性 =====================
mantel <- mantel_test(
  spec = micro,
  env = env,
  # 按你的数据分组：物种1-22列，基因23-40列
  spec_select = list(Taxonomy = 1:22, Function = 23:40),
  spec_dist = "euclidean",   # 微生物距离算法
  env_dist = "euclidean",    # 环境因子距离算法
  mantel_fun = "mantel"      # 检验方法
)

# ===================== 4. 对r值和p值分组（用于控制线条粗细/颜色） =====================
mantel <- mantel %>%
  mutate(
    # 相关系数分组
    rd = cut(r, breaks = c(-Inf, 0.25, 0.5, Inf),
             labels = c('<0.25', '0.25-0.5', '>=0.5'), right = FALSE),
    # 显著性p值分组
    pd = cut(p, breaks = c(-Inf, 0.001, 0.01, 0.05, Inf),
             labels = c('<0.001', '0.001-0.01', '0.01-0.05', '>=0.05'), right = FALSE)
  )

# ===================== 5. 绘制 Mantel 相关组合图 =====================
qcorrplot(correlate(env, method = "spearman"),  # 环境因子Spearman相关
          type = "upper", diag = FALSE) +
  
  # 绘制热图方块
  geom_square() +
  
  # 显示相关系数文本
  geom_mark(size = 2.5, sep = "\n") +
  
  # 绘制Mantel相关连线
  geom_couple(
    data = mantel,
    aes(color = pd, size = rd),
    curvature = nice_curvature()
  ) +
  
  # 热图配色
  scale_fill_gradientn(
    colors = c('#053061', '#68A8CF', 'white', '#F7B394', '#67001F'),
    limits = c(-1, 1)
  ) +
  
  # 连线粗细
  scale_size_manual(values = c(0.1, 0.5, 1)) +
  
  # 连线颜色（4组p值对应4个颜色）
  scale_color_manual(
    values = c('#56B4E9', '#E69F00', '#999999', "gray80")
  ) +
  
  # 图例设置
  guides(
    color = guide_legend(title = "Mantel's p", order = 1),
    size = guide_legend(title = "Mantel's r", order = 2),
    fill = guide_colorbar(title = "Spearman's r", order = 3)
  ) +
  
  # 主题美化
  theme(
    legend.key = element_blank(),
    axis.text = element_text(size = 9)
  )


