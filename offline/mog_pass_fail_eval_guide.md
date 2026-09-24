# Reading a PASS/FAIL from an offline run

Everything an agent run tells you, and how much of it to believe.

```sh
npm run e2e task_09        # -> PASS or FAIL, with the offending cell
npm test                   # 30 unit + 4 integration. Run this first, always.
npm run controls           # ONCE per mog binary. Enforced by sha256, not by trust.
```

---

## The one-line rule

**PASS is strong. FAIL is a lead, not a verdict.**

Every discount in the classifier is conditional on measured or recorded evidence, and every
ambiguity resolves toward FAIL. So a PASS is hard to obtain by accident. A FAIL may still be
mog rather than the agent — the known cases are listed below, and each is recognisable.

---

## What the harness actually checks

The grader has four gates (`grader/scoring.py:138`). All four must pass:

```python
passed = correct == len(outputs) and not violations
         and all(c["passed"] for c in requirements) and not errors
```

| gate | what a failure means | trust it? |
|---|---|---|
| **output values** | the agent computed the wrong number | **yes, fully** |
| **requirements** | a task-specific check failed (number formats, borders, a toggle) | **yes**, excused only per cell |
| **new error cells** | the agent introduced `#REF!`/`#VALUE!` | **yes** |
| **preservation** | something outside the editable set changed | **mostly** — see below |

Preservation is where offline and online differ, and it is the only gate worth arguing with.

---

## Why preservation is hard, in one paragraph

mog writes `.xlsx` differently than Google does. Worse, offline the grader never runs
`native_preservation.reconcile()`, which online re-derives `cell_content` from Sheets'
`userEnteredValue` and discards `cell_style` the API says is unchanged. **reconcile is not
subtractive** — it deletes some violations and re-creates others — so offline is neither a
superset nor a subset of online. Rather than guess, the harness measures mog's noise with
runs that involve no agent, and records what the agent actually did.

---

## The seven discounts, and what each rests on

A violation is only forgiven by one of these. Nothing is forgiven by kind.

| # | discount | evidence |
|---|---|---|
| 1 | fewer wrong cells than the golden itself misses offline | golden control's own score |
| 2 | a requirement's failing cells all fail for the golden too | control, **per cell** |
| 3 | mog produces **this exact state** here with no agent involved | baseline/golden/writepath control **+ the submission matches it** |
| 4 | the agent never wrote to that sheet | recorded at the shim's write choke point |
| 5 | mog cannot carry the cell through a load **and** the sheet was untouched | `init` vs `mog(init)` diff **+** the record |
| 6 | the object kind has no API in the surface (charts, pivots, tables) | derived from `vocab/KEPT.txt` |
| 7 | *(empty)* | `RECONCILED = {}` — the blanket rule is gone |

**#3 is the one that was broken and is the one to watch.** The control key is
`kind|sheet|cell|field|object` — it carries no value. Matching on the key alone meant
"mog wobbled this fill" and "the agent painted it bright red" were the same string. Measured
free-damage window before the fix: **768 cell-fields on task_07, 1653 on task_15**. An agent
that painted six protected cells red and bold on task_09 read as PASS with a violation count
*identical to a clean run*. The control now records the state mog produced, and the
submission must match it.

---

## When a FAIL is probably mog, not the agent

Check these in order. Each is recognisable from the failure text.

1. **`cell_style` on a sheet the agent legitimately wrote to.** mog restyles cells it
   rewrites — it adds `<scheme val="minor"/>` to any font it touches, where Google leaves it
   absent. If the failing cells are exactly the cells the agent wrote, suspect mog.
   *Confirm:* diff the style of one failing cell between `base.xlsx` and `out.xlsx`. A
   difference that is only `<scheme>`, `<family>`, or an empty-element spelling is mog.
2. **`cell_content` on a sheet the agent never wrote to.** mog recalculates cells that are
   literals in the file (task_15's `Formula Audit!D35`: -92884 -> 48048.72 when
   `Forecast Model` is edited). Should already be discounted by #4; if it is not, the write
   record returned `null` — look for `__WROTE__ null` in the run output.
3. **task_07 style churn on `Meta Drivers`.** A *known false red*. The golden control is
   `mog(golden)`, a file round-trip; a real run is `base` plus writes through the shim. Same
   cell, different path, different resulting style, so the state cannot match. No agent-free
   control fixes it — reproducing the churn requires writing different values, which only an
   agent does, and a "perfect agent" control would be circular.
4. **Empty-string arithmetic.** `=A1+1` where A1 is `=""` errors in mog (Excel semantics) and
   returns 1 in Google (Sheets semantics). Only bare `+ - * /`; SUM, `&` and `=` all agree.

If a FAIL is none of these, **believe it.**

---

## When a PASS is worth double-checking

Rare, but not impossible:

- **`__WROTE__ null` in the output.** The write record could not be vouched for. That makes
  the verdict *stricter* everywhere except discount #5, which is explicitly conditioned on
  `wrote_sheets is None`. An agent can trigger it with a one-line no-op
  (`removeNamedRange` on a name that does not exist emits a mutation with no worksheet).
  Nothing exploitable exists behind it on the current fixtures, but it is a real lever.
- **A stale control.** Cannot happen silently: `controls.json` carries the binary's sha256
  and `verdict.py` refuses a mismatch. If you see that error, re-measure — do not work
  around it.
- **Operations the writepath control never exercises:** `setBorder`, data validation,
  conditional formats. Those are legitimate for task_07 and task_14. Nothing fails on them
  today, but the control cannot vouch for churn it never triggers.

---

## What the sweep proves, and what it does not

`npm run e2e` across all 15 runs a **generated perfect agent** — a script that writes each
task's known-correct answers. It proves a CORRECT answer grades as correct.

It does **not** prove a wrong answer grades as wrong. That is what `npm test` covers, by
feeding the classifier deliberate damage, and what the red-team method covers: append damage
to `e2e/solution-task_NN.js`, run it, and confirm FAIL. **Both halves are needed.** Five
clean sweeps in a row missed a live false green; one wrong answer found it in minutes.

---

## If you change anything

| you changed | you must |
|---|---|
| the mog binary | `npm run controls` — enforced by sha256 |
| `shim/` | `npm run build`, then `npm test` (the integration test runs real Apps Script on real mog) |
| `verdict.py` | `npm test`, then re-run the sweep AND at least one damage attack |
| `vocab/KEPT.txt` | `npm test` — a pinned assertion catches the reachable-object set changing |

## The habit that actually caught things

Adding a discount is adding a way to be wrong. Every one this project added started as a
plausible rule and turned out to forgive real damage, because the evidence it keyed on was
coarser than the thing it was excusing. Before adding one, write the attack that abuses it
and run it.
