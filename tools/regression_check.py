#!/usr/bin/env python3
"""Per-task regression test against a recorded baseline, pooling every run of the current
code. Only tasks that PASSED at baseline can regress, so only those are worth testing.

Pass/fail comes from each run's gate.json (the real criterion), never from the score.
Reports a one-sided Fisher exact p-value for "the new pass rate is lower". Exact, no
approximation, valid at these tiny n -- which is the whole problem with this benchmark:
the aggregate over 14 all-or-nothing tasks swings +-3 tasks between identical runs.

  python3 tools/regression_check.py --since 2026-09-22T05-06
"""
import argparse, glob, json, os, re, sys
from math import comb

# baseline = the 40 graded runs of the pre-change harness, scored by the real gate
BASELINE = {'01': (3, 3), '02': (3, 3), '03': (3, 3), '04': (1, 2), '05': (1, 3),
            '06': (3, 3), '07': (0, 3), '08': (1, 2), '09': (3, 3), '10': (0, 3),
            '11': (3, 3), '12': (0, 3), '13': (0, 3), '15': (0, 3)}


def fisher_one_sided_lower(a, b, c, d):
    """One-sided Fisher exact p for "the current pass rate is lower than baseline".

    Table is [[a, b], [c, d]] = [[baseline pass, baseline fail], [current pass,
    current fail]]. Under the null (same true rate), the number of baseline passes X is
    hypergeometric; "current is worse" means X is unusually HIGH, so the p-value is
    P(X >= a). Summed exactly -- n here is single digits.
    """
    row1, passes, n = a + b, a + c, a + b + c + d
    if row1 == 0 or passes == 0 or n == 0:
        return 1.0
    denom = comb(n, passes)
    p = 0.0
    for x in range(a, min(row1, passes) + 1):
        p += comb(row1, x) * comb(n - row1, passes - x) / denom
    return min(1.0, p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', required=True, help='run-dir timestamp prefix cutoff, e.g. 2026-09-22T05-06')
    a = ap.parse_args()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    obs = {}
    for g in glob.glob(os.path.join(root, 'offline-runs', 's*-task_*', 'gate.json')):
        d = os.path.basename(os.path.dirname(g))
        m = re.match(r's\d+-task_(\d\d)-(.+)$', d)
        if not m or m.group(2) < a.since:
            continue
        t = m.group(1)
        p, n = obs.get(t, (0, 0))
        obs[t] = (p + (1 if json.load(open(g))['passed_offline'] else 0), n + 1)

    print(f"{'task':6}{'baseline':>12}{'current':>12}{'p(regress)':>12}  verdict")
    regressions, untested = [], []
    for t in sorted(BASELINE):
        bp, bn = BASELINE[t]
        if t not in obs:
            untested.append(t)
            continue
        op, on = obs[t]
        if bp == 0:
            print(f"t{t:5}{f'{bp}/{bn}':>12}{f'{op}/{on}':>12}{'n/a':>12}  cannot regress (0 at baseline)")
            continue
        p = fisher_one_sided_lower(bp, bn - bp, op, on - op)
        # Detection threshold: the most current-passes that would still be called a
        # regression. Makes the (low) power of a 3-seed baseline explicit instead of
        # letting "not significant" read as "fine".
        thr = -1
        for k in range(on, -1, -1):
            if fisher_one_sided_lower(bp, bn - bp, k, on - k) < 0.05:
                thr = k
                break
        if p < 0.05:
            verdict = 'REGRESSION'
            regressions.append(t)
        elif op / on >= bp / bn:
            verdict = 'no drop observed'
        else:
            verdict = 'lower, not significant'
        power = f'(would flag <={thr}/{on})' if thr >= 0 else '(CANNOT flag any drop)'
        print(f"t{t:5}{f'{bp}/{bn}':>12}{f'{op}/{on}':>12}{p:>12.3f}  {verdict} {power}")
    if untested:
        print(f"\nNOT TESTED on current code: {', '.join('t' + x for x in untested)}")
    print(f"\nregressions at p<0.05: {len(regressions)}" + (f" -> {regressions}" if regressions else " (none)"))
    return 1 if regressions else 0


if __name__ == '__main__':
    sys.exit(main())
