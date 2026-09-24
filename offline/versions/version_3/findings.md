# v3 — the prompt is finished. 39/75 = 52%.

Two line edits against v2, plus one that got reverted. That is the whole version. It bought
one run, and the four versions together bought 32 → 39. The useful output of v3 is not the
number; it is the two things it settled.

## What the ablation settled

v3 first shipped THREE changes at once and scored 35/75 — worse than v2's 38. The two
targeted line edits worked (every task they aimed at recovered), but six unrelated tasks
regressed, which is the signature of a broad instruction rather than two narrow ones. The
third change was a new first tip: *"FIRST, before anything else: read every cell, range,
named symbol and formula the prompt mentions by name."*

Reverting only that tip gave 39/75. So the tip cost roughly four runs, and — the part worth
remembering — **task_09 itself dropped 2/5 → 1/5, and that tip was written specifically for
task_09's failure.** A rule aimed at one task, stated globally, made that task worse.

Two rules fall out of this, both paid for:

1. **One change per sweep.** Bundling cost a full 75-run measurement to untangle.
2. **A globally-stated instruction has a global cost.** The prompt is at 7.6 KB and every
   addition now trades. v2 → v3b is two edits for one net run.

## The prompt is saturated

```
v1  32/75   42.7%
v2  38/75   50.7%    +6   the lifted corpus: formulas-not-literals, formatting is graded, ...
v3  35/75   46.7%    -3   bundled, one bad tip
v3b 39/75   52.0%    +1   same minus that tip
```

The second edit bought one run. The canary keeps firing whenever text is added. Four rounds
of prompt work is enough evidence: what remains is not a prompting problem.

## Seed noise is large, and most per-task deltas are not real

Across four versions the per-task numbers move by ±1 constantly — task_04 5/5 → 4/5, task_11
4/5 → 3/5, task_14 2/5 → 1/5. On five samples those are noise, and reading them as signal is
how you end up chasing ghosts. Only three patterns survive all four versions:

- **task_03 and task_05 are 5/5 in every version.** Solved.
- **task_12 and task_15 are 0/5 in every version — 20 runs each, zero passes.** Nothing we
  have done has moved either by a single seed.
- **task_10 is 0/5 in three of four.**

## Where the remaining 36 failures are

Unchanged in shape from v2: ~86% are wrong output, not preservation damage. The agent finds
values fine; it cannot reliably tell what a value *means*. Wrong source column, wrong sign
against the label, wrong period convention.

Four parallel deep-dives across all 15 workbooks (one per difficulty stratum) looked for
anything in the files that would let the agent check itself. The headline is negative and it
killed the plan we were about to build:

**Balance-sheet tie-outs are worthless here.**

- task_14's 32 checks cover **0%** of graded output — Board Summary is a pure sink that
  nothing references, so the checks read 0 whatever the agent writes.
- task_11's 20 checks cover 0% effectively, with an algebraic proof: a fully articulated
  three-statement model balances *identically for any driver value*. init and golden carry
  different assumptions and the same twenty zeros.
- task_07's 16 "Cash Balance Check" cells are algebraic tautologies — identically zero for
  any workbook state.
- task_05's "Balance check" is an **anti-signal**: non-zero in the golden. An agent driving
  it to zero destroys correct work.
- task_15 row 66 is a decoy — a "Reconciliation" row broken at −40,000 *in the golden*.
- Measured on task_15: checks catch **7 of 7** balance-sheet sourcing rows and **0 of 13**
  P&L sourcing rows. That is structural to three-statement models, not a quirk of one file.

The `/12` error — booking an annual salary monthly — turns task_15's net earnings from
+76,756 into **−931,143** while all 23 reconciliation cells read exactly 0.00.

## What is actually there instead: redundancy, not comparison

- **Historical twin blocks.** task_15's rows 105–191 mirror rows 5–91 at a constant +100
  offset: 56/56 labels identical, and **35 of 56 golden formulas are the historical formula
  with refs shifted +100**. The 21 that differ are exactly the 20 sourcing rows plus retained
  earnings. The twin catches the `/12` error as a 16× break. This is the largest unexploited
  lever we have found, and it points at our worst task.
- **Hardcoded anchor columns.** task_02's three historical columns yield 8 exact footings,
  pinning 8 of 17 output rows with no reference to the answer.
- **Orphan topology.** task_09's `D24` has zero consumers; `L24` has five and is wired into
  `D29` via the `WACC` defined name. The workbook states which cell is live — this is what
  would have caught our most persistent bug.
- **Conservation among input constants.** task_10's `Drivers!C37 = 914` and `C38:C43` sum to
  exactly 914, visible before any work. It catches the "102 is per-year" misreading.
- **Latent control totals.** task_04's unlabelled re-aggregation gives 280 exact constraints
  over all 19,024 graded cells.
- **Label→header disambiguation.** task_08 and task_14 both fail right-row-wrong-column.
  task_08's row-10 label "Offer Premium to Last Trade" is the only thing naming the correct
  column — with a trap: "A to B" means A/B−1 in rows 10–12 and B/A−1 in row 13.

Two tasks have nothing at all. task_03 and task_08 are blank-output tables with zero
redundancy; task_13 returns six candidates and all six are false positives.

Every item above is a *fact about the workbook*, derivable from init.xlsx alone. None of them
is a verification phase. They belong in the map.
