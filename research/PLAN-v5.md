# PLAN v5 (rev 2 — after adversarial review)

Baseline: 40 graded runs, 14 tasks × 3 seeds. `score==1.0` (what sweep reports) = 24/40. Real gate as graded = 11/40. Real gate with offline-engine artifacts removed = **21/40**. Clean 3/3: t01 t02 t03 t06 t09 t11. 1/3: t04 t05 t08. **Never: t07 t10 t12 t13 t15.** Agent's own verifier said PASS 40/40.

Root cause: every feedback loop closes inside the model's own beliefs — it declares the plan that defines the footprint V1 polices, authors the assertions that define correctness, gets a reviewer with no ground truth, and reads a map that labels its guesses `likely output areas`.

**Corrections applied in rev 2** (each was a real defect in rev 1, found by adversarial review and independently verified):
- Banning `setBorder` would have BROKEN t07: its `offset_borders` requirement **passes in all 3 seeds** via 5-9 `setBorder` calls through the hatch. A border tool is a prerequisite, not a cleanup item.
- The typed format gate is itself broken (`tNumFmt_` calls `guardWrite_` with no `wantKinds`, so `inTargets_` lets a formula target shadow a format target and refuses unconditionally). The hatch is the *workaround*. Banning it without fixing the gate breaks t08/s3 and t09 — both currently passing.
- t13 is NOT fixed by removing the adversary + fixing the map. Column I fails in 5 of 6 runs across both sweeps with an exact sign negation, and t13's best run ever (v2/s2, 0.966) fails on column I alone.
- Deleting `blank blocks` with "replacement: nothing" was wrong: the row-structure section is not a blank map (rows are dropped unless they have a formula AND a hole, capped at 8 groups, and trimmed first). The deletion is only safe once the new `rows` section exists.
- `waive` cannot be deleted yet: it is the pressure valve for a harness bug (`fmtMatches_` uses `decimals || 0`, and `tPlan_` never validates that a `format` assertion carries `decimals`, so every format with a decimal place false-fails). All 3 t09 seeds escape only via `waive`.
- Style signatures are max 130 / median 33 under the grader's definition, not 24. The number-format half of the legend is fine; the style half needs the grader's own field set or it lies.
- `verify_` already reads number formats for `format` assertions and `G.fmtBase` already snapshots them. The missing piece is a preservation *sweep*, not a new snapshot layer.
- Realistic ceiling is ~8-9 of 14, not 11-13.

---

## Phase 0 — Fix the measurement. Nothing later is trustworthy without it.

0.1 `offline/sweep.mjs:121` — pass = all outputs correct AND zero preservation violations AND all requirements AND no new errors. Not `score === 1`.
0.2 In the runner's grade step only (never in the grader), mirror what `native_preservation.reconcile` does online:
  (a) grade against a shim round-tripped `init.xlsx` as `--initial`;
  (b) ignore `font`/`fill` violations on cells inside **any populated `style_editable` field** — not just `number_format`. (t07 writes a border on M20:M21, which is permitted, and mog's style rewrite then fabricates font+fill violations there.)
  (c) forgive `cell_content` diffs where both sides are numbers equal within float tolerance.
0.3 Same in `tools/regrade_all.py`; stop printing "N perfect".
0.4 Investigate `missing_submission_cache` (35 cells: t10 ×22, t12 ×13; **0 in v2**). A formula with no cached value is graded wrong. Almost certainly mog not recalculating on write. Either correct it offline or confirm online — untouched, it alone blocks t10 and t12.
0.5 Sweep prints the per-task × per-seed table plus the honest total.

**Acceptance:** re-tallying the 40 existing runs reproduces **21/40** with 3/3 on t01 t02 t03 t06 t09 t11 and 0/3 on t07 t10 t12 t13 t15. All three corrections are necessary (dropping (a) → 12, (b) → 17, (c) → 18). Also reproduce 24/40 for `score==1` and 11/40 for the raw gate.

**Risk:** these are offline-only estimates. Never present them as the graded number.

---

## Phase 1 — t07: stop unrequested formatting. Values are 25/25 on every seed.

**Order inside the phase matters. Do not reorder.**

1.1 **Add a typed border tool** (`set_border`, gated on a `format` target). Prerequisite for everything else here.
1.2 **Fix the format gate**: `tNumFmt_` → `guardWrite_(sheet, range, ['format'])` so a formula target stops shadowing a format target. This is why the model uses the hatch at all. Re-test t08 and t09 immediately — both currently rely on the hatch workaround.
1.3 **Then** extend `HATCH_BAN` with `setNumberFormat|setNumberFormats|setHorizontalAlignment|setVerticalAlignment` and `setBorder`. (`setFont*` and `setBackground*` are already banned as substrings.) Better long-term: route hatch effects through `recordCell_` so the hatch stops being a superset of the typed tools.
1.4 **New verifier axis V3 = format/style preservation sweep.** Reuse `G.fmtBase` and extend it to a full run-start snapshot; compare using **the grader's field set** (`font, fill, border, alignment, protection, number_format`), not a coarse signature. Any cell whose style differs and is not covered by a `format` target FAILS. Must pass when a `format` target covers the cell, or it breaks t08/t09/t13.
1.5 Update `Prompts.gs:26-27`, which currently promises "It does NOT auto-check formats or validations you did not assert" — that becomes false.

**Dropped from rev 1:** the prompt-precedence edit. `Prompts.gs:49` already says "Number formats come from the TASK's words, not from neighbors. Change formats only when asked," and the clone line is explicitly about R1C1 patterns, not formatting. The rule exists and was violated 3/3. This needs the mechanical fix, not more prompt text.

**Acceptance:** t07 3/3. t08 and t09 unchanged. V3 fires on t10 (`style_editable: {}`, 249 format violations).

---

## Phase 2 — Remove the adversarial reviewer; keep the deterministic part.

Measured: 203 concerns = 12 correct / 9 wrong / 182 unfalsifiable. Never said `NO CONCERNS` in 40 runs. Net +1 real pass (t05/s1), −2 seeds on t13, −1 on t12. Cost $0.438 → $0.657 (**+50%**), wall 208s → 307s (**+48%**), replans 2×, +43.6s blocking latency.

2.1 Stop calling `adversaryReview_` (Code.gs:1519-1532); keep it behind a flag so the A/B is re-runnable.
2.2 Add a **plan-time** notice listing, per target, the cells inside it that were non-blank at run start, with their formulas. Note honestly: `tFill_`/`tWriteCells_` **already refuse** such writes at write time unless `force:true`, so the delta is earlier warning, not new protection. Smaller win than rev 1 claimed.
2.3 Keep the H4 anchor-independence WARN (17/40 in v3, 0/40 in v2) — it is the mechanism actually behind most of the assertion improvement credited to the reviewer.

**If keeping the reviewer instead**, minimum viable changes in priority order: (a) forbid it from prescribing formulas or expected values — naming a cell to check only; (b) require every claim to quote the read supporting it, "unknown" allowed; (c) forbid reconciling against hardcodes the task says to replace (the exact t13 mechanism — it reconciled `AD7` against a pre-fill cached `U7` and was arithmetically exact against a stale value); (d) drop checklist item 3 (57 of the 182 unfalsifiable bullets); (e) move the call to after the first verify failure. (a) alone kills the t13 regression.

**Acceptance:** t12/s3 no longer collapses to 0.429; cost and wall return toward v2 medians; no task regresses. **Not** "t13 fixed" — see Phase 4b.

**Known loss:** the reviewer's one clean win (t05/s1, duplicate "Cost of delivery" label) is not covered. Expect t05 to stay at 1/3 until the map names duplicate labels again.

---

## Phase 3 — Map rewrite. Ordering corrected: the new structure section must land BEFORE the deletion.

### 3a — Safe now, no dependency
- Delete the `cells.length < 15` header cap (Code.gs:408, :417). Replace the "first row with ≥3 non-blanks" rule with: **widest header row in the first few rows, tie broken toward more text cells, never the row already chosen as the series axis.** (Naive "widest" deletes t12's `hdr r2` and coin-flips t13, where rows 5 and 6 both have 30 cells.)
- Require `|d| > 1e-9` in `seriesInRow_` (Code.gs:377). Kills 7 fabricated `step 0` axes, loses no true positive.
- Emit DV/CF unavailability **once** at workbook level. 15.3% of all map bytes → ~145 bytes.
- Invert `trimClass_`: trim the font histogram, duplicate-label tails and unavailability notices before row structure and formula groups.
- Widen `labelIndexLines_` past columns A-D; allow two label columns (recovers t12's column-E labels and Investment Summary's A+H).

### 3b — The rewrite (must ship before, or with, the blank-blocks deletion)
A sheet is an array; print it like numpy. Per sheet: identity (shape + exact `F/V/T/X/E/.` census), a **number-format legend** as single-char codes (max 22 distinct, fits), a **style legend** using the grader's field set with two-char codes (max 130 distinct, does not fit one char), `rows` (one line per distinct consecutive row signature; horizontal runs collapsed; **absent column = blank**), `const` (literal values, vertical runs merged, row-major so a label shares a line with its numbers), `formulas` (existing R1C1 rect groups with `← source`, never mid-truncated), `dv`/`cf` when present.

Budget: one global depth `k`, binary-searched against one byte budget; each section shows first and last `k` items plus `[N of M elided at depth k]`. Max-min fair, so a section elides only if it personally has >2k items; every benchmark target sheet except t03/04/06 renders complete. No priority classes, so no boilerplate can outlive real structure. Every elision self-reports its true count.

Then delete: `blank blocks` (Code.gs:332-366), `headerLines_`, `seriesInRow_`, `labelIndexLines_`, `column composition`, the 5000-row `DATA SHEET` shortcut (fires on zero tasks), the font histogram, `HOT REF`, `constants in formula regions` as a detector, the errors section, the `BIG_SHEET_CELLS` gates, `trimClass_` and the 1800-byte cap. Constants surviving: `MAP_BUDGET`, `k >= 1`, `short_` 40, `full_` 10, code alphabet. **30+ magic numbers → 5.**

### 3c — Prompt changes shipping with 3b
Drop "blank blocks = likely output areas". Replace "The map is dense and trustworthy — peek only to verify anchors" (false: median 25 reads before first write) with per-feature confidence: headers, formula groups and counts are exact; formats are described by code; the map states what it elided — peek those middles and any formula value you depend on.

**Acceptance:** t10 and t12 preservation violations → 0; t13's dropped header names (R5-AF5) appear; **no task regresses pass→fail.** Note the specific danger: if the model loses its only write cue it will under-write, which the gate scores as an ordinary fail — so also watch cells-written counts, not just scores.

**Risks:** `rows` can explode on irregular bulk data (t03 `Sales Detail` = 1356 groups; fallback is non-consecutive group-by-signature). Removing `BIG_SHEET_CELLS` removes a runtime guard — time `describe()` on t03/04/06 first and keep a per-sheet try/catch that degrades with a stated reason. A wrong dtype code makes the map confidently lie: golden-file the legends for all 62 sheets against an openpyxl reference and assert legend counts sum to the non-blank cell count. Sweep the budget at 32K/64K/128K — the map is re-sent every turn.

---

## Phase 4 — Authorization, verifier, and the modelling errors. After Phase 3 is measured.

### 4a — Authorization and verifier
4.1 **Footprint against run-start state.** Honest caveat: the quote escape cannot be removed (t09 and t11, both clean, use `force:true` 8 and 21 times — that is the point of t11), and t12/s1's over-wide target already carried a plausible `prompt_quote`. So this is only structural if **the harness decides coverage** — the quote must name the cells/rows/columns it licenses. Otherwise 4.1 is a no-op on its own evidence.
4.2 **Provenance on `equals`.** Expected value must come from `old` (harness-supplied), `ref` (a cell the model did not write; harness reads it), `derived` (arithmetic over `ref` cells; harness evaluates), or `literal` — allowed only when the quoted clause says to hardcode. Enforceable because `G.writes` knows every touched cell: reject any `ref`/`derived` pointing at a written cell.
4.3 **Fix the `format` assertion first**, then prune: validate that `format` carries `decimals`/`percent` and fix `fmtMatches_`'s `decimals || 0` (Code.gs:2063). Only then delete `no_error` (657 uses, 0 failures, duplicates V5) and `waive` (34 uses, currently the escape hatch for the bug above). Convert `blank` from a check into a declaration V2b consults, so it stops suppressing the axis that would complain.
4.4 **Region-continuity ("sandwich") check** — interior blank with filled neighbours both sides fails unless a quoted clause covers it. Targets are real and well chosen: t04/s2 `Monthly Cohorts` row 56 (116 cells, `actual: None`) and t10/s3 `D&A Schedule` C11:C21 (11 cells) — the latter is the *only* thing between t10/s3 at 0.985 and a pass.
4.5 Let `verify_` return **UNVERIFIED** per clause. `PASS` is currently unfalsifiable (40/40).
4.6 Fix `equals`-with-no-`value` (Code.gs:2255: `NaN > NaN` is false → silent pass). Never fired in 1456 uses; 4.2's validation should reject it explicitly.

**Acceptance:** false-pass rate drops from the post-Phase-0 baseline of **19/40**. No task regresses.
**Risk:** 4.1 and 4.2 are the most behaviour-changing items here and refusal loops were a documented v0/v1 failure mode. Ship one at a time, each with its own sweep, watching turn counts and REFUSED rates as well as scores.

### 4b — The modelling errors the rest of this plan does not touch
These are wrong-value failures with no preservation or harness story. They are what actually stands between "clean harness" and a high score.
- **t13 column I** — golden `I7 = J7/K7`, expected `+0.282191`, actual `−0.282191`, every row, 5 of 6 runs across both sweeps. A sign convention.
- **t13 AD/AE/AF** — constant `+1505.5421113039` offset in all 3 v3 seeds; golden `AD7 = U7 + SUM(S7, 'Scenario Engine'!L7:Q7)` and the model omits `S7`. A definition error, not truncation.
- **t05 D107/E107** — 13740 vs 15130 and 29195 vs 25528, **identical in s2 and s3**. Repeatable, so more seeds make it worse, not better.
- **t08/s2** — 48 cells on Metric Matrix (`AA9` 1928.92 vs 2100.56).
- **t10 Operating Valuation** rows 48-113 and **t12 rows 12, 28-30** — 149 of t12/s2's 236 failures have no overwrite behind them.
- **t15** — 46% of cells wrong; golden's interest formula is not derivable from the labels. Least likely to yield.

---

## Phase 5 — Cleanup and submission hygiene

5.1 Delete the hardcode-intent refusal and typing/storing WARN (Code.gs:1409-1420). **23 refusals** across both sweeps (v3 13, v2 10), 100% false positive, 0 errors caught; fires on t03, t13 **and t07**; contradicts Prompts.gs:43's verbatim-quote order; taught the model to truncate its quotes.
5.2 Delete dead prompt lines: "Budget ~5 minutes" (**23 of 40** runs exceeded it, max 1638s), the map-trust line (3c), the `-`/0/blank/`#N/A` line (no failure in 41 runs), the millions/trillions line (t14 only, never swept), and the `=F6+0.004861` clause (that branch fails the one task whose numbers it uses).
5.3 Rewrite "assert blank on the intended-empty cells" — direct cause of t10's hole. Replacement: a blank you assert is a blank you can never detect; prove an intended blank from structure, not from the shape of the grid.
5.4 **De-leak benchmark-specific priors.** "A ramp from X to Y by YEAR starts AT X" → t07 only; "carry as a positive amount" → t05; "Move/shift X to Y" → t09; `+48.61bps` is t11's literal operand. README forbids hardcoding benchmark specifics and design is graded. Keep the general rules, replace every example with numbers and phrasings from no task. **Ship regardless of score.**

---

## Phase 6 — Measurement discipline and what offline cannot tell you

6.1 Move to **5 seeds**. ±3pp noise on an all-or-nothing 14-task metric cannot resolve a one-task change at 3. Phase 2 pays for this.
6.2 Run `conformance.mjs` and `toolpath_test.mjs` before every sweep.
6.3 **Online confirmation is mandatory before submission.** `google_grade.py:45-47` refuses to certify unless `engine == 'google-apps-script'` and `stableSamples >= 3`. Every offline grade is `passed: null, provisional: true`.
6.4 **t14 has never been run** and cannot run offline (shim throws on DV and CF, read and write). It has 9 sheets, more than any other task. The spec says `init.xlsx` already ships the exact validation and CF rule with `G1=0`/`H1=1`, so the work *may* be small — treat that as a hypothesis, not good news, until it runs.
6.5 **t04 may be impossible online**: one full recalc ~425s against a 6-minute kill. Decide deliberately.
6.6 The offline engine's formula semantics have never been compared to Sheets. Spot-check every offline-passing task with one online run.

---

## Realistic ceiling

6 clean today. Phase 1 adds t07 (needs 1.1+1.2+0.2b to all land). Phase 4.4 adds t10/s3 only if `missing_submission_cache` is also resolved. t04 and t08 are one modelling error each from 3/3. t13 needs two fixes from 4b. **Defensible target: 8-9 of 14 measurable, with t14 unknown and t15 unlikely.** 15/15 requires t15, t14 and t04-under-6-minutes all to come good; nothing in the evidence supports that.

## Order of work

Phase 0 → Phase 1 (in its internal order) → Phase 2 → Phase 3a → **5 seeds** → Phase 3b → Phase 4a one item at a time → Phase 4b. Phase 5 anytime; 5.4 before submission regardless.

Never change the verifier and its inputs in the same measurement.
