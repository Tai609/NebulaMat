---
name: pr-skill
description: Use when the user wants to open a PR, submit changes for review, or push a branch to their fork (fork workflow). Triggers on "create PR", "open PR", "submit PR", "提 PR", "开 PR", "/pr", 或用户做完一批改动想合入上游。
---

# PR — 提 Pull Request 工作流

fork 工作流提 PR。用于「无上游 push 权限」或「有权限但想走评审」的场景。

## 何时用 / 何时不用（看 push 权限）

判据同 release-skill：`git remote -v` 看 origin 是「权威仓库」还是「你的 fork」。

| 角色 | 要不要用 pr-skill |
|------|------------------|
| Owner（origin 即你的主仓库） | ❌ 不需要——直接 push，不用 PR |
| Maintainer（团队 repo 写权限） | 可选——想走评审才用 |
| Contributor（只有 fork） | ✅ 必须——fork-PR 是唯一路径 |

## Prerequisites

- `gh` CLI 已登录
- remotes：`origin` = upstream（权威）、`fork` = 你的 fork
- 工作区干净（先 commit）
- 默认分支用 `git rev-parse --abbrev-ref HEAD` 判（master / main 皆可，别硬编码）

## 步骤

1. **定分支名**：问用户，或从 commit 主题推（如 `fix/feishu-deadlock`、`feat/aihot-push`）
2. **建分支 + 推到 fork**：
   ```bash
   git checkout -b <branch>
   git push fork <branch> -u
   ```
3. **重置默认分支到 origin**（工作留在 feature 分支，本地默认分支保持干净）：
   ```bash
   git checkout <default-branch>
   git reset --hard origin/<default-branch>
   ```
4. **取 fork owner**：`git remote get-url fork` 拼 `--head`
5. **建 PR**：
   ```bash
   gh pr create --title "<conventional-commit>" --base <default-branch> --head <fork-owner>:<branch> --body "..."
   ```
   - title 用 conventional commit（`fix:` / `feat:` / `refactor:` / `chore:` / `docs:`）
   - body 1-2 段说明改了什么、为什么；多文件改动加 "What changed" 节
6. **报 PR URL** 给用户

## Edge cases

- 工作区不干净：先 commit 或 stash
- 分支已在 fork 存在：force-push 或换名
- gh 未登录：`gh auth login`
- 多 remote：确认 origin/fork 配置正确再推

## 自进化日志

| 日期 | 学习来源 | 吸收的模式 |
|------|---------|-----------|
| 2026-08-13 | 角色化梳理（owner/maintainer/contributor） | 加「何时用」判据：owner 直接 push 不需要 PR，只有 contributor（或走评审的 maintainer）才用；与 release-skill 共用「push 权限」判据；默认分支自动判；中文化 + 场景表 + 自进化日志对齐科研骨架规范 |
