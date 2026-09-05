---
name: release-skill
description: Use when the user wants to cut a release — bump version, tag, and publish to GitHub Releases. Triggers on "release", "发版本", "bump version", "cut release", "publish release", "/release", "准备发 rc", "发 rc", "tag and release", 或用户做完一批功能说"准备发 vX.Y.Z"。
---

# Release — 发版本工作流

半自动发版本：定版本 → bump → tag → GitHub Release。按仓库类型分流。

## 第 0 步：场景判定（看 push 权限，不看仓库归属）

一句话判据：`git remote -v` 看 origin 是「权威仓库」还是「你的 fork」。

| origin 是 | 你的角色 | 场景 |
|-----------|---------|------|
| **权威仓库**（你能 push，别人从这拉） | Owner / Maintainer | A. 直推 |
| 你的 fork（权威在 upstream） | Contributor | B. fork-PR |

> 有 push 权限 → A；无 → B。默认 A。同一个人对不同 repo 角色不同，每次按判据现判。

## 通用准备

- `gh` CLI 已登录；工作区干净
- 版本号在 `pyproject.toml`（`[project] version = "X.Y.Z"`）；有包 `__init__.py` 的 `__version__` 要同步——monorepo 可能只有 pyproject、无 `__init__`，跳过即可
- **monorepo 有插件**（`plugins/*/.claude-plugin/plugin.json`）：bump 根版本时顺带查各插件 version 是否与各自 README changelog 同步（失配例子：code-security-skills 曾 plugin.json 1.3.1 vs changelog 1.4.0），见 VERSIONING.md
- 默认分支用 `git rev-parse --abbrev-ref HEAD` 判（master / main 皆可，别硬编码）

## 场景 A：自有仓库直推（默认）

1. **定版本**：读 `pyproject.toml` 当前版本 + `git tag --list` 看上次 tag；按 commit 增量建议
   - Patch（X.Y.Z+1）：bug 修复 / 安全补丁 / 小文档
   - Minor（X.Y+1.0）：新特性 / 无破坏重构
   - Major（X+1.0.0）：破坏性变更（0.x 少见）
   - RC 后缀（v0.2.0-rc9）：可去 RC（v0.3.0）或加 RC 号（v0.2.0-rc10）
2. **bump**：改 `pyproject.toml`（+ 有 `__init__` 则同步）；版本已对就跳过。monorepo 时顺带查各插件 `plugin.json` version 是否 stale（改了哪个插件的 skills 就 bump 哪个）
3. **tag + release**：
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z — 一句话主题" --notes-file notes.md
   ```
   - notes 用 `git log <last-tag>..HEAD --oneline` 汇总，按主题分组（核心重构 / 打包 / 特性 / 文档）

## 场景 B：上游贡献（fork-PR-CI 完整流程）

1. **定版本**：同上（读 pyproject + `__init__`，问用户，建议增量）
2. **bump**：改两处 → `git commit -m "chore: bump version to X.Y.Z"`
3. **release PR**：
   ```bash
   git checkout -b release/vX.Y.Z
   git push fork release/vX.Y.Z -u
   git checkout <default-branch> && git reset --hard origin/<default-branch>
   gh pr create --title "chore: bump version to X.Y.Z" --base <default-branch> --head <fork-owner>:release/vX.Y.Z --body "..."
   ```
   - PR body 含 "Changes since <last-tag>"，逐条列 merged PR
4. **CI**：`gh pr checks <pr>`；失败不 merge，先修
5. **merge + tag**：
   ```bash
   gh pr merge <pr> --merge --delete-branch
   git pull origin <default-branch>
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
6. **GitHub Release**：`gh release create vX.Y.Z --title ... --notes-file notes.md`（非 RC 写全面 notes，RC/patch 只列上次 tag 后的 PR）
7. **README 版本**：更新版本 badge（`当前版本：**vX.Y.Z**`），docs-only 直接推
8. **cleanup**：`git branch -d release/vX.Y.Z`

## Edge cases

- 工作区不干净：警告用户，release 应从未提交状态出
- CI 超时（>10min）：手动查 run URL
- tag 已存在：多半要下一个 RC 号或 patch
- release PR 冲突：rebase 到最新默认分支
- 多包仓库：问清 bump 哪个包

## 自进化日志

| 日期 | 学习来源 | 吸收的模式 |
|------|---------|-----------|
| 2026-08-13 | claude-useful-skills v1.1.0 发版 dogfooding | 加场景 A 自有仓库直推（无 fork/CI 走 bump→tag→release，别硬套 fork-PR）；默认分支自动判（master≠main）；monorepo 可能无 `__init__.py`，版本只在 pyproject；补场景判定表 + 中文 + 自进化日志，对齐科研骨架 skill 规范 |
| 2026-08-13 | 角色化梳理（owner/maintainer/contributor） | 场景判定从「仓库归属」改为「push 权限」：origin 是权威仓库（owner/maintainer）→ A 直推；origin 是 fork（contributor）→ B fork-PR。与 pr-skill 共用同一判据 |
