# v7 — first full run on real Google Apps Script. 8/15.

Every task returned a genuine result. Zero execution errors, zero conversion errors.
Run `2026-09-24T17-28-46-543Z-952b5790`, benchmark version 39, 3355.6s wall clock.

| task | result | score | turns | reason | agent_ms | protected edits |
|---|---|---|---|---|---|---|
| task_02 | PASS | 85/85 | 17 | done | 128,335 | 0 |
| task_03 | PASS | 1080/1080 | 11 | done | 153,939 | 0 |
| task_04 | PASS | 19024/19024 | 15 | done | 212,957 | 0 |
| task_05 | PASS | 97/97 | 16 | done | 161,544 | 0 |
| task_06 | PASS | 392/392 | 18 | deadline | 245,960 | 0 |
| task_08 | PASS | 168/168 | 8 | done | 69,008 | 0 |
| task_09 | PASS | 21/21 | 14 | done | 184,061 | 0 |
| task_11 | PASS | 263/263 | 19 | done | 207,031 | 0 |
| task_10 | FAIL | 729/740 | 10 | done | 221,283 | 0 |
| task_13 | FAIL | 162/174 | 12 | done | 117,127 | 0 |
| task_14 | FAIL | 9/15 | 18 | deadline | 241,471 | 973 |
| task_01 | FAIL | 75/95 | 28 | deadline | 242,340 | 0 |
| task_07 | FAIL | 5/25 | 4 | done | 138,528 | 15 |
| task_12 | FAIL | 0/2279 | 24 | deadline | 269,538 | 0 |
| task_15 | FAIL | 0/728 | 4 | deadline | 250,585 | 0 |

**8/15 passed.**

Run with the preservation review DISABLED and the map capped at 90s. Not comparable to the
offline version numbers, which are per-seed pass rates over five samples against mog.
