# v7 — the agent was never failing online, it was never starting. 8/15.

The first full run against real Google Apps Script, and the first one where every task
returned a result at all. Zero execution errors. What it mostly measures is not reasoning
quality but whether the run survives Apps Script's limits.

```
8/15 passed · 3355.6s · benchmark version 39
```

## What was actually wrong

task_03 online ended `turns: 0, reason: deadline, cost_usd: 0`. It never made a single model
call. Setup consumed the whole window: 114s building the map and roughly 130s capturing the
baseline, against a 300s signature window and a six-minute execution ceiling. It scored zero
on setup cost, with the agent's competence never entering into it.

Online cost is round-trips, not cells. `blankRun` probed every row's blank runs separately —
68,277 `isBlank` calls on task_03, 1,385 on task_04, against roughly 312 for reading every
value and format in the workbook. Consecutive rows nearly always share a blank pattern, and
one `isBlank` over the whole rectangle answers for all of them, so that became 1,360 and 126.

Capping the map at 90s and disabling the review turned task_03 from 0 turns into
1080/1080 in 11 turns.

## Why none of this showed up offline

Three independent reasons, each enough on its own:

- **The shim does not ship online.** `build-online.mjs` bundles the `.gs` sources only, so
  real Apps Script uses native getters. Every optimisation aimed at `shim/` is invisible here.
- **mog treats `setValue("")` as blank.** A blank run resolves in one call, so the bisection
  that costs thousands of round-trips online never fires under mog. It is the one engine where
  that cost cannot appear.
- **The used range differs.** The same workbook presents a 358,368-cell sheet to mog and a
  12,324-cell used range to Sheets, so even the cell counts do not transfer.

Every timing taken offline was measuring a different bottleneck than the one that decides the
submission.

## What the failures actually are

**Deadline, not reasoning — five of seven.** task_01, 06, 12, 14 and 15 all ended on
`deadline`, and task_06 *passed* while deadlining. Time is binding right at the edge, so
trimming setup further should convert one or two directly.

**Two gave up rather than ran out.** task_07 and task_15 stopped at 4 turns while everything
else ran 8 to 28.

**Near misses.** task_10 at 729/740 is the same eleven unwritten cells at
`Operating Valuation!E46` that it misses offline. task_13 at 162/174 is its familiar six-cell
sign flip plus a few more.

**The cost of running without the gate.** task_14 committed 973 protected edits and task_07
fifteen. Those are exactly the preservation failures the review catches offline, where it took
task_09 from 2/5 to 5/5. This run had no review at all.

## Not comparable to v1-v6

Those are per-seed pass rates over five samples against mog. This is one sample per task
against Google. They answer different questions and should not be read as a progression.

## What v8 should be

Re-enable the review. It was disabled to buy back turns, and the round-trip fix cut capture's
cost by 50x on task_03 — but `capture_ms` on production was never measured, so that remains an
expectation rather than a result. Measure it first, then decide.
