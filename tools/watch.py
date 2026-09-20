#!/usr/bin/env python3
"""Poll doGet trace for a running task; stream to temp files. stdlib only."""
import json, sys, time, glob, os, urllib.request
task = sys.argv[1]  # e.g. 06
root = os.path.expanduser('~/code/polar-spreadsheet-agent')
url = json.load(open(f'{root}/.benchmark-google.json'))['http']['url']
runs = f'{root}/grading-results/google-runs'
req = None; deadline = time.time() + 240
while time.time() < deadline and not req:
    cands = sorted(glob.glob(f'{runs}/2*/task_{task}/request.json'), key=os.path.getmtime)
    if cands and os.path.getmtime(cands[-1]) > time.time() - 600: req = cands[-1]
    else: time.sleep(3)
if not req: print('no run dir appeared', file=sys.stderr); sys.exit(1)
sid = json.load(open(req))['spreadsheetId']
trace_f, status_f = f'/tmp/polar-trace-{task}.json', f'/tmp/polar-status-{task}.json'
t0 = time.time()
while time.time() - t0 < 500:
    try:
        raw = urllib.request.urlopen(f'{url}?trace={sid}', timeout=20).read()
        tr = json.loads(raw)
        open(trace_f,'wb').write(raw)
        turns = [e for e in tr if e.get('t')=='turn']; calls=[e for e in tr if e.get('t')=='call']
        last = tr[-1] if tr else {}
        st = {'spreadsheetId': sid, 'run_dir': os.path.dirname(req), 'events': len(tr), 'turns': len(turns),
              'tool_calls': len(calls), 'elapsed_s': round(last.get('at',0)/1000),
              'last_event': last.get('t'), 'last_tool': (calls[-1].get('tool') if calls else None),
              'verdict': next((e.get('verdict') for e in reversed(tr) if e.get('t')=='verdict'), None)}
        open(status_f,'w').write(json.dumps(st, indent=1))
    except Exception as e:
        open(status_f,'a').write(f'\n# poll error {e}')
    if os.path.exists(os.path.join(os.path.dirname(req),'grade.json')): break
    time.sleep(6)
