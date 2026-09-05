# Matplotlib / Seaborn 发表级图表规范

适用于:散点图(如 PR 曲线、相关性散点)、箱线图、条形图、折线图等。

## 基础设置(每次绘图前建议先设置)

```python
import matplotlib.pyplot as plt
import matplotlib as mpl

mpl.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica"],
    "font.size": 7,           # 印刷尺寸下的基础字号
    "axes.linewidth": 0.6,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "xtick.direction": "out",
    "ytick.direction": "out",
    "xtick.major.width": 0.6,
    "ytick.major.width": 0.6,
    "svg.fonttype": "none",   # 导出SVG时保留可编辑文本，而非转成路径
    "pdf.fonttype": 42,       # TrueType嵌入，避免PDF中字体变成图形
})
```

## 图幅尺寸(按最终印刷尺寸设置，而不是画完再缩放)

```python
mm_to_inch = 1 / 25.4
fig, ax = plt.subplots(figsize=(89 * mm_to_inch, 70 * mm_to_inch))  # 单栏示例
```

单栏用 89mm 宽，双栏用 183mm 宽；高度按图表内容和期刊图注留白酌情设置，一般不超过 100-120mm（除非是多面板大图）。

## 导出

```python
fig.savefig("figure.pdf", bbox_inches="tight", dpi=300)   # 矢量主图，投稿用
fig.savefig("figure.png", bbox_inches="tight", dpi=300)   # 位图预览，聊天/汇报用
```

线图、散点图、箱线图等矢量元素优先用 PDF；如果图中包含大量数据点（如单细胞散点图 >10万点），可考虑 PDF 中栅格化数据层以控制文件体积：

```python
ax.scatter(x, y, s=2, rasterized=True)  # 数据点栅格化，坐标轴/文字仍是矢量
```

## 常见陷阱

- **默认色板**：避免直接用 `plt.cm.tab10`、seaborn 默认 `deep` 色板；改用 `references/color-palettes.md` 中的配色，或显式传入 hex 色值列表
- **图例遮挡数据**：优先 `ax.legend(bbox_to_anchor=(1.02, 1), loc="upper left")` 移到图外，或对关键类别用 `ax.annotate` 直接标注
- **DejaVu Sans 字体**：matplotlib 默认字体在印刷稿中显得不专业，务必显式指定 Arial/Helvetica（如系统无 Arial，可用 `Liberation Sans` 作为跨平台替代，视觉效果接近）
- **PR/ROC 曲线对角线参考线**：用浅灰虚线 (`color="grey", linestyle="--", linewidth=0.5, alpha=0.5"`)，避免喧宾夺主
- **误差棒/置信区间**：优先用阴影带（`fill_between`, alpha=0.15-0.25）而非密集的 errorbar，视觉更干净

## 多面板图（Figure 1/2 常见形式）

用 `plt.subplots` 或 `gridspec` 统一控制面板间距，并在左上角加面板标注（a, b, c...），字号比正文略大且加粗：

```python
for label, ax in zip("abcdefg", axes.flat):
    ax.text(-0.15, 1.05, label, transform=ax.transAxes,
            fontsize=9, fontweight="bold", va="top")
```
