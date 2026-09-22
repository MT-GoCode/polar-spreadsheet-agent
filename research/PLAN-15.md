# Plan to 15/15 — plain English

## What's actually wrong

The agent writes a formula, copies it across a block, and never finds out it was wrong.
Every check it writes, it also invents — so a confident mistake passes.

The tasks you pass need 1–2 distinct formulas. The tasks you never pass need 50–94.
t12's 2,260 wrong cells are **4 wrong formulas** copied across 48 months. So the job is
not "get more cells right", it's "get ~60 decisions right, and catch the ones you didn't".

## Where each task stands

| passing | t02 t03 t06 t09 t11 |
| 3 cells away | t14 (0.80 — scale), t13 (0.97 — one sign), t05 (2 cells) |
| a few formulas away | t01 (1 routing), t08 (1 row), t10 (1 column) |
| a handful of roots | t12 (3), t15 (~4 roots cascading into 29 rows) |

## Order of work

### Stage 0 — half a day, fixes t14 and part of t12
1. **Unit instructions only apply to the cells the task names.** t14 was told "deal size in
   trillions", got that cell right, then divided three more rows by 1000 that never asked.
2. **A row labelled "Total…" must add up its own block.** t12's "Total Levered Cash Flows"
   adds rows 35–38 when it should add 30–34 and 36–38.

### Stage 1 — one day, fixes t14 t08 t13
3. **Check the size of a number against the cell's existing format.** t14's cells are
   formatted `"$"0.0,"B"` — that format already divides by 1000, so the agent dividing again
   made everything 1000× too small. The format is right there and nobody reads it.
4. **Show the heading of every column the agent points at, before the write lands.** t08 built
   "Pre-Offering Equity Value" from a column headed "Offer Price / Share".
5. **Show the neighbouring column that already does the same job, including its sign.** t13
   writes "Offer-Price Discount" as negative; the column beside it is "Equity Value Discount",
   already written by the author, and it's positive.

### Stage 2 — one day, fixes t12 t13, helps t05 t10 t01
6. **The agent names a sum/difference/ratio; the harness does the maths.** Rule: every cell in
   the relation must be one the agent is not allowed to write. Then it cannot fake it.
   - t12: interest must equal −(balance × rate ÷ 12) for the first 24 months, principal must
     be 0, and after that principal + interest must stay constant. All three inputs are fixed
     cells. I checked: these hold exactly on the correct answer.
   - t13: the failing cell equals one pre-existing cell divided by another.
   - Coverage measured: t05 78%, t10 44%, t01 42%, t13 34%, t15 24% of scored cells.

### Stage 3 — one day, fixes t15 and t01
7. **Use the checks the spreadsheet's author already wrote.** 211 of them across 8 of your 15
   files — balance tie-outs, reconciliations, footings. They read 0 or "OK" before the agent
   starts; make it a hard failure if they don't afterwards. t15 has 56. Proof it works: in one
   run t15's reconciliation row went from 0 to −149,746 and the harness saw it.

### Stage 4 — one day, makes stages 1–3 affordable on the big tasks
8. **Check each distinct formula once, not each cell.** 61 checks on t12, not 2,260.
9. **Merge formulas wherever the sheet allows.** Fewer decisions is the only change that helps
   multiplicatively — one formula covering everything is why t03 and t06 always pass.

### Stage 5 — half a day, helps everything
10. **Stop feeding the agent its whole conversation.** It carries 20–74 turns of its own
    passing checks and stops being able to reconsider. Keep the map, the plan, a running list
    of facts the harness established, and the last few observations. Keep the front of the
    prompt stable so caching survives.

### Stage 6 — one day, mops up what's left
11. **Redo an uncertain formula two different ways** — once from the labels, once by copying the
    neighbour's pattern — and compare the numbers, not the text.
12. **If three attempts at one formula disagree, look again at that formula.** Never take the
    majority: t13's sign is wrong the same way in 5 of 6 tries, so a vote picks the wrong answer.

### Stage 7 — alongside everything
13. **Get more tasks to test on.** Your 15-task score swings ±3 between identical runs (measured
    20, 24, 21 on the same code), so today you cannot tell whether a change helped.
    SpreadsheetBench 2 ships 100 finance tasks; finished public valuation models become tasks
    by blanking cells.
14. **Give the agent worked examples.** The prompt is ~100 lines of rules and zero examples.
    Point it at the solved half of the same workbook.

## How you know it worked

- Free checks after every change: the two test suites (49 + 41 assertions today).
- Per task, not in total: the total is too noisy to read.
- Run the tasks that could get worse, not all of them — only tasks that already pass can regress.
- Before building stages 2–3, hand the agent the right answer for one disputed decision per
  failing task and re-run. If the task then passes, the mechanism is worth building. If it
  still fails, something else is wrong and you'd have built the wrong thing.

## Honest risks

- **`derived` still lets the agent choose the relationship**, even though the harness owns the
  cells. It can assert a wrong identity. Enforce the cells mechanically and make every check
  report what it proved, not just "passed".
- **t12's amortising months** are pinned by the constant-payment identity, but the exact loan
  term argument is not. This is the weakest link in the plan.
- **Nothing is certified until it runs online.** Every number here is marked provisional;
  only a real Apps Script run with a settled recalculation counts. t14 has now run offline
  once and has never run online.
- I built three things in the last round that had to be deleted. Build the cheap deterministic
  ones first and measure each one before moving on.
