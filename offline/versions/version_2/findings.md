# What changed, and what the agent did — 75 runs, version 2

**42.7% → 50.7%.** Same loop, same tools, same model. A bigger prompt and two harness bugs
fixed. Eight points, of which roughly five are the prompt and three are us no longer
failing the agent for things it didn't do.

## The harness was lying about two tasks

**task_07 was unpassable.** Its known-correct solution — 25/25, every output cell right, no
agent anywhere near it — failed on ten style violations. mog omits `<bgColor/>` inside a
solid fill and `<scheme/>` inside a font; Google and Excel always write them. Nothing in the
Apps Script surface can set either: there is no `setBgColor`, and no scheme control at all.
So every task_07 result in v1 was a false red, and the runs I had been reading as agent
failures were nothing of the kind. Fixed by stripping exactly those two elements from both
sides before comparing — not a blanket amnesty, since a real recolor changes `fgColor` and
still fails.

**task_04's four hung runs were also us.** `setFormulaR1C1` went through a per-cell code
path, so the agent's single batched call over 19,024 cells became 19,024 sequential engine
round-trips, each triggering a recalculation. Four of five v2 runs were still burning 240%
CPU after 28 minutes. Batched into one op: **1.657 seconds**. Real Apps Script batches this
natively, so the old path was punishing the agent for writing idiomatic code.

Both matter beyond their own tasks: they are the two places where a FAIL did not mean the
agent failed, which is the only property of this harness worth anything.

## task_04: the clearest win available

0/4 → **5/5, every seed perfect at 19024/19024.** The largest task on the benchmark, now the
most reliable after 03 and 05.

The diagnosis in v1 was right: every seed computed the cohort aggregation correctly in
JavaScript and pasted 19,024 literals. The numbers were right; the representation was wrong.
The system prompt's own batching advice — "on a large sheet that is the difference between
seconds and an hour" — read as permission to paste. Closing that hatch ("batching means one
setFormulas call over formula strings; grid size is never a reason to paste results") fixed it
outright. One sentence, one task, 0 → 5.

## Where the failures now live

```
output PERFECT, killed by preservation :  5   (v1: 10)
output WRONG                           : 32   (v1: 33)
```

The preservation bucket halved without a single guard being built — the prompt did some of it,
the bgColor fix the rest. **86% of what remains is wrong output.** That is the whole argument
for investing in a better workbook map rather than in snapshot/revert machinery: guards have a
ceiling of about five runs.

And the survivors are not near-misses. Among output-wrong runs the median score fell from
0.759 to 0.589, and **zero are now within 2% of perfect** (v1 had one). The easy ones converted;
what is left is structural.

## The prompt regressed four tasks, and two lines are to blame

Gains and losses are nearly the same size: roughly +8 runs won, −4 lost. The losses are not
noise, and both mechanisms are traceable to specific sentences I added.

**"One formula, consistent across the whole projection row."** This is false for every
rollforward. Rows where month 1 genuinely differs from month 2:

```
task_12  52    task_10  34    task_15  14    task_06  14    task_14  13
```

task_15's retained earnings is `Jan =0+H135+H186`, `Feb =H162+I135+I186`. Its beginning cash
is blank in January and `=H191` from February on. **task_14 regressed 2/5 → 0/5 and has 13
such rows** — it is a rollforward-heavy task and the prompt told the agent that varying a
formula mid-row is "the commonest silent error."

**"Words like keep, retain, leave and preserve name cells you must NOT change."** This one
collides with vocabulary. task_01's prompt says "retained earnings" — a noun phrase, not an
instruction — and the retained-earnings row is exactly what its PIK rollforward must write.
**task_01 regressed 4/6 → 2/5.** task_14 fails the other way: "keep the original font color"
is a *conditional*, so sometimes the agent should change it, and the rule reads as absolute.

Both are narrowable rather than removable: scope the consistency rule to blocks driven the
same way, excluding a rollforward's first period; scope the keep rule to when the task names
a specific cell.

The canary held the same story. task_02 was 5/5 with nothing in the new text aimed at it, and
dropped a seed. A 7 KB prompt is near the limit of what more text buys.

## The two tasks nothing moves — and the oracle sitting unused in both

task_12 and task_15 are **0/10 across both prompts**. They are also, by a wide margin, the two
tasks carrying the most self-checking machinery downstream of the agent's own output:

```
task_15  117 checks    task_12  77    task_01  40    task_07  30    task_05  5
seven tasks have none at all
```

That is not a coincidence. Big linked models ship reconciliation rows *because* they are big.

**What task_15 actually is:** a complete three-statement financial model built from scratch for
twelve monthly periods — income statement (rows 108–136), balance sheet (140–164), cash flow
(170–191). 56 output rows × 13 columns. But only **20 rows are real sourcing decisions**
(which `Control Center` driver, divided by 12 or not, what sign); 31 follow mechanically from
accounting identity; 5 are deliberately blank.

The rows are heavily interdependent by design. `Sales — Total` feeds five rows as a
percentage. `Net Earnings` feeds retained earnings, the cash flow statement, and the dividend
calc. `Cash & Equivalents = H191`, the ending cash from the cash flow statement — closing the
loop back into the balance sheet. **That is why one wrong line item produces 333 wrong cells,
identically, on all five seeds.**

And the check is right there: `Forecast Model!H166 = H148 − H164` — total assets minus total
liabilities and equity, one per month. A correct model makes it zero. Fourteen of those
reference the agent's output directly.

This is what makes "just let the model reason more" the wrong frame. More reasoning tokens
without a signal is a random walk, and we measured it going backwards: task_14 seed 4 wrote the
correct reference at turn 13 and talked itself into the wrong one by turn 16; task_08 seed 3
wrote the correct formula at turn 2 and "corrected" it to the wrong one at turn 3. Failing runs
average more turns than passing ones (10.7 vs 9.0). The model cannot tell whether row 146's
rollforward is right by thinking harder about row 146 — but it *can* tell that assets don't
equal liabilities plus equity in March, which localises the error to that month's twenty rows.

## What the agent still gets wrong, by mechanism

- **Wrong source column.** task_08 built "Pre-Offering Equity Value" from a column headed
  "Offer Price / Share" where "Last Trading Price" was correct — 48 cells dead from one
  reference, twice. The headers were in its context. This is a semantics failure, not a
  lookup failure.
- **Sign against label.** task_13 links `I7:I12` to a column storing the negation of what the
  label says; every value is the right magnitude, wrong sign.
- **Variance from re-deriving structure.** task_08 scores 168/168, 120/168 and 35/168 across
  seeds — three different approaches, one right. The agent rebuilds its understanding of the
  workbook from raw blocks every run and lands somewhere different each time.

All three are the same underlying gap: the agent can find any value, and cannot reliably tell
what the value *means*.
