#!/usr/bin/env python3
"""Uniformly regrade every offline-runs/*/submission.xlsx. Run from repo root.
Writes/overwrites grade.json per run + prints an aggregate table by task and seed-tag."""
import subprocess, json, glob, os, sys, collections
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
runs = sorted(glob.glob(os.path.join(root, 'offline-runs', '*', 'submission.xlsx')))
py = os.path.join(root, '.venv', 'bin', 'python')
agg = collections.defaultdict(dict)
for sub in runs:
    d = os.path.dirname(sub)
    name = os.path.basename(d)                      # <tag>-task_NN-<ts>
    parts = name.split('-task_')
    tag, tid = parts[0], 'task_' + parts[1][:2]
    r = subprocess.run([py, '-m', 'grader.google_grade', '--task', tid,
        '--initial', os.path.join(root, 'benchmarks/tasks', tid, 'init.xlsx'),
        '--golden', os.path.join(root, 'benchmarks/tasks', tid, 'golden.xlsx'),
        '--submission', sub, '--out', os.path.join(d, 'grade.json')],
        cwd=root, capture_output=True, text=True)
    if r.returncode:
        agg[tid][tag] = 'GERR'
        continue
    g = json.load(open(os.path.join(d, 'grade.json')))
    agg[tid][tag] = round(g['score'], 3)
tags = sorted({t for v in agg.values() for t in v})
print('task      ' + '  '.join(f'{t:>8}' for t in tags))
for tid in sorted(agg):
    print(f'{tid}  ' + '  '.join(f'{str(agg[tid].get(t,"-")):>8}' for t in tags))
perfect = sum(1 for tid in agg for t in agg[tid] if agg[tid][t] == 1.0)
print(f'\nperfect scores: {perfect} across {sum(len(v) for v in agg.values())} graded runs')
