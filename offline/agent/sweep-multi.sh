#!/bin/bash
# Seed values are labels for independent stochastic samples, not API sampling seeds.
# Usage: agent/sweep-multi.sh "1 2 3 4 5" 60
set -euo pipefail
cd "$(dirname "$0")/.."
SEEDS=${1:-"1 2 3 4 5"}
read -r -a labels <<< "$SEEDS"
[ ${#labels[@]} -gt 0 ] || { echo 'No seed labels'; exit 2; }
for s in "${labels[@]}"; do
  [[ "$s" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Invalid seed label: $s"; exit 2; }
done
[ "$(printf '%s\n' "${labels[@]}" | sort -u | wc -l | tr -d ' ')" -eq ${#labels[@]} ] || { echo 'Duplicate seed labels'; exit 2; }
J=${2:-$((${#labels[@]} * 15))}
[[ "$J" =~ ^[1-9][0-9]*$ ]] || { echo 'Jobs must be a positive integer'; exit 2; }
node build.mjs
node agent/preflight.mjs
# A cold map failure should stop the sweep before any model calls. Warm each task once.
agent/maps.sh 15
mkdir -p runs
SWEEP_LOG_DIR=$(mktemp -d "$PWD/runs/sweep-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
export SWEEP_LOG_DIR
printf 'Sweep logs: %s\n' "$SWEEP_LOG_DIR"
# Slowest tasks first, so a J below the full matrix has the long tail already running
# rather than starting it last. Medians from the log mtimes of sweep-20260924T084603Z:
# task_12 and task_15 finish roughly 260s after task_08. Tasks are the outer loop so
# every seed of the slowest task is queued ahead of any seed of the fastest. Order is
# irrelevant when J covers all 75 -- xargs starts everything at once either way.
TASK_ORDER=${TASK_ORDER:-"12 15 10 01 13 14 11 04 03 06 09 05 07 02 08"}
read -r -a order <<< "$TASK_ORDER"
[ ${#order[@]} -eq 15 ] || { echo "TASK_ORDER needs 15 tasks, got ${#order[@]}"; exit 2; }
for i in "${order[@]}"; do
  for s in "${labels[@]}"; do printf 'task_%s %s\n' "$i" "$s"; done
done | xargs -P "$J" -n2 sh -c '
  task=$1; seed=$2
  log="$SWEEP_LOG_DIR/$task-s$seed.log"
  node agent/bench.mjs "$task" --seed "$seed" >"$log" 2>&1
  rc=$?
  printf "%s\n" "$rc" >"$SWEEP_LOG_DIR/$task-s$seed.status"
  summary=$(grep -E "AGENT RUN|score |HARNESS ERROR|RUN END:" "$log" | tr "\n" " ")
  printf "[%s s%s] rc=%s %s\n" "$task" "$seed" "$rc" "${summary:-NO VERDICT; see log}"
  # Aggregate after every scheduled job finishes, including failures.
  exit 0
' sweep-worker
node --input-type=module -e '
import fs from "node:fs";
const dir=process.env.SWEEP_LOG_DIR;
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".status"));
const counts={pass:0,fail:0,harness_error:0};
for(const f of files){const rc=Number(fs.readFileSync(`${dir}/${f}`,"utf8")); counts[rc===0?"pass":rc===1?"fail":"harness_error"]++;}
const expected=Number(process.argv[1]);
const summary={expected,finished:files.length,...counts};
fs.writeFileSync(`${dir}/summary.json`,JSON.stringify(summary,null,2));
console.log("SWEEPDONE",JSON.stringify(summary));
process.exit(files.length!==expected||counts.harness_error?2:counts.fail?1:0);
' "$((${#labels[@]} * 15))"
