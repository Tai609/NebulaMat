# Academic Figure Skill — Claude Code Installation

The Claude Code skill is at `academic-figure-skill/`. Install via symlink:

```bash
ln -s $(pwd)/academic-figure-skill ~/.claude/skills/academic-figure-skill
```

Or copy:
```bash
cp -r academic-figure-skill ~/.claude/skills/academic-figure-skill
```

After installation, Claude Code auto-triggers on: "make a volcano plot", "画个热图",
"review this figure for Nature", etc.

The skill checks `academic-figure-skill/assets/figures/<type>/` for production scripts before
generating any code. Add your own scripts there to extend figure type coverage.

Generated: 2026-07-05 13:39 UTC
