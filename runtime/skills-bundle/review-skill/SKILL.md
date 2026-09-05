---
name: review-skill
description: Use when the user wants GitHub PR operations — open, read and comment, approve or request changes, or merge a PR. This is the operational GitHub flow (issue → PR → review → merge), not the general code-review methodology. Triggers on "review 这个 PR", "看下这个 PR", "approve", "要求修改", "request changes", "merge", "合了", "/review".
---

# Review — GitHub PR Review 工作流

评审者动作：看 PR → 评审 → 提交 approve/changes → 合并。与 pr-skill（作者提 PR）相对。

## 角色

本 skill 是「评审者」的 = 有 merge 权限的 maintainer / owner。作者侧走 pr-skill + superpowers 的 requesting/receiving-code-review。

## 场景判定

| 场景 | 触发 | 动作 |
|------|------|------|
| A. 看 PR | "看这个 PR" / "review #N" | `gh pr view` + `gh pr diff` |
| B. 评审代码 | 判断质量 | 委托 `code-review` skill（找 bug + 复用/简化/效率） |
| C. 提交评审 | "approve" / "要求改" / "评论" | `gh pr review --approve/--request-changes/--comment` |
| D. 合并 | "合了" / "merge" | `gh pr merge --merge/--squash/--rebase` |

## 流程

1. **看 PR**：`gh pr view <N>` 读标题/正文/变更文件；`gh pr diff <N>` 读 diff
2. **评代码质量**：委托 `code-review` skill（找 bug + 复用/简化/效率清理）；意见按严重度分
3. **提交评审**：
   ```bash
   gh pr review <N> --approve                        # 通过
   gh pr review <N> --request-changes --body "..."   # 要求改（列具体点，别空泛）
   gh pr review <N> --comment --body "..."           # 仅评论，不表态
   ```
4. **合并**（approve 后）：
   ```bash
   gh pr merge <N> --merge      # 或 --squash / --rebase，按团队规范
   gh pr close <N>              # 不合并就关
   ```

## 自进化日志

| 日期 | 学习来源 | 吸收的模式 |
|------|---------|-----------|
| 2026-08-13 | 协作流梳理（pr/release/issue 之后补 review） | review 是「评审者」的 skill（有 merge 权限），与 pr-skill 作者侧相对；代码质量委托 code-review skill，本 skill 只管 GitHub 机制（approve/changes/merge） |
