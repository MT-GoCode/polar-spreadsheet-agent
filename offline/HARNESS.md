# gas-offline — run Apps Script offline, graded by the real grader

`runAgent({prompt, spreadsheetId})` ships as real Google Apps Script against a real Google
Sheet. Iterating there is capped by Google's quotas, so this harness runs **the same Apps
Script** against [`mog`](#the-mog-binary) — a headless engine with an Office.js-style API —
and scores the result with the **unmodified** grader from `repo-readonly/grader/`.

Three guarantees. Nothing else is claimed.

1. **Apps Script runs on it.** `shim/` implements the Spreadsheet Service surface, so the agent
   writes `SpreadsheetApp.getActiveSpreadsheet().getSheetByName(...).getRange(...).setFormula(...)`
   exactly as it would for Google. No dialect, no porting step.
2. **The original grader scores it.** `grader.google_grade` runs as-is. Nothing about the
   grader, the specs or the task fixtures is patched.
3. **The verdict is binary.** PASS means it would pass online. FAIL names the cell.

## Use it

```sh
npm run build                  # shim/*.js -> dist/appsscript.js
npm test                       # 26 unit + 4 integration (real Apps Script on real mog)
npm run maps                   # pre-build the map cache (all 15 at once)
npm run controls               # only if you CHANGE the mog binary; the control is tracked
npm run e2e task_09            # run an agent script end to end -> PASS or FAIL
```

**Verified 15/15** on the current binary (`a5a3269871187fc9`): a script that writes each
task's known-correct answer grades as PASS on all fifteen, through the unmodified grader.
`npm test` is 26/26 and 4/4.

`controls` must be re-run whenever the mog binary changes — and now it is enforced, not just
documented: the control records the binary's sha256 and `verdict.py` refuses a mismatch.
Every flow works in a temp dir and leaves nothing behind (`lib/scratch.py`, cleaned on
SIGINT/SIGTERM too). Only `out/controls.json` persists.

## Why the verdict can be binary

An offline grade contains failures the agent did not cause. mog writes the `.xlsx` differently
than Google does, and — decisively — offline the grader never runs
`native_preservation.reconcile()`, which online **discards whole classes of violation before
they count**. From `grader/native_preservation.py:63-120`:

| violation kind | what reconcile does online |
|---|---|
| `cell_content` | discards the export-derived ones, then **RE-DERIVES them** from `userEnteredValue` |
| `cell_style` | re-reads the style from the Sheets API, discards **only when unchanged** |
| `sheet_objects` | discards `conditional_formats` when equal; **everything else survives** |

**reconcile() is not subtractive.** An earlier version of this file claimed it "only ever
removes violations, so a PASS here cannot become a FAIL there". That is false at the source
(`native_preservation.py:99-119` ends with `result.extend(entered_violations)`), and the
classifier acted on it: it discounted **every** `cell_content` and `cell_style` violation.
An agent that clobbered a protected cell passed offline and scored zero online.

It never bit while the only thing under test was `e2e/make_solution.py`, a fixture that
writes nothing but golden answers into scored cells and so never touches a protected one.
A real agent writes wherever it likes.

Nothing is blanket-discounted. Every discount is either MEASURED or RECORDED.

**Measured** — `e2e/controls.py`, three runs per task with no agent involved, plus one diff:

- **baseline** — `grade(mog(init) -> mog(init))`, a no-op edit. Anything it reports, mog
  produced by itself. *Measured: 0 violations on all 15 tasks.*
- **golden** — `grade(mog(init) -> mog(golden))`, a workbook that *is* the correct answer.
  *Measured: every task scores 100%, including task_04's 19024/19024, so mog can represent
  every correct answer exactly.*
- **writepath** — a semantic no-op that still DIRTIES the graph: write a sentinel into every
  graded output cell then write the original content back, and re-apply each style-editable
  cell's own number format. A file round-trip cannot reproduce mog's real churn — nothing is
  dirty, so nothing recalculates. This is what catches mog adding `<scheme val="minor"/>` to
  any font it rewrites, which Google leaves absent (30 violations on task_09 alone).
- **lossy_cells** — `init.xlsx` vs `mog(init)`, per cell. If mog's own render of the
  untouched workbook already disagrees with the original, that cell is a mog blind spot.

Controls are stamped with the **sha256 of the binary that measured them**, and `verdict.py`
refuses to run against a mismatch. A floor measured on a noisier build silently forgives real
damage when reused with a cleaner one; nothing used to notice.

**Recorded** — `shim/10-runtime.js` logs, at the single write choke point, which sheets the
agent wrote to. A violation on a sheet it never wrote to is mog's: mog recalculates cells
that are literals in the file (task_15's `Formula Audit!D35`, -92884 -> 48048.72 when
`Forecast Model` is edited). No agent-free control can measure that, because reproducing it
requires changing values — which is what an agent does. Read-only ops are identified by RULE
(`get*`, `load`, `rangeQuery`); a hand-written list missed the two ops the shim issues at
load time and produced an empty record, which discounted *everything*. If the record cannot
be vouched for it returns `null`, and `null` discounts nothing.

`e2e/verdict.py` subtracts all of it. What remains is the agent's, reported as
`preservation: cell_style/fill at Valuation Output!AE7`.

This also absorbs quirks in the benchmark itself. task_08's shipped `golden.xlsx` fails its own
`output_number_formats` requirement: the spec demands `percent: false` on ranges where the
golden carries `0.0%;\(0.0%\);\-`. Grading Google's original golden against itself returns
`False`. The golden control records it, so it is never charged to the agent.

### Every violation kind, and why it is or is not the agent's

Preservation is not cosmetic: `scoring.py:138` puts `not violations` in the AND-chain, so one
violation fails the whole task — including on fields no spec grades. So the rule is **not**
"discount what isn't graded". It is **discount only what the agent could not have caused**.

`grader/scoring.py:67-89` emits exactly six kinds. All six are accounted for:

| kind | disposition | why |
|---|---|---|
| `cell_content` | **FAIL** unless measured | reconcile RE-DERIVES it online; only the controls, `lossy_cells` and the write record excuse it |
| `cell_style` | **FAIL** unless measured | discarded online only when the Sheets API says unchanged — a condition offline cannot evaluate, so it is judged, not forgiven |
| `sheet_objects` / `charts`, `pivots`, `tables` | discounted | **no API in the surface** — the agent cannot reach one |
| `sheet_objects` / `validations`, `conditional_formats` | **FAIL** | `shim/65-*`, `shim/66-*` implement these; an agent can genuinely change one |
| `sheet_structure`, `defined_names` | **FAIL** | agent can insert/rename sheets and named ranges |
| `sheet_layout` | **FAIL** | agent can set column widths and row heights |

The object kinds are fixed by `grader/workbook.py:186`. `verdict.py` does not hardcode which
are reachable — it reads `vocab/KEPT.txt`, the file the surface is generated from, and asks
whether the kind appears at all. `charts`, `pivots` and `tables` have **zero** members there;
the only occurrence of "chart" in all of `shim/` is one enum string. If a chart API is ever
added, the discount stops applying by itself.

## Dates

A workbook stores a date as a serial number and remembers it is a date only in the cell's
number format. Apps Script hides that, so the shim does too:

- `setValue(new Date(...))` converts to the serial (`dateToSerial`, `shim/30-range.js`).
  Without it mog rejected the Date outright — *"Range values must contain only strings,
  numbers, booleans, or null"* — which any agent writing a date would have hit.
- `getValue()`/`getValues()` return a real `Date` when the cell's number format is a date
  format (`serialToDate` + `isDateFormat`). Literals are stripped before sniffing, so
  `0.0"May"` and `_(#,##0_)` are not mistaken for dates.

**Not implemented:** real Sheets auto-applies a date format when you `setValue` a Date into a
`General` cell, so a round-trip through an unformatted cell returns the number, not a Date.
Verified irrelevant here — **zero** of the 24,776 graded output cells across all 15 tasks hold
a date value.

## The one known false red

`=A1+1` where `A1` is `=""`: mog follows Excel and errors, Google follows Sheets and coerces
to 0. Only bare `+ - * /` diverge — `SUM`, concatenation and comparison all agree. If an agent
writes that pattern, offline reports a new error cell and FAILs where online would pass.

It is a false **red**, never a false green, so guarantee 3's PASS direction is unaffected.
Patching mog's `arith_number()` to match was tried and reverted: it destabilised chart
serialisation on task_15. Documented instead of fixed.

## Layout

```
shim/           the Apps Script surface; numeric prefix = concatenation order
                20-enums.js and 90-spine.js are GENERATED from vocab/KEPT.txt
e2e/controls.py       measure the artifact floor      (once per binary)
e2e/verdict.py        binary PASS/FAIL + what failed
e2e/run_offline.py    one task, end to end
e2e/make_solution.py  builds a 'perfect agent' script from a golden
lib/scratch.py  self-cleaning temp dirs and mog sessions
conformance/    one-time validation that the shim matches real Apps Script
readparity/     one-time validation of read-path parity against a real Sheet
```

`make_solution.py` skips the non-anchor cells of an array formula's spill range. Writing them
individually is what Google rejects with *"You cannot change part of an array formula"* — and
the shim raises it identically, which is how the omission was found.

## Surface coverage

Generated from `vocab/KEPT.txt` by `gen-surface.mjs`, so the implemented surface cannot
silently drift from the agreed scope. **12 enum namespaces / 91 values** complete;
**379 of 409 members** implemented, 26 throwing `NotImplemented`, 4 out of scope.
`npm run coverage` counts a thrower as MISSING — a member that cannot fail is worse than no
member at all.

## The mog binary

Pinned at `c3d8e01e` with conditional-formatting patches only — see `MOG-VERSION.md`.
Upstream reworked XLSX export the week of 2026-09-15 and a `main` build serialises task_15's
charts differently. Do not rebuild from `main`. `verify-binary.sh` checks the pin.

## Two rules that cost the most to learn

- **The harness never writes an `.xlsx`.** An openpyxl re-save corrupted 32 cells in task_10
  and invented phantom cells, and all three resulting "mog defects" were mine.
- **Attribute before reporting.** A chart regression was blamed on upstream twice before an
  unpatched control run showed the patch caused it.

## Known limits, stated rather than hidden

- The write record is at **sheet** granularity. Sound, because damaging a protected cell
  requires writing to its sheet: a cross-sheet formula the agent authors changes a FORMULA
  cell, and `workbook.py:103 raw()` compares formula text there, not values.
- The write-path control exercises `setValue`/`setFormula`/`setNumberFormat` but **not**
  `setBorder`, data validation or conditional formats — operations task_07 and task_14
  legitimately need. Nothing fails on those today. But task_09's lesson was that a control
  which does not perform the agent's operations measures the wrong floor, so if task_07 or
  task_14 ever fails on style, look here first.
- `vkey` is `kind|sheet|cell|field|object`. Precise for cell-level kinds. Object violations
  are therefore never excused by a control key, since that key carries no object content.
- The `e2e` fixture is a generated "perfect agent". It proves a CORRECT answer grades as
  correct. That a WRONG answer grades as wrong is what `npm test` covers, by feeding the
  classifier deliberate damage. Both halves are needed.

## What this harness does not do

It does not replace an online run. `reconcile()` is **not** purely subtractive — it
re-derives `cell_content` from the native snapshot and keeps `cell_style` changes the Sheets
API confirms — so offline is not automatically a superset of online. What makes the verdict
trustworthy is that every discount is either MEASURED (baseline / golden controls, pinned to
the binary's sha256; `lossy_cells` from `init` vs `mog(init)`) or RECORDED (the sheets the
agent actually wrote, captured at the shim's single write choke point). None is assumed.

Known residual, stated rather than hidden: a violation is excused when it matches a control
key, and `vkey` is `kind|sheet|cell|field|object`. For cell-level kinds that is precise. The
write record is at SHEET granularity, which is sound because damaging a protected cell
requires writing to its sheet — a cross-sheet formula the agent authors changes a FORMULA
cell, and `workbook.py:103 raw()` compares formula text there, not values.

And the submission is Apps Script on Google. That is where it ultimately has to work.
