# v6 — preservation solved, and the score did not move. 43/74.

Identical to v5's 45/74 within noise, and that flatness is the finding. Three targeted
fixes each hit precisely what they aimed at, three unrelated tasks lost the same number
of runs to wrong values, and the net was zero. What changed is not the number but the
shape of what is left.

```
task_09   2/5 -> 5/5   +3   clean, first time in any version
task_07   1/5 -> 3/5   +2
task_04   4/5 -> 5/5   +1
task_01   3/5 -> 1/5   -2   wrong_value x85
task_10   3/5 -> 1/5   -2   wrong_value x33, formula_required x11
task_08   3/5 -> 2/5   -1   wrong_value x75
task_14   1/5 -> 0/5   -1   wrong_value x10
```

## The three fixes worked, exactly and verifiably

**task_09 is solved.** It had never exceeded 2/5 in six versions, and every failure was
one cell: `Cash Flow Valuation!L24`, where the agent retyped

    =L23/SQRT(Market_Correlation)*(1-Buyer_Diversification)

as `=L23/SQRT($F$10)*(1-$F$11)` — the same number, named ranges swapped for coordinates,
and the grader compares text. The new alarm catches that shape directly: a formula whose
text changed while its computed value did not. It fired on L24 in two runs, the agent
restored the original, and the task went 5/5 clean.

**task_07's borders came back.** `offset_borders` failures went 3 -> 1, returning to the
v5 baseline. That regression had been self-inflicted: the mid-run alarm asserted
formatting is almost never required, on the one task that grades borders as the answer.
Two v6-era runs had perfect values, zero preservation violations, and failed solely for
not setting formatting the alarm was telling them to undo.

**The blank-fill fix restored the alarm's credibility.** Counting `blank -> formula` as a
change to something pre-existing made task_09's alert announce 68 changed properties whose
first three examples were the agent's own `=MEDIAN(...)` fills. 18 of 19 content entries
were noise. The agent discounted the whole alert, including the one real overwrite.

## Preservation is no longer the problem

Outside task_12, it has essentially vanished. task_09 clean, task_07's damage down to
number formats, task_04 5/5. task_12 remains its own category at 1,248 protected content
overwrites in five runs, and no prompt or alarm has moved it in any version.

Every one of the four regressions is `wrong_value`, with no preservation component at all.
Nothing in this version touches value selection, and on five seeds a 3/5 -> 1/5 move sits
inside the variance measured repeatedly across v1-v6. Treating those as real regressions
would be reading noise.

## What the flat score actually says

Six versions have now moved 32 -> 45 -> 43. Four of them were prompt work; this one was
mechanism. Both have converged on the same wall: the agent's remaining failures are
choices about which source feeds a row and which convention applies, and neither better
instructions nor a stricter gate reaches them.

Three blind simulations run against task_12 and task_15 earlier made the same point from
the other side. On the decisions that matter, independent runs pick the *same* answer at
*45-60 confidence*, having never enumerated the alternative. That is not a compute
shortfall and not a discipline shortfall — sampling returns the identical answer, and a
gate has nothing to catch.

## Three hypotheses died here, which is worth more than the two runs

Each was plausible, each was checked against the transcripts, and each was wrong:

- Splitting review groups by property would convert KEEP into RESTORE. The report was
  *already* grouped by property, transition and contiguous range. The model saw
  `numberFormat` as its own group and kept it anyway.
- No-op restores were creating style violations. `ReviewTools.restore` was invoked **zero
  times in 75 runs**; the restore path had never executed.
- The row-reading prompt rule caused task_14's 1000x error. The transcript shows
  `='Pro Forma'!H21/1000` with the agent's own note about converting `$mm` to `$B`. It
  referenced another sheet, not a neighbouring column.

The discipline that matters is not the fix, it is reading the run before shipping the fix.
