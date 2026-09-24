# Per-turn tool guidance versus the preceding frozen sweep

Baseline `1515d70`: **45/75**, $74.89. New `34ae551`: **42/75**, $75.26.

Both sweeps used GPT-5.4 medium, 75 concurrency on mac-personal, review enabled and initial adaptive planning disabled. New runs received the request-local reminder on every turn. Seed labels identify independent stochastic attempts, not matched API seeds. This is one sweep per configuration.

| Task | Before | After | Delta | Median turns before → after | Median tool calls before → after | New median wall s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| task_01 | 3/5 | 3/5 | +0 | 23 → 22 | 20 → 19 | 218.2 |
| task_02 | 5/5 | 4/5 | -1 | 15 → 14 | 11 → 10 | 97.4 |
| task_03 | 5/5 | 5/5 | +0 | 10 → 11 | 5 → 5 | 572.2 |
| task_04 | 5/5 | 5/5 | +0 | 17 → 18 | 11 → 10 | 371.9 |
| task_05 | 4/5 | 5/5 | +1 | 16 → 15 | 13 → 11 | 172.1 |
| task_06 | 5/5 | 5/5 | +0 | 17 → 16 | 14 → 13 | 357.3 |
| task_07 | 3/5 | 0/5 | -3 | 14 → 13 | 8 → 8 | 164.6 |
| task_08 | 2/5 | 2/5 | +0 | 12 → 14 | 8 → 8 | 126.5 |
| task_09 | 4/5 | 5/5 | +1 | 11 → 11 | 8 → 8 | 171.8 |
| task_10 | 1/5 | 0/5 | -1 | 28 → 28 | 18 → 17 | 323.3 |
| task_11 | 5/5 | 4/5 | -1 | 17 → 14 | 13 → 8 | 169.3 |
| task_12 | 0/5 | 0/5 | +0 | 40 → 36 | 31 → 28 | 419.9 |
| task_13 | 0/5 | 0/5 | +0 | 20 → 18 | 15 → 12 | 165.6 |
| task_14 | 3/5 | 4/5 | +1 | 22 → 23 | 14 → 15 | 244.5 |
| task_15 | 0/5 | 0/5 | +0 | 37 → 30 | 24 → 19 | 469.9 |

## Power tool calls

| Tool | Before | After |
| --- | ---: | ---: |
| audit_check | 2 | 6 |
| compare_schedules | 1 | 1 |
| compare_sources | 13 | 1 |
| find_sources | 17 | 36 |
| inspect_calculation | 101 | 96 |
| inspect_original | 25 | 23 |
| inspect_range | 824 | 674 |
| inspect_schedule | 17 | 21 |
| list_formula_errors | 58 | 41 |
| reconcile | 26 | 19 |
| what_if | 0 | 2 |

All 1425 turns in the new run contain a reminder event. Source-integrity checks passed for both sweeps.

See comparison.json for every failed attempt and its grader failure categories.
