---
name: paper-writing
description: 论文写作一条龙——venue 定模板 → latex_build 初始化 → 模块化写作 → 编译页数检查 → review 评审。Use when 写论文/投稿/开新论文/写实习报告/毕设。触发词含"写论文"、"paper writing"、"投稿"、"新论文"、"开一个报告"、"写作一条龙"
---

# Paper Writing — 论文写作一条龙

科研骨架的写作编排层（PDF 侧）。把 LaTeX 模板库 + 编译脚本 + 制图 + 评审串成一条龙。Office 侧（Word/PPT）走 office-tools，本 skill 管 PDF。

## 场景判定（先定文档类型，再选路线）

| 场景 | 触发 | 模板 | 引擎 | 页数规则 |
|------|------|------|------|---------|
| **A. 会议投稿** | 写论文/投稿（DAC/ICCAD/ICML/NeurIPS） | `ieee-conf` / `icml` / `neurips` | pdflatex | ML 正文≤8（References 前）/ IEEE 全算≤6 |
| **B. 学位论文** | 毕设/硕博 | `sjtuthesis`（--src 指向 clone） | xelatex | 整本 |
| **C. 报告** | 实习/PRP 中期/课程报告 | `sjtureport` | xelatex | 短 |
| **D. Office 快速** | Word/PPT 课程作业 | pandoc（office-tools） | — | — |

## 场景 A 主流程（ARIS 模式，模块化写作）

1. **定 venue → 模板**：`latex-build list`。ICML/NeurIPS 先下载当年官方 `.sty` 放模板目录（每年更新，不 vendoring）
2. **初始化项目**：`latex-build new --template ieee-conf --dir 项目名`
3. **模块化写作**（长文关键，防 context 爆）：
   - `main.tex` = venue 模板 + title/abstract + `\input{sections/...}`
   - `sections/` 每节一个文件，数字前缀排序：`00-intro.tex` `10-method.tex` `20-experiments.tex` `30-conclusion.tex`
   - 一节一子任务：写完 `\input` 组合进 main，Agent 逐节推进不整篇塞一个 context
4. **图**：对外结构化图 → diagram-design skill（SVG 直进 LaTeX，矢量无损）；需要 draw.io 可编辑 → figure-drawing → 导出 PDF 进 `figures/`
5. **编译**：`latex-build build --dir 项目名 --engine pdflatex`（latexmk 多遍，自动跑 biber）
6. **页数检查**：`latex-build build --dir 项目名 --pages --main-body`（ML：References 前≤8）
7. **评审**：`review ...`（ARIS 对抗评审，语义正确性）→ 修订 → 重编译

## 其他场景

- **B 学位论文**：`latex-build new --template sjtuthesis --dir 论文 --src <SJTUThesis-path>`；盲审版 `\documentclass[review=true]`；章节在 `contents/` 分文件
- **C 报告**：`new --template sjtureport`；中文正文 + biblatex biber gb7714-2015 参考文献（UTF-8 中文无痛）
- **D Office**：`office-tools md2docx/md2pptx`（公式→OMML 原生方程）；模板 `bin/templates/reference.docx`

## 关键约定

- **交付物 = `main.pdf`**；源文件进 git，编译产物不进（main.pdf + aux/log 忽略）
- **参考文献**：`refs.bib` 统一管理；中文 `gb7714-2015` / IEEE `IEEEtran.bst` / ML 官方 `.bst`
- **公式**：LaTeX 原生；md 迁移走 pandoc 转 Word OMML（Office 侧），两路独立
- **图**：矢量优先（SVG/PDF 进 LaTeX），PNG 仅栅格图（实验截图等）
- **长文模块化**：一节一文件 + `\input` 组合；短文（报告）单文件即可
- **盲审**：投稿前 `review=true` 编译一版，确认作者/致谢已去

## 工具

| 工具 | 位置 | 用途 |
|------|------|------|
| `latex_build.py` | `bin/` | 模板 new / latexmk build / 页数检查 |
| `latex-templates/` | 仓库根 | 模板库（sjtureport/sjtuthesis/ieee-conf/icml/neurips） |
| `office_tools.py` | `bin/` | Office 侧 md→docx/pptx（pandoc） |
| `review.py` | `bin/` | ARIS 对抗评审 |
| diagram-design / figure-drawing | skills | 制图 |

## 自进化日志

| 日期 | 学习来源 | 吸收的模式 |
|------|---------|-----------|
| 2026-08-11 | ARIS paper-write/paper-compile + 调研 | venue 模板库（TARGET_VENUE）+ 模块化 sections + latexmk 页数检查（ML 正文 vs IEEE 全算）；场景判定分流 PDF/Office 两条路；ICML/NeurIPS 官方 .sty 每年更新不 vendoring |
