# v5 — the gate works, and it exposed what actually fails. 45/74.

Two runs better than v4b, which on five seeds is nothing. The number is not the result.
The result is that forcing an adjudicated diff before completion let us read every
failure by cause for the first time, and the answer is not what four versions of prompt
work assumed.

```
pass         43/75  ->  45/74
median turns     6  ->  9-22
cost                     $49.50
```

## The agent's biggest problem is not reasoning

Of 29 failures, the single largest class is the agent changing cells it was never asked
to touch:

```
task_10 s5   740/740 cells -- perfect -- then 218 protected cells destroyed
             110 cell_content, 54 font, 54 number_format, all in D&A Schedule
task_12 s5   375 protected cell_content changes, every seed in the 284-377 band
task_07 s1   15 number_format changes at Meta Drivers!G19-G21
task_07 s3   15 font + 15 fill at the SAME cells
task_09 s2   21/21 cells -- perfect -- lost on ONE cell_content at Cash Flow Valuation!E45
```

Four of the 29 failures had a flawless cell score and died purely on preservation. One of
them died on a single cell. task_12 has never passed in 25+ runs and now we know why:
it destroys 300-400 protected cells in every seed, so no amount of reasoning improvement
can ever pass it.

## And the gate saw all of it, and approved it

`ReviewTools.restore` was invoked **zero times in 75 runs**. Every group, every seed, the
model chose `keep`. The gate detected the changes, presented them, and the model waved
them through.

task_07 shows the mechanism. The agent legitimately wrote values into `Meta Drivers`.
Doing so collaterally changed the number format (s1) or the font and fill (s3) on those
same cells. Shown a changed-property group covering those cells, the model reasoned "yes,
I changed that deliberately" — because it had deliberately changed the *value*. The
styling rode along in the same group and was kept with it.

So the defect is not the mechanism. `restore` is already per-property and its conformance
test asserts exact type preservation. The defect is that `keep` is free and `restore`
costs effort, and the model has no notion of which cells are protected — that is the
grader's concept and nothing in the prompt or map carries it.

## The regressions are not the gate

task_07 went 4/5 -> 2/5 and task_04 5/5 -> 3/5, which looked like gate damage. It is not:

- `restore` never ran, so the gate never wrote to any workbook.
- The gate's extra turns produced only reads. task_07 s1's two post-review tool calls are
  `getValues`, `getFormulas`, `getNumberFormats`, `getDisplayValue` — evidence gathering.
- task_04's two failures scored an identical 15288/19024 with **zero** violations.
  Deterministic, and formatting is not involved at all.

On five samples, 4/5 -> 2/5 is unremarkable. The honest read of v5 is a modest real gain,
not the +13/-6 the per-task deltas suggest.

## Two mechanical defects worth naming

**Sign flips, exact magnitude.** Two unrelated tasks, same defect, opposite directions:

```
task_13 s5   Valuation Output!I7,I10,I11,I12   got -0.282191   want +0.282191
task_10 s3   D&A Schedule!C11-C14             got +378.4071   want -378.4071
```

There is no global "expenses are negative" rule to apply — the convention is per-block and
readable from the row label. A stated sign prediction before writing, checked against the
recalculated value, catches the whole class in one turn.

**Cells never written.** task_10 s2 lost on 11 cells at `Operating Valuation!E46` onward,
all `wrong_value,formula_required` with `got None`. The agent stopped short of row 46.
Not reasoning — coverage, and self-checkable with no golden: re-read the declared output
region after writing and assert nothing is empty.

## What v5 establishes for v6

The prompt is not where the remaining points are. Four versions of prompt work moved
32 -> 45, and the failure census says the next block of passes is in adjudication
defaults, not in better instructions:

- Classify every changed group as inside or outside the task's output region, and invert
  the default outside it — restore unless keeping is justified.
- Separate a value change from a style change to the same cell. Writing a value never
  licenses restyling.
- Predict sign and magnitude from the row label before writing; compare after recalc.
- Assert the declared output region is fully populated before finishing.

The first two address task_07, task_09, task_10 and unblock task_12. The second two
address task_13 and task_10's remaining failures.
