#!/usr/bin/env bash
# Gate 3 test harness — end-to-end scenario runner.
#
# Scenario:
#   1. setup      — remote bare repo + deviceA (auto-push hook) + deviceB (clone)
#   2. write x2   — deviceA writes project + system insights; hook auto-pushes
#   3. pull       — deviceB syncs via session-start pull
#   4. assert     — deviceB sees both writes
#
# Usage: ./run.sh [root]

set -euo pipefail
cd "$(dirname "$0")"
ROOT="${1:-/tmp/pi-am-test}"

echo "########## 1. SETUP ##########"
./setup.sh "$ROOT"

echo
echo "########## 2. WRITES on deviceA (auto-push via post-commit hook) ##########"
./write.sh "$ROOT" reference/heavencrm/decision.md "decision: pure git sync" \
  "Chose pure git over a custom wire protocol for memory sync. Server is replaceable."
./write.sh "$ROOT" system/human/pref.md "memory_write: human pref" \
  "User prefers routed, distilled insights over raw session dumps."

echo
echo "########## 3. DEVICEB state BEFORE pull ##########"
(cd "$ROOT/deviceB" && echo "at $(git log --oneline -1)")

echo
echo "########## 4. PULL on deviceB (session-start) ##########"
./pull.sh "$ROOT"

echo
echo "########## 5. ASSERT ##########"
if [ -f "$ROOT/deviceB/reference/heavencrm/decision.md" ] \
   && [ -f "$ROOT/deviceB/system/human/pref.md" ]; then
  echo "PASS: deviceB received both writes via push + pull."
else
  echo "FAIL: deviceB is missing synced files. Inspect $ROOT/deviceB".
  exit 1
fi

echo
echo "########## activity log ##########"
cat "$ROOT/activity.log"
