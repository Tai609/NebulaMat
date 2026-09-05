# Claude Review MCP

Bridge Codex-first ARIS workflows to the local Claude Code CLI.

## What it does

- Keeps **Codex** as the executor
- Uses **Claude Code CLI** as the external reviewer
- Exposes synchronous MCP tools:
  - `review`
  - `review_reply`
- Exposes asynchronous MCP tools for long reviewer prompts:
  - `review_start`
  - `review_reply_start`
  - `review_status`

The synchronous tools return a JSON string containing `threadId` and `response`.
The asynchronous start tools return a JSON string containing `jobId` and `status`, and `review_status` later returns the final `threadId` and `response`.

## Install into Codex

```bash
mkdir -p ~/.codex/mcp-servers/claude-review
cp mcp-servers/claude-review/server.py ~/.codex/mcp-servers/claude-review/server.py
codex mcp add claude-review -- python3 ~/.codex/mcp-servers/claude-review/server.py
```

If your Claude Code login depends on a shell function such as `claude-aws`, use the wrapper instead:

```bash
mkdir -p ~/.codex/mcp-servers/claude-review
cp mcp-servers/claude-review/server.py ~/.codex/mcp-servers/claude-review/server.py
cp mcp-servers/claude-review/run_with_claude_aws.sh ~/.codex/mcp-servers/claude-review/run_with_claude_aws.sh
chmod +x ~/.codex/mcp-servers/claude-review/run_with_claude_aws.sh
codex mcp add claude-review -- ~/.codex/mcp-servers/claude-review/run_with_claude_aws.sh
```

## Environment Variables

- `CLAUDE_BIN`: Claude CLI path, defaults to `claude`
- `CLAUDE_REVIEW_MODEL`: optional reviewer model override
- `CLAUDE_REVIEW_SYSTEM`: optional default system prompt
- `CLAUDE_REVIEW_TOOLS`: Claude tools override, defaults to empty string
- `CLAUDE_REVIEW_TIMEOUT_SEC`: subprocess timeout, defaults to `600`

## Notes

- The bridge runs Claude in non-interactive `-p` mode.
- By default the reviewer gets **no tools**. This matches the original ARIS pattern where the external reviewer only sees the prompt context prepared by the executor.
- `threadId` is the native Claude session id and can be passed directly to `review_reply`.
- `jobId` is a bridge-local background task id stored on disk under `~/.codex/state/claude-review/jobs/` by default, so status can be resumed across MCP server restarts.

## When to use sync vs async

- Use `review` / `review_reply` for short prompts that comfortably finish within the host MCP tool timeout.
- Use `review_start` / `review_reply_start` + `review_status` for long paper or project reviews. This avoids the observed `Codex -> tools/call` timeout around 120 seconds.

## Async flow

Start a long review:

```json
{
  "name": "review_start",
  "arguments": {
    "prompt": "Review this paper draft..."
  }
}
```

Example response:

```json
{
  "jobId": "5d8d0a9c5a2f4f42ae44f6f0c2d73f6f",
  "status": "queued",
  "done": false
}
```

Poll later:

```json
{
  "name": "review_status",
  "arguments": {
    "jobId": "5d8d0a9c5a2f4f42ae44f6f0c2d73f6f",
    "waitSeconds": 20
  }
}
```

When complete, `review_status` returns the same reviewer payload fields as the synchronous tools, including `threadId`, `response`, `model`, and `stop_reason`.
