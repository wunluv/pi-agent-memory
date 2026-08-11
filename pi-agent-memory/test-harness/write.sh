#!/usr/bin/env bash
# Gate 3 test harness — simulate a memory write on deviceA.
# Commits, then the post-commit hook auto-pushes to the remote.
#
# Usage: ./write.sh [root] <path> <commit-msg> ['body text']

set -euo pipefail

ROOT="${1:-/tmp/pi-am-test}"
A="$ROOT/deviceA"
LOG="$ROOT/activity.log"
shift || true

FILE="${1:-reference/observation.md}"
MSG="${2:-memory_write: $FILE}"
BODY="${3:-A test observation logged to memory.}"

cd "$A"
mkdir -p "$(dirname "$FILE")"
printf '# %s\n\n%s\n' "$FILE" "$BODY" > "$FILE"
git add -A
git commit -m "$MSG" -q
echo "[$(date +%H:%M:%S)] committed $FILE (post-commit hook pushes)" >> "$LOG"
echo "Committed (auto-push via hook): $FILE"
