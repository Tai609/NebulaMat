---
name: office-tools
description: Use when 需要处理 WPS/Office/PDF 文件——"Excel 数据处理"、"转成 Excel"、"提取 PDF 里的图"、"markdown 转 xlsx/docx/pptx"。触发词含 xlsx/docx/pptx/Excel/表格/配图。
---

# Office Tools — Office/PDF 文件处理

科研骨架的 Office 模块。Excel 数据处理 + markdown↔Office 转换 + **PDF/Office 提图给 vision 读**。

## 场景判定

| 场景 | 触发 | 命令 |
|------|------|------|
| Excel 数据处理 | 实验数据/表格分析 | `read` / `stats` |
| markdown 表 → Excel | 阅读报告/防撞车矩阵转 xlsx 分析 | `md2xlsx` |
| Excel → markdown | xlsx 回写笔记 | `xlsx2md` |
| CSV → Excel | 实验数据导入 | `csv2xlsx` |
| **PDF/Office 提图** | 论文配图、报告插图 | **`source` 优先**（arXiv 源码包作者原图）→ `extract` 回退 → vision.py |
| markdown → Word | 课程作业/报告转 docx | `md2docx`（pandoc） |
| markdown → PPT | 课程汇报/讲稿转 pptx | `md2pptx`（pandoc） |

## 写作：markdown → Word/PPT（pandoc）

```
office-tools md2docx 笔记.md 报告.docx [--toc] [--reference-doc bin/templates/reference.docx]
office-tools md2pptx 讲稿.md 汇报.pptx [--slide-level 2] [--reference-doc 模板.pptx]
```

- **LLM 写 markdown（天然输出）→ pandoc 转 Office**，薄封装在 office_tools（pandoc 全部能力自然继承：公式/引用/双栏/备注）
- **LaTeX 公式($..$) → Word/PPT 原生 OMML 方程**（可编辑，实测 docx+pptx 都出）；这是选 pandoc 而非其他路线的关键
- **中文字体**：docx 用 `--reference-doc bin/templates/reference.docx`（已预设宋体正文/黑体标题/1.5倍距/首行缩进2字符）
- **pptx 结构**：`#`=分节标题页、`##`=一页，输出原生文本框（可编辑，非图片）；公式同样 OMML
- 重新生成默认模板：`pandoc -o reference.docx --print-default-data-file reference.docx` → `style-reference-docx`；模板可在 WPS/Word 手动微调后保存即生效

## 关键能力：看图（模型无视觉，靠 vision 代理）

**模型不能直接看 Office/PDF 里的图**——正确链路：

```
office_tools extract pdf 论文.pdf --outdir 图/
  → vision.py 图/p7_img957.png "这是什么图？"
  → 模型通过 vision 描述理解图
```

- PDF：默认提取嵌入图；`--pages 1,3` 渲染整页为 PNG
- docx/pptx：提取内嵌图片
- 依赖 `vision.py`（Qwen3-VL-32B，SiliconFlow）——读图的文字/结构说明走它，模型本身无视觉

### 拿论文原图：源码包优先（存在 LaTeX 源码版就直接拿）

多数 arXiv 论文有 LaTeX 源码包——**需要论文原图时首选它**，作者亲手画的原图无碎片/无渲染损耗、矢量保持矢量：

```
python papers/arxiv_fetch.py source <id> --outdir 笔记/assets/
  # e-print 下载 → 解压 → \includegraphics 反查作者原图 → PDF 转 PNG
```

`extract` 只在无源码包时作回退（区域渲染；`extract_image` 原始字节会拿复合图碎片，已弃用）。

### 两阶段过滤（省 vision 调用）

不是所有图都值得 vision——`extract` 先免费滤装饰图，`classify` 只对幸存图花 vision：

```
extract pdf 论文.pdf --outdir 图/        # 免费层：尺寸/文件大小/页眉页脚 + [CAP]Figure 标题标记
classify 图/                              # vision 层：幸存图分类 价值图/装饰图
```

实测（CircuitFusion）：33 张 → 免费层留 5（滤 29 张照片/装饰条）→ vision 分类 3 价值 + 2 装饰（256×256 图标漏过免费层被 vision 揪出）。**只看论文本身有意义的图**。

## 命令速查

```
office-tools read data.xlsx [--sheet 表1] [--head 10]
office-tools md2xlsx 笔记.md out.xlsx [--table all|0,1]
office-tools xlsx2md data.xlsx [--sheet 表1]
office-tools stats data.xlsx [--col 列名,列名]
office-tools csv2xlsx data.csv out.xlsx
office-tools extract pdf 论文.pdf --outdir 图/ [--pages 1,3]
office-tools extract docx 报告.docx --outdir 图/
office-tools extract pptx 汇报.pptx --outdir 图/
office-tools md2docx 笔记.md 报告.docx [--toc] [--reference-doc 模板.docx]
office-tools md2pptx 讲稿.md 汇报.pptx [--slide-level 2] [--reference-doc 模板.pptx]
```

脚本 `office-tools`（`pip install -e .` 后为 console 命令；也可 `python bin/office_tools.py` 直调）。依赖：openpyxl、pymupdf、python-docx、python-pptx、**pandoc（写作）**。

## 边界

- 提取的嵌入图不含上下文——整页渲染（`--pages`）能看图和正文的相对位置，更可靠
- 提图后记得清理临时图目录（提取的是副本，原文件不动）
- pandoc 装于用户级 AppData（winget 装后 shell PATH 可能未刷新，office_tools 已兜底全路径）
- 设计感/复杂版式 PPT 用 python-pptx 编程兜底（office_tools 目前只包 pandoc 薄封装）
- pptx 公式也是 OMML——python-pptx 读不出方程文本，属库限制非内容丢失

## 自进化日志

| 日期 | 学习来源 | 吸收的模式 |
|------|---------|-----------|
| 2026-08-06 | 需求调研 | Excel 优先；组会读 Obsidian 笔记不做 PPT；Word/PPT/PDF 留给其他课程需要 |
| 2026-08-06 | 提图实现 | PDF 图 → `extract` PNG → `vision.py` 读（CircuitFusion 实测通过）；`bin` junction 缺失已补（skills/bin → repo bin） |
| 2026-08-06 | 图的价值分层 | 两阶段过滤：免费层（尺寸/文件大小/位置/[CAP] Figure 标题邻近）滤 ~88% 装饰图；`classify` 用 vision 二次揪出漏网图标（256×256 火焰/雪花）；只对幸存图花 vision |
| 2026-08-06 | LaTeX 源包拿原图 | **`extract_image` 原始字节会拿复合图碎片**（Code\|Graph 只剩 Graph）——弃用；`extract` 区域渲染作回退；**首选 arXiv 源码包**（`arxiv_fetch.py source`，作者原图无渲染损耗、矢量保持） |
| 2026-08-11 | 写作模块落地 | **Pandoc 路线**（winget 装 3.10.1）；`md2docx`/`md2pptx` 薄封装进 office_tools；**公式 docx/pptx 双出原生 OMML 方程**（实测冒烟）；Marp/Slidev pptx 导出=逐页扁平图片不可编辑→排除；`reference.docx` 预设中文字体（`style_reference_docx.py`：宋体正文/黑体标题/首行缩进2字符/1.5倍距） |
