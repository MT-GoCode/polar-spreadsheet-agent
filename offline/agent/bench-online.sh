#!/bin/bash
# npm run bench -- 01          one task on real Google Apps Script
# npm run bench                all 15
#
# Builds the bundle from the shared .gs sources, installs it as the candidate's Code.gs in
# the assessment repo where `npm run setup` was completed, and runs the company harness
# there. The build is INSIDE this command on purpose: dist/agent-online.gs has already gone
# stale against the .gs sources once, which would silently deploy yesterday's agent.
#
# Concurrency 1 by default. At higher concurrency the later executions queue behind Apps
# Script and age past Runtime.gs's 300s signature window: the 2026-09-20 run lost 7 of 15
# tasks to "Expired or invalid request" that way. Override with BENCH_CONCURRENCY.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${BENCH_HOST:-mac-personal}
REPO=${BENCH_REPO:-code/polar-spreadsheet-agent}
LOG=/tmp/bench-online.log

scp -q dist/agent-online.gs "$HOST:/tmp/agent-online.gs"
# Run under screen so a dropped ssh connection cannot kill a sweep that takes ~90 minutes.
ssh "$HOST" "cd ~/$REPO && cp /tmp/agent-online.gs Code.gs && rm -f $LOG && \
  screen -dmS bench-online bash -lc 'cd ~/$REPO; export PATH=/opt/homebrew/bin:\$PATH; \
  { npm run bench -- --concurrency ${BENCH_CONCURRENCY:-1} $*; echo BENCH_EXIT=\$?; } > $LOG 2>&1' \
  < /dev/null"

# Follow it, reconnecting if the link blips, and stop on the sentinel the screen job writes.
seen=0
while :; do
  out=$(ssh "$HOST" "cat $LOG 2>/dev/null" || true)
  printf '%s\n' "$out" | tail -n +$((seen + 1))
  seen=$(printf '%s\n' "$out" | wc -l | tr -d ' ')
  case "$out" in *BENCH_EXIT=*) break;; esac
  sleep 15
done
exit "$(printf '%s\n' "$out" | sed -n 's/^BENCH_EXIT=//p' | tail -1)"
