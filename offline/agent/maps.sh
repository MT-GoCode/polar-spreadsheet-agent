#!/bin/bash
# Pre-build the map cache for every task, through the SAME path a real run takes
# (agent/bench.mjs --map-only), fanned out like the sweep. No second implementation of the
# cache key, so the warm cache is always exactly what a run would have built.
#   agent/maps.sh [jobs] [task_NN ...]      default: all 15 at once
cd "$(dirname "$0")/.."
# 15 tasks, so run all of them at once. Map building is mog-bound and each
# worker is ~200MB; 15 concurrent measured 3GB on a 48GB box.
J=${1:-15}; shift 2>/dev/null
TASKS="$*"
[ -z "$TASKS" ] && TASKS=$(for i in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15; do echo task_$i; done)
echo "$TASKS" | tr ' ' '\n' | grep . | \
  xargs -P "$J" -I{} node agent/bench.mjs {} --map-only
