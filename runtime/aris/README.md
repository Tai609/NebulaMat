# ARIS integration

NebulaMat bundles the pinned ARIS Codex skill mirror as `aris-*` skills. The prefix prevents collisions with first-party, Office, AICC, and user-installed skills.

The generated skills adapt Codex delegation names to DSH and prepend a NebulaMat governance contract. The original text, helper scripts, templates, and optional MCP server sources remain under `upstream/` at commit `014c16e0e58198e4230fafd246b0e6203892422f`. NebulaMat sets `ARIS_REPO` to that read-only resource directory when DSH starts. The separate upstream TTY monitor is intentionally not shipped because NebulaMat already renders durable session and subagent state natively; the ARIS watchdog and run-state helpers are included.

Optional MCP servers are not registered or launched automatically. A user must configure their dependencies, credentials, and provider explicitly; same-family reviews remain provisional. Remote, paid, destructive, or irreversible work continues through NebulaMat approval and provenance controls.

Refresh this directory with `pnpm aris:sync`; validate it without network access with `pnpm aris:check`.
