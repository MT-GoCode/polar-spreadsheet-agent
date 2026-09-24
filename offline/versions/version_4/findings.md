# v4 — the map buys speed, not accuracy. 39/75, unchanged.

Same pass rate as v3, one third fewer turns. That is the whole result, and it is worth
stating plainly: a structured map of the workbook did not make this agent more correct.

```
pass rate      39/75  ->  39/75
median turns       9  ->      6
task_04 turns     20  ->      5
```

## What the map actually changed

The agent uses it — the turn counts are unambiguous. task_04 went from twenty turns to five,
task_03 from eight to four, task_06 nine to five. Those are tasks whose difficulty was
*finding the layout*: where the cohort grid starts, which column is period 1, what the
source region is. The map answers that in the first message and the exploration disappears.

Where turns barely moved — task_15 (18 -> 15), task_12 (19 -> 14) — the difficulty was never
layout. It is which driver to source and what convention to apply, and a map of shape does
not touch that. Those two remain 0/5, now across 25 runs and four versions.

So the map compresses the part of the job that was already being done correctly. The runs
are cheaper and shorter, and land in exactly the same place.

## The three tasks that moved, and why

**task_09: 1/5 -> 3/5.** The CONSUMERS layer emits

    Cash Flow Valuation r24   read: L24(1)   |   NO DIRECT REF: D24

which is precisely the distinction the agent got wrong in every earlier version — it
overwrote the live `L24` and left the dead `D24` that the prompt told it to clear.

**task_10: 0/5 -> 2/5.** First passes in four versions. ANCHORS reports
`Drivers!C37 = 914 = SUM(C38:C43)`, which settles whether the last amortisation line is a
per-year rate or a whole-period total — the misreading that plausibly explains the earlier
0/5s.

**task_08: 3/5 -> 0/5.** The only meaningful loss, and it cancels the two gains.

## task_08 is the interesting failure

Its two sheets contain **zero formulas**. `Offering Tape` is nineteen issuers by columns of
raw numbers; `Metric Matrix` is empty. There is no structure to report, so its map is the
smallest in the corpus (6.5 KB) and is almost entirely a label index. The whole difficulty
is *which column means what*, and that is decided by header text alone.

Every seed failed the same way:

    row 9 = INDEX('Offering Tape'!$G$8:$G$26, ...) * INDEX('Offering Tape'!$F$8:$F$26, ...)

`Pre-Deal Shares x Offer Price`, where `Pre-Deal Shares x Last Trading Price` is correct.
That is the identical error v1-v3 made — it just now happens in five seeds out of five
instead of two. Median turns fell 3 -> 2.

An honest limit on this: the v3 transcripts were deleted before this sweep, so the *turn
counts* can be compared but the transcripts cannot. The claim that the lost turn was a
verification turn is inference, not evidence. And 3/5 -> 0/5 on five samples is suggestive
rather than conclusive: if the true rate were 60%, a 0/5 result has roughly a 1% chance per
task, but across fifteen tasks seeing one such drop somewhere is about 14%.

What is certain: the map gives the agent a complete account of *where everything is*, and on
the one task where knowing where everything is does not help, it stopped looking sooner and
got the same thing wrong more often.

## The failure population is unchanged in shape

Still overwhelmingly wrong output rather than preservation damage, exactly as in v2 and v3.
The map did not convert a single wrong-value failure into a right one except on task_09 and
task_10, where it supplied a specific missing fact rather than better structure.

Three tasks have now passed 5/5 in every version (02, 03, 05, and task_04 joins them here).
Two have passed 0/5 in every version across 25 runs each (12, 15). The middle third is what
moves, and it moves both ways.

## What this says about the next step

The map bought roughly a third of the turn budget back. That budget is the thing a
verification pass would need and previously did not have — the agent was already quitting
voluntarily at a median of 8 or 9 turns, and now quits at 6, well short of any limit.

The measured obstacle is unchanged since v1: the agent can find any value and cannot
reliably tell what it means. Layout was never the binding constraint; it was simply the part
that was easiest to fix.
