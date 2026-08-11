#!/usr/bin/env bash
# Gate 3 test harness — simulate session-start pull on deviceB.
# Mirrors pull_on_start design (2-3s fail-fast in real impl; here plain pull).
#
# Usage: ./pull.sh [root]

set -euo pipefail

ROOT="${1:-/tmp/pi-am-test}"
B="$ROOT/deviceB"
LOG="$ROOT/activity.log"

cd "$B"
git pull --quiet origin main 2>&1 | tail -1 || true
echo "[$(date +%H:%M:%S)] deviceB pulled from remote" >> "$LOG"
echo "deviceB now at: $(git log --oneline -1)"
