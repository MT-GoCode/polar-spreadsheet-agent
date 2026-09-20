#!/usr/bin/env python3
"""Uniformly regrade every offline-runs/**/submission.xlsx. Run from repo root.
Writes/overwrites grade.json per run + prints every run's score grouped by task."""
import subprocess, json, glob, os, re, collections
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
runs = sorted(glob.glob(os.path.join(root, 'offline-runs', '**', 'submission.xlsx'), recursive=True))
agg = collections.defaultdict(list)
py = os.path.join(root, '.venv', 'bin', 'python')
for sub in runs:
    d = os.path.dirname(sub)
    name = os.path.basename(d)                      # [<tag>-]task_NN-<ts> or <ts>-task_NN
    m = re.search(r'(?:^|-)task_(\d\d)', name)
    tid = 'task_' + m.group(1)
    tag = name[:m.start()] or 'untagged'
    r = subprocess.run([py, '-m', 'grader.google_grade', '--task', tid,
        '--initial', os.path.join(root, 'benchmarks/tasks', tid, 'init.xlsx'),
        '--golden', os.path.join(root, 'benchmarks/tasks', tid, 'golden.xlsx'),
        '--submission', sub, '--out', os.path.join(d, 'grade.json')],
        cwd=root, capture_output=True, text=True)
    if r.returncode:
        agg[tid].append((tag, 'GERR:' + r.stderr.strip().splitlines()[-1][:60]))
        continue
    g = json.load(open(os.path.join(d, 'grade.json')))
    agg[tid].append((tag, round(g['score'], 3)))
total = perfect = 0
for tid in sorted(agg):
    cells = '  '.join(f'{t}:{s}' for t, s in agg[tid])
    nums = [s for _, s in agg[tid] if isinstance(s, float)]
    best = max(nums) if nums else 0.0
    total += len(agg[tid]); perfect += sum(1 for n in nums if n == 1.0)
    print(f'{tid}  best={best:<6}  {cells}')
print(f'\n{total} runs regraded, {perfect} perfect')
