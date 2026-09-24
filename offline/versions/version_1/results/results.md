# Version 1 results

**30 PASS / 45 FAIL = 40% per-run pass rate**, over 75 runs.

15 tasks x 5 independent samples, plus one extra pilot sample on task_01 (listed as s0).
`seed` is only a label -- it is never sent to the API -- so these are independent
stochastic draws, not controlled replicates.

task_04 seed 5 is missing: killed after 18 min when the engine went into a runaway
recalc on the agent's 19th tool call. Its other three graded seeds scored identically.

## Pass/fail

| task | s0 | s1 | s2 | s3 | s4 | s5 | rate |
|---|---|---|---|---|---|---|---|
| task_01 | FAIL | PASS | PASS | PASS | FAIL | PASS | **4/6** |
| task_02 | -- | PASS | PASS | PASS | PASS | PASS | **5/5** |
| task_03 | -- | PASS | PASS | PASS | PASS | PASS | **5/5** |
| task_04 | -- | FAIL | FAIL | FAIL | FAIL | -- | **0/4** |
| task_05 | -- | PASS | PASS | PASS | PASS | PASS | **5/5** |
| task_06 | -- | PASS | PASS | FAIL | PASS | FAIL | **3/5** |
| task_07 | -- | FAIL | FAIL | FAIL | FAIL | FAIL | **0/5** |
| task_08 | -- | PASS | FAIL | FAIL | FAIL | PASS | **2/5** |
| task_09 | -- | FAIL | FAIL | FAIL | FAIL | FAIL | **0/5** |
| task_10 | -- | FAIL | FAIL | FAIL | FAIL | FAIL | **0/5** |
| task_11 | -- | PASS | FAIL | PASS | PASS | PASS | **4/5** |
| task_12 | -- | FAIL | FAIL | FAIL | FAIL | FAIL | **0/5** |
| task_13 | -- | FAIL | FAIL | FAIL | FAIL | FAIL | **0/5** |
| task_14 | -- | PASS | FAIL | FAIL | FAIL | PASS | **2/5** |
| task_15 | -- | FAIL | FAIL | FAIL | FAIL | FAIL | **0/5** |

## Output score (correct / graded cells)

| task | s0 | s1 | s2 | s3 | s4 | s5 |
|---|---|---|---|---|---|---|
| task_01 | 75/95 | 95/95 | 95/95 | 95/95 | 75/95 | 95/95 |
| task_02 | -- | 85/85 | 85/85 | 85/85 | 85/85 | 85/85 |
| task_03 | -- | 1080/1080 | 1080/1080 | 1080/1080 | 1080/1080 | 1080/1080 |
| task_04 | -- | 0/19024 | 0/19024 | 0/19024 | 0/19024 | -- |
| task_05 | -- | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 |
| task_06 | -- | 392/392 | 392/392 | 390/392 | 392/392 | 190/392 |
| task_07 | -- | 25/25 | 25/25 | 25/25 | 25/25 | 25/25 |
| task_08 | -- | 168/168 | 120/168 | 120/168 | 35/168 | 168/168 |
| task_09 | -- | 21/21 | 21/21 | 21/21 | 21/21 | 21/21 |
| task_10 | -- | 718/740 | 718/740 | 707/740 | 729/740 | 740/740 |
| task_11 | -- | 263/263 | 263/263 | 263/263 | 263/263 | 263/263 |
| task_12 | -- | 2073/2279 | 2035/2279 | 1470/2279 | 2120/2279 | 1179/2279 |
| task_13 | -- | 168/174 | 126/174 | 132/174 | 168/174 | 168/174 |
| task_14 | -- | 15/15 | 13/15 | 13/15 | 12/15 | 15/15 |
| task_15 | -- | 395/728 | 395/728 | 395/728 | 395/728 | 395/728 |

## Preservation violations (raw / discounted as measured engine artifacts)

| task | s0 | s1 | s2 | s3 | s4 | s5 |
|---|---|---|---|---|---|---|
| task_01 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| task_02 | -- | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| task_03 | -- | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| task_04 | -- | 0/0 | 0/0 | 0/0 | 0/0 | -- |
| task_05 | -- | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| task_06 | -- | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| task_07 | -- | 43/15 | 71/29 | 44/0 | 42/15 | 42/15 |
| task_08 | -- | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| task_09 | -- | 31/30 | 31/30 | 1/0 | 31/30 | 1/0 |
| task_10 | -- | 328/0 | 0/0 | 0/0 | 55/0 | 22/0 |
| task_11 | -- | 0/0 | 1/0 | 0/0 | 0/0 | 0/0 |
| task_12 | -- | 0/0 | 310/0 | 308/0 | 373/0 | 290/0 |
| task_13 | -- | 18/18 | 18/18 | 12/12 | 18/18 | 18/18 |
| task_14 | -- | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| task_15 | -- | 42/42 | 42/42 | 43/42 | 42/42 | 42/42 |

## Cost and effort

| task | median turns | median secs | $ total |
|---|---|---|---|
| task_01 | 14 | 141 | $2.28 |
| task_02 | 4 | 41 | $0.79 |
| task_03 | 6 | 54 | $0.33 |
| task_04 | 16 | 93 | $1.11 |
| task_05 | 9 | 77 | $1.14 |
| task_06 | 7 | 73 | $1.70 |
| task_07 | 8 | 85 | $1.13 |
| task_08 | 7 | 50 | $0.70 |
| task_09 | 6 | 84 | $1.56 |
| task_10 | 8 | 172 | $2.45 |
| task_11 | 7 | 53 | $1.44 |
| task_12 | 8 | 239 | $3.60 |
| task_13 | 6 | 94 | $1.21 |
| task_14 | 11 | 88 | $1.65 |
| task_15 | 14 | 198 | $3.67 |

**Total $24.76** across 75 runs, $0.33/run.

## Stop reasons

`{'done': 74, 'context_exhausted': 1}`

Every run but one ended because the model decided it was finished. The 20-minute
deadline was never hit. Median 8 tool calls, max 19.
