# What the agent actually did — 75 runs, version 1

40% of runs pass. Three tasks pass every single time (02, 03, 05), four are coin-flips
(01, 06, 11 lean pass; 08, 14 lean fail), and seven never pass once in five tries (04, 07,
09, 10, 12, 13, 15). That distribution is the whole story, and the thing to understand
first is that it is **bimodal, not noisy**. Tasks do not scatter around some mean
competence. They either land in the basin where the agent gets it, or they land in a basin
where it gets the same thing wrong every time, often to the digit.

The single most important fact in this data: **17 of 75 runs produced a completely correct
answer and failed anyway.** Twelve of them scored every graded output cell correctly and
died purely on preservation — touching something they weren't allowed to touch. Five more
had numerically perfect values and died purely on `formula_required` — right number, wrong
kind of cell. That is 23 percentage points of pass rate sitting behind two mechanical rules
that have nothing to do with financial reasoning. The model already knows the finance in
those runs. It loses on bookkeeping.

## The agent does not understand that it is a guest in someone else's workbook

This is the dominant failure theme and it shows up in four different tasks.

**task_09 is the purest example, and it is one line of code, five times out of five.** The
prompt says, in plain English: *"Keep the supporting median unlevered beta in L24."* Keep.
As in leave it alone. The agent writes:

```js
sh.getRange('L24').setFormula('=L23/SQRT(F10)*(1-F11)');
```

every single seed. Its output score is 21/21 — perfect, every graded cell — and it fails on
exactly one violation. It read "median unlevered beta ... in L24" and heard an instruction
to produce one. And the tell is what happens next: the following tool call reads L24 back
and logs it, confirming the write landed. The agent verifies that it succeeded at doing the
thing. It never once asks whether it was allowed to do the thing. That asymmetry —
thorough self-verification of execution, zero self-verification of authorization — runs
through every preservation failure in this set.

**task_07 loses on formatting, also 5/5, also with a perfect 25/25 output score.** It calls
`getRange('G19:K21').setNumberFormat('0.0%;\\(0.0%\\)')`. The task permits exactly one style
change in the entire workbook: a border on M20:M21. Everything else is frozen. The agent
also wrote `B20` when the editable cell was `B19` — a straight off-by-one into a protected
cell. Worth noting what it got *right*: its border write landed precisely on M20:M21, the
one legal target. It can be surgical. It just doesn't know which surfaces are hot, and it
treats "make this look right" as obviously within remit when the grader treats styling as a
separate protected axis with its own violations for font, fill, number_format and border.

**task_11 seed 2 is the narrowest miss in the entire sweep**: 263/263 output, one violation,
a write to `Cash Flow Valuation!F8`. Same task passes 4 of 5 other times. Nothing
distinguishes the failing run except that it reached one cell further than it needed to.

**task_10 seed 5 scored 740/740 — a flawless answer — and failed on 22 preservation
violations.** Its other seeds score 707–729, so this is the one run where the agent fully
solved the math, and it still lost, on blast radius alone.

The pattern across all of these: the agent's model of the task is "produce the correct
end state." The grader's model is "produce the correct end state *and change nothing
else*." Those come apart constantly, and the agent has no representation of the second
half at all. It never enumerates what it is about to touch, and it never looks back at what
it did touch.

## It writes answers where the workbook wanted formulas

**task_04 scores 0 out of 19,024 on every seed.** Not 0 because it failed — 0 because of a
category error. It reads the Data Set tab, aggregates the cohort figures correctly in
JavaScript, and pastes the results with one `setValues()`. The grader reports
`formula_required` on every cell with `expected == actual`. Every number is right. Every
cell is wrong.

The prompt is one sentence — *"Complete the Monthly Cohort Detail - Actual Values section of
the Monthly Cohorts tab using the Data Set tab"* — and never says "formula". But across the
whole benchmark, **24,778 of 25,186 graded output cells require a live formula, and exactly
7 require a hardcoded literal.** This is not a quirk of task_04; it is the near-universal
convention of the entire corpus, and it is the convention of financial modelling generally.
A human analyst opening this workbook would see that every neighbouring cell in the section
is a formula and would match it without being told. The agent does not look at its
neighbours. It looks at the task, computes, and pastes.

task_08 seed 4 is the same failure in miniature: 133 cells, all `formula_required`, all with
the correct value sitting in them.

This is the cheapest category of loss in the whole dataset, because the reasoning is already
done and correct. The agent is failing a convention nobody stated, and that it could have
inferred from the cell immediately to the left of where it was writing.

## Signs

**task_13 fails on six cells and nothing else, three seeds running** (168/174 on s1, s4, s5).
The cells are `Valuation Output!I7:I12`, and every one is the correct magnitude with the
wrong sign: it produces −0.282191 where +0.282191 is wanted. It linked `I7:I12` to
`'Scenario Engine'!D7:D12`, a column that stores the negation of what the label describes.
The agent wired up a reference that was structurally plausible and never asked whether a
cell labelled as a premium should be showing negative.

**task_10 seed 1 does the same thing at scale** — `D&A Schedule!C11:C…`, every value
sign-flipped, 378.4 where −378.4 is wanted, hundreds of cells.

Sign is the single most common *arithmetic* error in this dataset, and it is the one that a
model should be best equipped to catch, because the sheets label their own conventions.
task_15's prompt literally specifies them ("expenses ... as positive numbers", "cash outflow
... negative"). The agent reads the prompt, writes the formulas, and never audits the output
against the labels it just read.

## The tasks it will never get by trying again

**task_15 scored 395/728 on five out of five seeds. Identical. Every time.** 333 wrong cells,
clustered 13 wide across columns H:T over ~26 line items in rows 108–190 — one bad line item
cascading through a forecast, reproduced exactly. There is no stochastic path from here to a
pass. Zero variance at a score far below the gate is the signature of a stable wrong
world-model, not a sampling problem. More attempts will produce more 395s.

**task_12 is the opposite shape and just as discouraging**: 1179, 1470, 2035, 2073, 2120 out
of 2279. Enormous variance — and the ceiling never came near 1.0 across five samples of a
2,279-cell task. Variance without a ceiling means the agent isn't reliably representing the
underlying convention (something about the monthly compounding), so each run lands somewhere
different on the wrong manifold. I would not bet on this one.

Contrast **task_01**, which has exactly two attractors: 95/95 and 75/95. The failures are all
the same failure — every wrong cell off by a constant 2.5147, one missing term in the PIK
rollforward. It either includes the term or it doesn't. Four of six samples include it.
That's a real coin-flip on a single modelling decision, and it is genuinely reachable.

**task_06** fails by a hair when it fails: 390/392, and the two wrong cells are 899.93 vs
943.98 — close but not a rounding artifact, a real difference in a growth calculation.
**task_14** swings between 15/15, 13/15 and 12/15 on tiny sheets. **task_08** is the
sharpest bimodality in the set: 168/168 twice, 120/168 twice, 35/168 once. Those aren't
degradations of one approach; they're three different approaches, one right.

## It quits early, every time

**74 of 75 runs ended because the model decided it was finished.** Not one run hit the
20-minute deadline. Median 8 tool calls, maximum 19. On tasks it was actively failing, the
agent was walking away with roughly 60% of its turn budget and most of its wall clock
unspent.

This is not laziness in the usual sense — it genuinely believes it is done, and it says so
in a confident, accurate summary of the work it performed. The summaries are good. They
describe what it changed and why, and they are almost always true. What they never contain
is any doubt, any check, or any acknowledgement that the workbook contains things it might
have broken. The agent finishes when it has executed its plan, not when it has verified an
outcome.

## What this says about the model

It is easy to look at 40% and conclude the model is too weak. The data doesn't support that
reading. On task_07 and task_09 it produces perfect answers. On task_04 it produces perfect
values. On task_10 seed 5 it produces a perfect 740/740. On task_13 it gets 168 of 174 cells
right and loses on a sign. The finance is mostly there.

What is missing is entirely procedural: knowing that a live formula is the default unit of a
financial model, knowing that styling is graded, knowing that "keep" means don't touch,
knowing to check a signed figure against its own label, and knowing to look back over the
blast radius before declaring victory. Five of the seven never-passing tasks fail on one of
those five things. Only task_15 — and probably task_12 — look like genuine capability walls.

The gap between "can compute the answer" and "can deliver the answer without collateral
damage" is where this benchmark actually lives, and version 1 does nothing to close it.
