#!/usr/bin/env bash
# overleaf_audit.sh — Scan a repo for accidental Overleaf token leaks.
#
# Run this any time you suspect a token may have been written somewhere:
#   bash tools/overleaf_audit.sh [repo-root]
#
# Exits non-zero if any token-pattern leak is found.
# Token pattern: 'olp_' followed by 20+ alphanumerics.

set -o pipefail

ROOT="${1:-.}"
PATTERN='olp_[A-Za-z0-9]{20,}'
FOUND=0

echo "Scanning $ROOT for Overleaf token patterns…"
echo ""

# 1. Working tree (excluding .git/ and node_modules/) ─────────────────────────
echo "[1/4] Working tree files…"
if command -v rg >/dev/null 2>&1; then
    LEAKS=$(rg -n --no-heading -e "$PATTERN" \
                --glob '!**/.git/**' --glob '!**/node_modules/**' \
                --glob '!**/paper-overleaf/.git/**' \
                "$ROOT" 2>/dev/null || true)
else
    LEAKS=$(grep -rEn "$PATTERN" \
                --exclude-dir=.git --exclude-dir=node_modules \
                "$ROOT" 2>/dev/null || true)
fi
if [ -n "$LEAKS" ]; then
    echo "❌ Token pattern in working tree:"
    echo "$LEAKS"
    FOUND=1
else
    echo "   ✓ none"
fi

# 2. Git remote URLs of all sub-repos ─────────────────────────────────────────
echo "[2/4] Git remote URLs…"
LEAKS=""
while IFS= read -r -d '' gitdir; do
    REPO=$(dirname "$gitdir")
    if URL=$(cd "$REPO" && git remote -v 2>/dev/null); then
        if echo "$URL" | grep -qE "$PATTERN"; then
            LEAKS+="$REPO:"$'\n'"$URL"$'\n'
        fi
    fi
done < <(find "$ROOT" -name '.git' -type d -print0 2>/dev/null)
if [ -n "$LEAKS" ]; then
    echo "❌ Token in remote URL:"
    echo "$LEAKS"
    FOUND=1
else
    echo "   ✓ none"
fi

# 3. Git history (current repo only — full --all scan can be expensive) ───────
echo "[3/4] Git history of repo at $ROOT ..."
if [ -d "$ROOT/.git" ]; then
    LEAKS=$(cd "$ROOT" && git log -p --all 2>/dev/null | grep -E "$PATTERN" | head -5 || true)
    if [ -n "$LEAKS" ]; then
        echo "❌ Token pattern in git history (showing first 5 matches):"
        echo "$LEAKS"
        echo ""
        echo "   Token may already be public if pushed. Revoke immediately:"
        echo "   https://www.overleaf.com/user/settings"
        FOUND=1
    else
        echo "   ✓ none"
    fi
else
    echo "   (skipped — $ROOT is not a git repo)"
fi

# 4. Common credential-storage files ──────────────────────────────────────────
echo "[4/4] Credential files (.netrc, .env, *credentials*)…"
LEAKS=""
for f in ~/.netrc ~/.git-credentials "$ROOT/.env" "$ROOT/.envrc"; do
    if [ -f "$f" ] && grep -qE "$PATTERN" "$f" 2>/dev/null; then
        LEAKS+="$f"$'\n'
    fi
done
if [ -n "$LEAKS" ]; then
    echo "⚠️  Token in credential file (intentional? confirm not in repo):"
    echo "$LEAKS"
else
    echo "   ✓ none"
fi

echo ""
if [ $FOUND -eq 0 ]; then
    echo "✅ Audit clean — no Overleaf token leaks found."
    exit 0
else
    echo "❌ Audit FAILED — see leaks above."
    echo ""
    echo "Action items:"
    echo "  1. Revoke the leaked token at https://www.overleaf.com/user/settings"
    echo "  2. Generate a new token"
    echo "  3. Remove the leak (working tree: edit; remote URL: git remote set-url; history: git filter-repo)"
    echo "  4. Re-run overleaf_setup.sh with the new token"
    exit 1
fi
