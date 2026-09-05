# codex-image2 MCP Bridge

Experimental bridge that lets **Claude Code** ask the local **Codex desktop app**
to generate an image through Codex's native app-server image-generation path.

This bridge is intentionally narrow:

- it accepts **text prompts**
- it waits for a native `imageGeneration` event from Codex
- it rejects runs that fall back to shell/Python-based image creation
- it copies the generated image only into `cwd/figures/ai_generated/`

## Requirements

- Codex desktop app installed and signed in
- `codex` CLI available on `PATH`
- `codex debug app-server send-message-v2 "ping"` works on your machine

## Install for Claude Code

```bash
mkdir -p ~/.claude/mcp-servers/codex-image2
cp mcp-servers/codex-image2/server.py ~/.claude/mcp-servers/codex-image2/server.py
chmod +x ~/.claude/mcp-servers/codex-image2/server.py

claude mcp add codex-image2 -s user -- python3 ~/.claude/mcp-servers/codex-image2/server.py
```

## Exposed Tools

- `generate_start`
- `generate_status`

The bridge is intentionally **async-first**. Call `generate_start`, then poll
`generate_status`.

## Smoke Test

After registering the server in Claude Code, ask Claude to call:

```text
mcp__codex-image2__generate_start
```

with a prompt like:

```text
Generate a clean blue circle on white background.
```

Then poll `mcp__codex-image2__generate_status` until `done=true`.

`outputPath` must stay under `figures/ai_generated/` inside the provided `cwd`.
The server rejects writes outside that workspace root.

## Current Limitations

- The bridge uses the current Codex app-server path and is **experimental**
- It is optimized for **one-shot generation** rather than conversational thread replay
- Reference images are passed as path hints in the prompt; if Codex exposes local image viewing in that session, it may inspect them

## Logging

- Debug logging is opt-in via `CODEX_IMAGE2_DEBUG_LOG=/path/to/debug.log`
- Raw Codex stdout/stderr run logs are off by default; enable only when needed with `CODEX_IMAGE2_SAVE_RUN_LOGS=1`
