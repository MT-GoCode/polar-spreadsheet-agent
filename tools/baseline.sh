#!/bin/bash
# 15 tasks × 3 seeds, sequential seeds, unattended. Logs: /tmp/polar-baseline.log
# Per-seed + final summaries pushed to ntfy.sh/minh-agents-alerts.
set -u
export PATH=/opt/homebrew/bin:$PATH
cd ~/code/polar-spreadsheet-agent
SUMMARY=/tmp/polar-baseline-summary.txt
: > $SUMMARY
for seed in 1 2 3; do
  echo "=== SEED $seed start $(date +%H:%M:%S)" | tee -a $SUMMARY
  npm run bench -- --concurrency 3 2>&1 | tee /tmp/polar-seed$seed.log | grep -E "^[0-9]{2} +(PASS|FAIL|ERROR)|passed in" >> $SUMMARY
  P=$(grep -c "PASS" /tmp/polar-seed$seed.log || true)
  LINE=$(grep -E "passed in" /tmp/polar-seed$seed.log | tail -1)
  true && : skip-ntfy -H "Title: polar baseline seed $seed done" -H "Priority: high" \
       -d "$LINE" ntfy.sh/minh-agents-alerts > /dev/null
done
# aggregate the last 3 reports
python3 - <<'PY' >> $SUMMARY
import json, glob, os, collections
reports = sorted(glob.glob(os.path.expanduser('~/code/polar-spreadsheet-agent/grading-results/google-runs/*/report-*.json')), key=os.path.getmtime)[-3:]
agg = collections.defaultdict(list)
for rp in reports:
    for t in json.load(open(rp)).get('tasks', []):
        agg[t['task_id']].append('P' if t.get('passed') else ('E' if t.get('execution',{}).get('status')!='completed' else 'F'))
print('\n=== BASELINE per task (3 seeds):')
total = 0
for tid in sorted(agg):
    marks = ''.join(agg[tid]); total += marks.count('P')
    print(f"{tid}: {marks}  ({marks.count('P')}/3)")
print(f"TOTAL passes: {total}/45")
PY
tail -20 $SUMMARY | true && : skip-ntfy -H "Title: polar 15x3 BASELINE COMPLETE" -H "Priority: high" --data-binary @- ntfy.sh/minh-agents-alerts > /dev/null
# render all transcripts from the 3 runs
for d in $(ls -td grading-results/google-runs/2*/ | head -3); do
  for r in $d*/response.json; do python3 tools/render_transcript.py "$r" >/dev/null 2>&1; done
done
echo "=== ALL DONE $(date +%H:%M:%S)" >> $SUMMARY
