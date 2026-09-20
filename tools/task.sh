#!/bin/bash
# task.sh start|status|tail|show NN — ultra-visible single-task bench runs.
set -u
ROOT=~/code/polar-spreadsheet-agent; cd $ROOT
CMD=$1; NN=$2
case $CMD in
start)
  nohup npm run bench -- $NN --keep-sheets > /tmp/polar-bench-$NN.log 2>&1 &
  echo "bench pid $! → /tmp/polar-bench-$NN.log"
  nohup python3 tools/watch.py $NN > /tmp/polar-watch-$NN.log 2>&1 &
  echo "watcher pid $! → live trace /tmp/polar-trace-$NN.json · status /tmp/polar-status-$NN.json"
  ;;
status)
  echo "--- bench log tail:"; tail -5 /tmp/polar-bench-$NN.log 2>/dev/null
  echo "--- live status:"; cat /tmp/polar-status-$NN.json 2>/dev/null || echo "(no status yet)"
  ;;
tail)
  python3 - <<EOF
import json
tr=json.load(open('/tmp/polar-trace-$NN.json'))
for e in tr[-12:]:
    if e.get('t')=='turn':
        print(round(e.get('at',0)/1000),'s','turn',e.get('n'),f"{e.get('ms',0)//1000}s", (('THINK: '+e['think'][:120]) if e.get('think') else ''), (('SAID: '+e['text'][:120]) if e.get('text') else ''))
    else:
        print(round(e.get('at',0)/1000),'s', e.get('t'), e.get('tool',''), str(e.get('args',''))[:80], str(e.get('out',''))[:100].replace(chr(10),' '))
EOF
  ;;
show)
  D=$(ls -td grading-results/google-runs/2*/task_$NN 2>/dev/null | head -1)
  if [ -f "$D/response.json" ]; then python3 tools/render_transcript.py $D/response.json
  elif [ -f /tmp/polar-trace-$NN.json ]; then
    python3 -c "
import json,sys; sys.path.insert(0,'tools'); import render_transcript as R
tr=json.load(open('/tmp/polar-trace-$NN.json'))
print(R.render(tr, {'task':'task_$NN','status':'RECOVERED (no response.json)'}, '$D/transcript.md' if '$D' else '/tmp/polar-transcript-$NN.md'))"
  else echo "no response.json and no live trace"; fi
  ;;
esac
