#环境数据处理
library(data.table)
library(ggplot2)

# 加载数据集
X <- read.csv("real_value.csv")
Y <- read.csv("pred_value.csv")
df <- cbind(X,Y)
colnames(df) <- c("X","Y")

p1 <- ggplot(df,aes(x = X, y = Y))+
  stat_density_2d(aes(fill = ..level..),geom = "polygon", colour = "black")+
  scale_fill_distiller(palette = "Purples",direction = 1)+
  labs(y = "Predicted values", x = "Observed values (Mg/ha)")+
  theme_classic() +
  theme(panel.border = element_rect(color = "black", fill = NA, linewidth = 0.8))

p2 <- ggplot(df,aes(x = X, y = Y))+
  stat_density_2d(aes(fill = ..level..),geom = "polygon", colour = "black")+
  scale_fill_distiller(palette = "Greens",direction = 1)+
  labs(y = "Predicted values", x = "Observed values (Mg/ha)")+
  theme_classic() +
  theme(panel.border = element_rect(color = "black", fill = NA, linewidth = 0.8))

pdf("Figue2.pdf", width = 6, height = 5)
print(p1)
dev.off()

pdf("Figue2-1.pdf", width = 6, height = 5)
print(p2)
dev.off()
