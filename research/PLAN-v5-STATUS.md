# PLAN v5 — implementation record

Branch `plan-v5`. Deterministic gates at every commit: `node offline/conformance.mjs` (50)
and `node offline/toolpath_test.mjs` (33, up from 7). Both green.

## Done, with the evidence that verified it

| Item | Status | Verification |
|---|---|---|
| 0.1 sweep counts the real gate | done | re-tallying the 40 prior runs reproduces **21/40**, `score==1.0` 24/40, raw gate 11/40 — all three as predicted |
| 0.2 offline preservation corrections | done | `task_09` round-trip: 309 phantom violations vs raw init, **0** vs the baseline |
| 0.3 regrade_all rewritten | done | per-task × per-tag table; 3/3 on t01 t02 t03 t06 t09 t11, 0/3 on t07 t10 t12 t13 t15 |
| 0.4 `missing_submission_cache` | **diagnosed, no code needed** | all 35 cells are formulas evaluating to `""` where golden wants `0`; a real model error, already counted by `wrong_value`. Prompt corrected instead |
| 1.1 border tool | **dropped** | `init.xlsx` already holds the exact golden border on M20:M21, so `offset_borders` passes by doing nothing, and every `setBorder` call errored. No task needs to create a border |
| 1.2 format gate | done | `tNumFmt_` passed no `wantKinds`, so a formula target shadowed every format target and the tool refused unconditionally. Tool-path test both ways |
| 1.3 hatch closed for formats | done | test: hatch refuses `setNumberFormat` |
| 1.4 V3 format preservation | done | tests: fails an unlicensed change, passes a licensed one |
| 1.5 prompt corrected | done | the workflow line promised formats were not auto-checked |
| 2.1 reviewer off | done | tests: no PLAN REVIEW block, no adversary trace event, coverage event still emitted |
| 2.2 occupancy notice | done | tests: names the occupied cell, silent on an empty target |
| 3a header/series/labels/DV-CF/trim | done | t13's header now shows all 30 cells incl. `S`/`T`/`AD`/`AE`/`AF`; t10 shows `FY2023A..FY2035P`; fabricated `step 0` axes 7→0; DV/CF notices 44 sections→1 line; empty `formula groups:` headers 30 of 53→0 |
| 3b `rows` section | done | replaces blank blocks + column composition + old row structure. t12's Monthly Cash Flow now reads `r8-r12 ×5  E Tg` — content only in column E, F:BZ genuinely blank — with no "output area" claim |
| 3b number-format legend | done | the information whose absence caused t07's failure. Max 22 distinct formats per sheet, so uncapped |
| 3b budget scheme | **built then deleted** | see "limits" below |
| 4.2 provenance | done, scoped | new `equals_ref` (harness reads the reference, rejects a ref the model wrote) + **a plan with formula/value targets is refused unless it carries one `equals_old`/`equals_ref`/`waive`**. 4 tests |
| 4.3 format assertion | done | `fmtMatches_` read `decimals \|\| 0`, so an omitted field silently demanded zero decimals and false-failed every real format — the reason all three t09 seeds escaped via `waive`. Now validated |
| 4.4 V2c sandwiched holes | done | 3 tests incl. staircase-spared. Not licensable by any assertion |
| 4.5 UNVERIFIED reporting | done | test asserts the line and the 0%-coverage wording |
| 4.6 `equals` with no value | done | was a silent PASS (`NaN > NaN` is false). Refused at plan time |
| 5.1 hardcode lint deleted | done | 23 refusals + 11 warnings over two sweeps, 100% false positive, 0 errors caught. Test: a target quoting "hardcoded" is now accepted |
| 5.2 dead prompt lines | done | "Budget ~5 minutes" (23 of 40 runs exceeded it), the map-trust claim, the millions/trillions prior |
| 5.3 blank-assertion guidance | done | rewritten; it was the direct cause of t10's certified hole |
| 5.4 de-leaked task priors | done | the ramp, sign, move/shift and `+48.61bps` examples each mapped 1:1 to one task. `grep` for all of them returns nothing |
| 6.2 gates before a paid sweep | done | observed in the final sweep log: `gate ok: conformance -> 49 passed`, `gate ok: toolpath -> 42 passed` before any spend |
| 4.1 footprint vs run-start state | **withdrawn, with the reason** | not implementable as written: every legitimate fill writes cells that were blank at run start, and task_12's over-wide target already carried a plausible quote. The map fix (3b) removed the cause instead. The verbatim-quote check is the salvageable part and shipped |

## Code review round (6 findings, all verified before fixing)

| # | finding | fix |
|---|---|---|
| 1 | **critical**: `equals_ref` was missing from the sticky-failed-assertion carry whitelist while `Prompts.gs` promised it worked — any `equals_ref` that failed once could only be carried by a semantically wrong substitute or by giving up with `waive`, defeating the whole point of 4.2 | added to the whitelist; test |
| 2 | the hatch ban matched source text, so `var m='setF'+'ontColor'; range[m](...)` walked through it — and `offline_gate.py` forgives every font/fill violation on the premise that no tool can write font or fill, so the bypass would have reported a **false pass** | reject the syntax instead of chasing names: computed method calls, `Reflect`, `eval`, `new Function`, `.constructor`, `apply`/`call`/`bind`. Verified it blocks the bypass and not array indexing; 4 tests |
| 3 | `labelIndexLines_` showed up to 30 label runs but printed "+N more" against a stale threshold of 25, so 26–30 runs were shown in full **and** claimed as elided | one constant for both |
| 4 | V2c scanned up to four full target rows/columns per blank cell — O(N·(rows+cols)) | one O(target cells) pass recording per-row/column filled extents; the test is now O(1) per cell. **No budget or cap needed** |
| 5 | `baseline.mjs` created its temp dir and mutated `MOG_SESSION_DIR` outside the `try`, leaking both on an early throw | widened the `try` |
| 6 | dead code: `blankBlockLines_` (call site removed in 3b, reachable only from a conformance test that gave false confidence in an unreachable feature) and the 5000-row `DATA SHEET` shortcut, which fires on zero tasks and would have replaced the one perfect map with a single header line | both deleted, with the test |

## The self-authorization hole the regression sweep exposed

The 14-task sweep showed task_07 failing **again** at score 1.000 with 15 `number_format`
violations: the model declared a format target covering the cells, so V3 licensed it. Same
shape as the plan-footprint problem — the agent grants itself the permission the axis checks.

Closed by making quotes evidence rather than assertions. The harness holds the task prompt, so
a `format` target now needs a `prompt_quote` that appears **verbatim** in the task text, and
`set_number_format` additionally needs that quote to ask for a number format and not to be a
preservation instruction. Measured against all 15 task texts, the phrases
`number format|formatting|decimal place` select exactly the tasks whose specs require a format
change (08, 09, 14) and exclude task_07, whose only formatting instruction concerns a border.

## Measured effect so far (2-run smoke, `gpt-5.4`/medium, reviewer off)

| task | before (3 seeds) | after (1 seed) |
|---|---|---|
| t07 | 0/3, score 1.000, 45 real violations | **PASS**, 0 real violations, $0.411 |
| t13 | 0/3, scores 0.759 / 0.897 / 0.759 | score **0.9655**, 0 preservation violations, $1.094 |

t13's only remaining failure is column I, the sign flip listed under 4b as
harness-unfixable. `AD/AE/AF/T/X/Y` are all now correct, and the transcript shows the
model using the header names the old 15-cell cap had hidden.

## On limits, budgets and fallbacks

Everything speculative was removed, including machinery this plan itself had specified:

- **MAP_BUDGET + binary-search depth solver + MAP_DEPTH_MAX: deleted.** Full-detail maps
  measure 2.5–16KB, so the solver took its early-return path on all 15 workbooks.
- **Five scaling factors deleted** (0.375/0.35/0.625/0.2 + the knob) — they derived the old
  15/14/25/8 caps from a depth parameter: the same arbitrariness with more machinery.
- **The legend cap deleted** — measured max 22 distinct formats per sheet.
- **The `BIG_SHEET_CELLS * 6` category gate deleted** — it suppressed headers, hardcodes and
  the label index wholesale on large sheets.
- **The per-sheet 1800-byte cap and `trimClass_` deleted** — size now governs detail, not
  which sections exist.
- **Both silent fallbacks to raw `init.xlsx` deleted** — they reintroduced the phantom
  violations the baseline exists to cancel, i.e. quietly produced a wrong pass/fail. Now fatal.

What is left, each with the measurement that justifies it:

- `MAP_HEAD = 15`, one head/tail constant shared by the four lists that are genuinely
  unbounded: up to 120,586 distinct formulas, 22,385 labels, 44,775 numeric constants and
  1,356 row groups on a single sheet. Every elision states the true count.
- `EXPENSIVE_READ_CELLS = 20000`, renamed from `BIG_SHEET_CELLS` to say what it is: a runtime
  guard on `getFontColors`/`getDataValidations` (30–70s at 350k cells against a 6-minute
  execution limit). It suppresses nothing else.
- `DEADLINE_MS`, `MODEL_CALL_MIN_LEFT`, `HARD_RETURN_LEFT`, `MAX_OUT`: real platform limits.

Net for the map path: 8 magic numbers plus a 4-class trim policy → one head/tail constant
and one named runtime guard. Maps now render untrimmed at 3.2–26KB with zero empty sections.

## Not addressed, and why

Phase 4b's modelling errors are not harness bugs and no harness change fixes them:
t13 column I (sign), t05 `D107`/`E107` (identical in two seeds, so more seeds will not help),
t08's 48 cells, t10/t12 output values, t15 (~46% of cells wrong). One generic,
domain-decoupled prompt line on reading sign conventions from an existing sibling column was
added; anything more specific would be encoding benchmark answers, which 5.4 exists to remove.

t14 still cannot run offline (the shim throws on DV and CF, read and write) and has never
been run. t04 needs ~425s for one full recalc against a 6-minute online limit.
