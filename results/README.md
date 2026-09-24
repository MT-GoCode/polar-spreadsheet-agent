# Results

## Apps Script, full suite: 8/15

Run `2026-09-24T17-28-46-543Z-952b5790`. Zero execution errors, zero conversion errors.

| task | result | outputs | turns | reason |
|---|---|---|---|---|
| 01 | FAIL | 78.9% | 28 | deadline |
| 02 | PASS | 100% | 17 | done |
| 03 | PASS | 100% | 11 | done |
| 04 | PASS | 100% | 15 | done |
| 05 | PASS | 100% | 16 | done |
| 06 | PASS | 100% | 18 | deadline |
| 07 | FAIL | 20% | 4 | done |
| 08 | PASS | 100% | 8 | done |
| 09 | PASS | 100% | 14 | done |
| 10 | FAIL | 98.5% | 10 | done |
| 11 | PASS | 100% | 19 | done |
| 12 | FAIL | 0% | 24 | deadline |
| 13 | FAIL | 93.1% | 12 | done |
| 14 | FAIL | 60% | 18 | deadline |
| 15 | FAIL | 0% | 4 | deadline |

Model: gpt-5.4, reasoning effort medium, fixed by the assignment.

Five of the seven failures ended on `deadline`, and task_06 passed while deadlining, so
Apps Script execution time is binding at the margin rather than reasoning quality. task_10
missed by eleven cells it never wrote, at `Operating Valuation!E46` onward.

`report.json` and the per-task `grade.json` files are the grader's own output, trimmed of
cell-value dumps.

## Reproducing this

**The submission needs nothing extra.** `npm run setup` then `npm run bench` uses the
assessment harness in this repository. `Code.gs` is the only `.gs` at the root and is built
from the shared sources in `offline/agent/`.

**Offline harness** — `offline/` in this repository.

An Apps Script-equivalent environment, used to iterate without Apps Script's six-minute
execution limit and 90-minute daily quota, so 15 tasks x 5 seeds could run at once.

    npm run setup:offline   fetch and verify the pinned engine, create the python env
    npm run test:offline    unit and verdict suites
    npm run bench:offline   the 75-attempt sweep
    npm run bench:offline:task task_03    a single task

It shares this repository's `benchmarks/` and `grader/` rather than carrying a copy.

**Patched engine** — https://github.com/MT-GoCode/mog/tree/polar-harness

A fork of https://github.com/fundamental-research-labs/mog (Apache-2.0) branched from
upstream `3abffd7`, carrying three parity patches so the grader reaches the same PASS/FAIL
on a locally rendered workbook as on a Google Sheets export: conditional formats written as
`type="expression"` with a dxf, no `val="0"` for strike/bold/italic, and a surfaced fatal
signal. Binary published at release `polar-harness-v1`, sha256 `a5a3269871187fc9...`.

`offline/out/controls.json` records the sha of the binary its noise floor was measured on,
and `offline/e2e/verdict.py` refuses to grade against a different one: a floor measured on
a noisier build silently forgives real agent damage.

## Limitations

- Five of the seven Apps Script failures ended on `deadline`, and task_06 passed while
  deadlining, so execution time is binding at the margin.
- Review and baseline are disabled online. With them enabled, the map plus baseline capture
  consumed the execution window and the agent reached the model with zero turns.
- task_12 and task_15 have never passed, in any version, online or offline.
- Only the darwin-arm64 engine binary is published. Other platforms build from the fork.
