#环境数据处理
library(data.table)
library(ggplot2)

# 加载数据集
X <- read.csv("real_value.csv")
Y <- read.csv("pred_value.csv")
df <- cbind(X,Y)
colnames(df) <- c("X","Y")

# 统计指标
n <- nrow(df)
rmse <- sqrt(mean((df$Y - df$X)^2, na.rm = TRUE))
pcc <- cor(df$X, df$Y, use = "complete.obs", method = "pearson")
fit <- lm(Y ~ X, data = df)

fit_intercept <- coef(fit)[1]
fit_slope <- coef(fit)[2]
fit_label <- sprintf("Y = %.3f + %.3fX", fit_intercept, fit_slope)
stat_label <- sprintf("n = %d\nRMSE = %.3f\nPCC = %.3f\n%s", n, rmse, pcc, fit_label)

p1 <- ggplot(df, aes(x = X, y = Y)) +
  stat_density_2d(aes(fill = after_stat(level)), geom = "polygon", colour = "black") +
  geom_smooth(method = "lm", se = TRUE, color = "#62439c", fill = "#b4b4d6", alpha = 0.25, linewidth = 0.8) +
  annotate("text", x = -Inf, y = Inf, label = stat_label, hjust = -0.1, vjust = 1.1, size = 4, family = "sans") +
  scale_fill_distiller(palette = "Purples", direction = 1) +
  labs(y = "Predicted values", x = "Observed values (Mg/ha)") +
  theme_classic() +
  theme(panel.border = element_rect(color = "black", fill = NA, linewidth = 0.8))

p2 <- ggplot(df, aes(x = X, y = Y)) +
  stat_density_2d(aes(fill = after_stat(level)), geom = "polygon", colour = "black") +
  geom_smooth(method = "lm", se = TRUE, color = "#1b7d40", fill = "#95d392", alpha = 0.25, linewidth = 0.8) +
  annotate("text", x = -Inf, y = Inf, label = stat_label, hjust = -0.1, vjust = 1.1, size = 4, family = "sans") +
  scale_fill_distiller(palette = "Greens", direction = 1) +
  labs(y = "Predicted values", x = "Observed values (Mg/ha)") +
  theme_classic() +
  theme(panel.border = element_rect(color = "black", fill = NA, linewidth = 0.8))

pdf("Figure3.pdf", width = 6, height = 5)
print(p1)
dev.off()

pdf("Figure3-1.pdf", width = 6, height = 5)
print(p2)
dev.off()
