---
name: issue-skill
description: Use when the user wants to create an issue, triage issues, close or resolve issues, or turn an issue into a PR on GitHub. Triggers on "提 issue", "报 bug", "提 feature request", "开 issue", "/issue", "看 issue", "分诊", "处理 issue", "关 issue", "修这个 issue", "issue 转 PR".
---

# Issue — GitHub Issue 工作流

issue 是**角色无关**的（谁都能提），但「分诊/关闭」是 maintainer 专属。

## 场景判定

| 场景 | 触发 | 谁 | 动作 |
|------|------|----|----|
| A. 提 issue | "报 bug"/"提 feature" | 任何人 | `gh issue create`（按模板写清） |
| B. 分诊 | "看 issue"/"打标签"/"指派" | Maintainer / Owner | `gh issue list` + `edit --add-label/--add-assignee` |
| C. 处理闭环 | "处理 issue #N"/"关掉" | Maintainer / Owner | `gh issue comment` / `close` |
| D. issue→PR | "修这个 issue" | 有 push 或 fork | 建分支 → 改 → PR 引用 `fixes #N` |

## 场景 A：提 issue

1. `gh issue create --title "..." --body "..."`（或交互式 `gh issue create`）
2. body 模板：
   - bug：复现步骤 / 期望 vs 实际 / 环境版本
   - feature：动机 / 建议方案 / 可选替代
3. 报 issue URL

## 场景 B：分诊

```bash
gh issue list --state open --label "help wanted"
gh issue edit <N> --add-label "bug" --add-assignee @me
```

## 场景 C：处理闭环

```bash
gh issue comment <N> --body "..."
gh issue close <N> --reason completed   # 或 not-planned
```

## 场景 D：issue → PR 闭环

1. `gh issue develop <N>`（自动建分支 + checkout，需 gh 较新版本；不支持则手建 `fix/<N>-...`）
2. 改代码 → commit
3. PR 标题/正文引用 `fixes #N`（合并自动关 issue）
4. 提 PR 走 pr-skill（角色判据：owner 直推 / contributor fork）

## 自进化日志

| 日期 | 学习来源 | 吸收的模式 |
|------|---------|-----------|
| 2026-08-13 | 协作流梳理（pr/release 之后补 issue） | issue 角色无关（谁都能提），但 B/C 分诊处理是 maintainer 专属；D 闭环复用 pr-skill 的 push 权限判据；`fixes #N` 让 PR 合并自动关 issue |
