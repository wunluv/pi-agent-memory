#!/usr/bin/env bash
# Gate 3 test harness — step 1 (thin target: local bare repo, zero HTTP)
#
# Creates:
#   remote.git     — bare repo acting as the "memory server"
#   deviceA        — seeded agent memory repo with auto-push post-commit hook
#                    (mirrors push_on_commit design: push on ANY commit, Zone A)
#   deviceB        — clone, mirrors /agent:pull bootstrap + session-start pull
#
# Usage: ./setup.sh [root]   (root defaults to /tmp/pi-am-test)

set -euo pipefail

ROOT="${1:-/tmp/pi-am-test}"
REMOTE="$ROOT/remote.git"
A="$ROOT/deviceA"
B="$ROOT/deviceB"
LOG="$ROOT/activity.log"

rm -rf "$ROOT"
mkdir -p "$ROOT"
: > "$LOG"

echo "== remote =="
git init --bare -b main "$REMOTE" -q

echo "== deviceA (seeded, auto-push on commit) =="
git init -b main "$A" -q
cd "$A"
git config user.name "agent-test"
git config user.email "agent-test@pi"
mkdir -p system reference
printf '# Test agent memory\n' > system/README.md
git add -A
git commit -m "init: seed test agent memory" -q
git remote add origin "$REMOTE"
git push -u origin main -q
echo "[setup] deviceA seeded + first push" >> "$LOG"

# post-commit hook: Gate 3 design — push on ANY commit (write/update/create/delete),
# best-effort, non-blocking. In real impl this is gated by push_on_commit + server_url + Zone A.
cat > .git/hooks/post-commit <<'HOOK'
#!/bin/sh
git push origin HEAD >/dev/null 2>&1
HOOK
chmod +x .git/hooks/post-commit

echo "== deviceB (clone via /agent:pull) =="
git clone -q "$REMOTE" "$B"
cd "$B"
git config user.name "agent-test"
git config user.email "agent-test@pi"
echo "[setup] deviceB cloned" >> "$LOG"

echo
echo "Setup complete:"
echo "  remote : $REMOTE"
echo "  deviceA: $A   (auto-push on commit)"
echo "  deviceB: $B   (pull to sync)"
echo "  log    : $LOG"
