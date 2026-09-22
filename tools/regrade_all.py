#!/usr/bin/env python3
"""Uniformly re-grade every offline-runs/**/submission.xlsx with the current grader and
the real pass gate. Run from the repo root.

Grades against offline/.baseline/<task>.xlsx (the engine's own round-trip of init.xlsx)
so whole-file re-serialization drift is not scored as agent damage, then applies
tools/offline_gate.py for the remaining two artifact corrections and the pass decision.

Writes grade.json + gate.json per run and prints a per-task x per-tag table.
The total is an OFFLINE ESTIMATE; only an online run certifies a pass.
"""
import subprocess, json, glob, os, re, collections, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
py = os.path.join(root, '.venv', 'bin', 'python')
runs = sorted(glob.glob(os.path.join(root, 'offline-runs', '**', 'submission.xlsx'), recursive=True))
if not runs:
    sys.exit('no offline-runs/**/submission.xlsx found')

agg = collections.defaultdict(dict)
baselines = {}


def baseline_for(tid):
    """Build (once) and return the round-tripped baseline, or None if unavailable."""
    if tid in baselines:
        return baselines[tid]
    p = os.path.join(root, 'offline', '.baseline', tid + '.xlsx')
    if not os.path.exists(p):
        r = subprocess.run(['node', os.path.join(root, 'offline/baseline.mjs'), tid],
                           cwd=root, capture_output=True, text=True)
        if r.returncode or not os.path.exists(p):
            # No fallback: init.xlsx would count the engine's own re-serialization drift
            # as agent damage and silently report a wrong pass/fail.
            sys.exit(f'{tid}: baseline build failed, refusing to grade against raw '
                     f'init.xlsx: {r.stderr.strip()[-200:]}')
    baselines[tid] = p
    return p


for sub in runs:
    d = os.path.dirname(sub)
    name = os.path.basename(d)                       # [<tag>-]task_NN-<ts> or <ts>-task_NN
    m = re.search(r'(?:^|-)task_(\d\d)', name)
    if not m:
        continue
    tid = 'task_' + m.group(1)
    tag = name[:m.start()].rstrip('-') or 'untagged'
    initial = baseline_for(tid)
    gp, tp = os.path.join(d, 'grade.json'), os.path.join(d, 'gate.json')
    r = subprocess.run([py, '-m', 'grader.google_grade', '--task', tid,
                        '--initial', initial,
                        '--golden', os.path.join(root, 'benchmarks/tasks', tid, 'golden.xlsx'),
                        '--submission', sub, '--out', gp],
                       cwd=root, capture_output=True, text=True)
    if r.returncode:
        agg[tid][tag] = {'err': 'GRADE:' + (r.stderr.strip().splitlines() or [''])[-1][:60]}
        continue
    r2 = subprocess.run([py, os.path.join(root, 'tools/offline_gate.py'), '--task', tid,
                         '--grade', gp, '--initial', initial, '--submission', sub, '--out', tp],
                        cwd=root, capture_output=True, text=True)
    if r2.returncode:
        agg[tid][tag] = {'err': 'GATE:' + (r2.stderr.strip().splitlines() or [''])[-1][:60]}
        continue
    g = json.load(open(tp))
    agg[tid][tag] = {'pass': g['passed_offline'], 'score': g['score'],
                     'viol': g['real_violation_count'],
                     'reasons': g['output_failure_reasons'],
                     'reqs': g['failed_requirements']}

tags = sorted({t for v in agg.values() for t in v})
passes = total = 0
score_one = 0
print(f"\n{'task':8}" + ''.join(f'{t:>22}' for t in tags))
for tid in sorted(agg):
    cells = []
    for t in tags:
        r = agg[tid].get(t)
        if r is None:
            cells.append('-'.rjust(22))
        elif 'err' in r:
            cells.append(r['err'][:21].rjust(22))
        else:
            total += 1
            passes += r['pass']
            score_one += (r['score'] == 1.0)
            cells.append(f"{'PASS' if r['pass'] else 'fail'} {r['score']:.3f} v={r['viol']}".rjust(22))
    print(f'{tid:8}' + ''.join(cells))

per_task = {tid: sum(1 for r in agg[tid].values() if r.get('pass')) for tid in agg}
print(f"\nreal gate: {passes}/{total} runs pass  (OFFLINE ESTIMATE -- only an online run certifies)")
print(f"score==1.0 only: {score_one}/{total}  -- NOT the pass criterion")
print("tasks passing every tag:",
      sorted(t for t in per_task if per_task[t] == len([x for x in agg[t].values() if 'err' not in x]) and per_task[t]))
print("tasks never passing:", sorted(t for t in per_task if per_task[t] == 0))
