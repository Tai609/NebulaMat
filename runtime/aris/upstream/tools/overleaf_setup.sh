#!/usr/bin/env bash
# overleaf_setup.sh — One-time Overleaf Git bridge setup.
#
# CRITICAL: this script is meant to be run by the USER directly in their terminal,
# NEVER through an LLM agent. The user types the token into a hidden prompt; the
# script wires it into the OS keychain and immediately strips it from the git
# remote URL so no agent or file ever sees the cleartext token.
#
# Usage:
#   bash tools/overleaf_setup.sh <project-id-or-url> [clone-dir]
#
# Example:
#   bash tools/overleaf_setup.sh https://www.overleaf.com/project/69e478... paper-overleaf

set -euo pipefail

# ── Refuse to run from a non-interactive context (i.e. inside an agent) ────────
if [ ! -t 0 ] || [ ! -t 1 ]; then
    echo "ERROR: overleaf_setup.sh requires an interactive terminal."
    echo "       Do NOT run this through an LLM agent — run it yourself in a terminal."
    echo "       The token must be typed into a hidden prompt, not pasted into chat."
    exit 1
fi

# ── Args ──────────────────────────────────────────────────────────────────────
if [ $# -lt 1 ]; then
    echo "Usage: $0 <project-id-or-url> [clone-dir]"
    echo ""
    echo "  project-id-or-url:  e.g. 'abc123def456' or 'https://www.overleaf.com/project/abc123def456'"
    echo "  clone-dir:          defaults to 'paper-overleaf'"
    exit 1
fi

RAW_INPUT="$1"
CLONE_DIR="${2:-paper-overleaf}"

# Strip URL down to project ID
PROJECT_ID="${RAW_INPUT##*/}"
PROJECT_ID="${PROJECT_ID%%\?*}"
if ! [[ "$PROJECT_ID" =~ ^[a-f0-9]{20,}$ ]]; then
    echo "ERROR: project ID '$PROJECT_ID' does not look like an Overleaf project ID."
    echo "       Expected a hex string of 20+ characters."
    exit 1
fi

if [ -e "$CLONE_DIR" ]; then
    echo "ERROR: '$CLONE_DIR' already exists. Remove it first or choose a different dir."
    exit 1
fi

# ── Read token securely (no echo, never enters shell history) ─────────────────
echo "Setting up Overleaf bridge for project $PROJECT_ID → ./$CLONE_DIR/"
echo ""
echo "Get a token at: https://www.overleaf.com/user/settings → Git Integration → Create Token"
echo ""
read -r -s -p "Paste Overleaf token (input hidden): " OL_TOKEN
echo ""

if [ -z "$OL_TOKEN" ]; then
    echo "ERROR: empty token"
    exit 1
fi
if [[ ! "$OL_TOKEN" =~ ^olp_[A-Za-z0-9]+$ ]]; then
    echo "WARNING: token does not start with 'olp_' — proceeding but verify it's correct."
fi

# ── Clone with token in URL (transient) ───────────────────────────────────────
echo "Cloning…"
if ! git clone "https://git:${OL_TOKEN}@git.overleaf.com/${PROJECT_ID}" "$CLONE_DIR" 2>&1 \
       | sed "s|${OL_TOKEN}|<TOKEN>|g"; then
    unset OL_TOKEN
    echo "ERROR: clone failed"
    exit 1
fi

# ── Immediately strip token from remote URL ───────────────────────────────────
cd "$CLONE_DIR"
git remote set-url origin "https://git.overleaf.com/${PROJECT_ID}"

# ── Configure credential helper ───────────────────────────────────────────────
case "$(uname -s)" in
    Darwin) HELPER=osxkeychain ;;
    Linux)  HELPER=cache       ;;
    MINGW*|MSYS*|CYGWIN*) HELPER=manager ;;
    *)      HELPER=store       ;;
esac
git config --global credential.helper "$HELPER" 2>/dev/null || \
    git config credential.helper "$HELPER"

# ── Prime credential storage so future pull/push is auth-free ─────────────────
git credential approve <<EOF
protocol=https
host=git.overleaf.com
username=git
password=${OL_TOKEN}

EOF

# ── Clear token from memory ───────────────────────────────────────────────────
unset OL_TOKEN

# ── Install hard-block pre-commit hook ────────────────────────────────────────
HOOK_DIR=".git/hooks"
mkdir -p "$HOOK_DIR"
cat > "$HOOK_DIR/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# Auto-installed by overleaf_setup.sh. Refuses to commit anything containing
# what looks like an Overleaf token pattern. Cannot be bypassed by any agent
# without --no-verify (which the ARIS protocol forbids without explicit user OK).
set -e
if git diff --cached | grep -qE 'olp_[A-Za-z0-9]{20,}'; then
    echo "ERROR: Overleaf token pattern (olp_…) detected in staged changes."
    echo "       Refusing to commit. Remove the token before committing."
    echo "       Also revoke it at https://www.overleaf.com/user/settings"
    exit 1
fi
HOOK
chmod +x "$HOOK_DIR/pre-commit"

# ── Verify token was actually stripped from remote ────────────────────────────
if git remote -v | grep -qE 'olp_'; then
    echo ""
    echo "FATAL: token still present in remote URL after strip. Aborting."
    cd .. && rm -rf "$CLONE_DIR"
    exit 1
fi

# ── Set local commit identity (best-effort) ───────────────────────────────────
if [ -z "$(git config user.email 2>/dev/null)" ]; then
    GLOBAL_EMAIL="$(git config --global user.email 2>/dev/null || true)"
    if [ -n "$GLOBAL_EMAIL" ]; then
        git config user.email "$GLOBAL_EMAIL"
    else
        echo "NOTE: no git user.email set. Run:"
        echo "    cd $CLONE_DIR && git config user.email <your-email>"
    fi
fi

# ── Final report ──────────────────────────────────────────────────────────────
cd ..
echo ""
echo "✅ Setup complete."
echo ""
echo "  Clone:        ./$CLONE_DIR/"
echo "  Remote URL:   $(cd "$CLONE_DIR" && git remote get-url origin)   ← no token"
echo "  Credential:   stored in $HELPER"
echo "  Pre-commit:   installed (blocks olp_… patterns)"
echo ""
echo "From here on, agents can run pull/push against $CLONE_DIR/ without seeing a token."
echo "If pull/push ever fails with 401, your token expired — re-run this script."
