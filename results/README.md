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

Model: gpt-5.4, reasoning effort medium (fixed by the assignment).

Five of the seven failures ended on `deadline`, and task_06 passed while deadlining, so
Apps Script time is binding at the margin rather than reasoning quality. task_10 missed by
eleven unwritten cells at Operating Valuation!E46.

Review and baseline are disabled online: map plus baseline capture consumed the entire
execution window and the agent reached the model with zero turns. Offline the same sources
run the full review gate.

`report.json` and per-task `grade.json` are the grader output, trimmed of cell-value dumps.
