#!/usr/bin/env python3
"""PASS or FAIL. Nothing else.

An offline grade contains failures the agent did not cause: mog writes the .xlsx
differently than Google does, and offline the grader never runs
native_preservation.reconcile(), which online discards whole classes of violation
before they count. Left alone, that produces red that cannot exist online.

Rather than judge each one, we subtract two controls (e2e/controls.py):

  baseline   a NO-OP edit. Anything it reports, mog produced by itself.
  golden     a workbook that IS the golden. Anything it reports is what mog does
             to a known-perfect answer -- the artifact floor.

  writepath  a semantic no-op that still dirties the graph. Anything it reports is
             churn mog produces from the act of writing, not from what was written.
  lossy      init.xlsx vs mog(init), per cell: cells mog cannot carry through a load.

Plus one RECORD, not a measurement: the sheets the agent actually wrote to, captured
at the shim's single write choke point. A violation on a sheet it never wrote to is
mog's.

NOTHING is discounted by kind. An earlier version of this docstring claimed reconcile()
"discards every cell_content violation ... those cannot reach an online grade, so they
are never the agent's failure". That is FALSE -- native_preservation.py:99-119 discards
the export-derived ones and then RE-DERIVES them from userEnteredValue, so a genuine
edit to a protected cell survives to the online grade. The classifier believed the
docstring and discounted every cell_content and cell_style violation, which meant an
agent that clobbered a protected cell passed offline and scored zero online.

Everything left is the agent's, and it is reported with the sheet, cell and field.
"""
import json
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "out/controls.json"

# What reconcile() actually does online, read from grader/native_preservation.py:88-119.
#
# cell_content: NOT deleted. reconcile discards the export-derived violations and then
#   RE-DERIVES them from the native userEnteredValue snapshot (line 99-119, `result.extend
#   (entered_violations)`). A genuine edit to a protected cell therefore SURVIVES to the
#   online grade. Discounting it offline is a false green -- offline says PASS, online
#   scores the task zero via scoring.py:138 (`not violations`).
#
#   That was harmless while the only thing that ran was e2e/make_solution.py, a fixture
#   that writes nothing but golden answers into scored cells. A real agent writes wherever
#   it likes, so the lenient path becomes live the moment one runs.
#
#   Un-forgiving it is safe because mog produces almost no content noise, measured:
#     baseline (no-op edit)      0 cell_content on all 15 tasks
#     golden   (correct answer)  9 cell_content, all in task_15
#   and the golden control already carries those 9, so `known` discounts them.
#
#   It is also structurally safe: workbook.py:103 `raw()` returns ONLY {"formula": ...}
#   for a formula cell, so mog's recalc drift cannot produce a cell_content violation.
#   The comparison is already on entered state, which is what reconcile rebuilds.
#
# cell_style: genuinely discarded online, but conditionally -- only when the Sheets API
#   reports the style unchanged AND the cell is inside both snapshots' coverage
#   (native_preservation.py:88-93). Offline has no Sheets API, so the condition cannot be
#   evaluated. Kept as a blanket discount for now because mog's style churn is large
#   (2448 entries in the golden controls) and removing it without re-measuring against the
#   patched binary would drown every run in false reds. Re-decide once controls are
#   re-measured; the honest end state is controls-only, same as cell_content.
# FG-1: cell_style USED to be discounted here. Online, native_preservation.py:84-90
# discards it only when the Sheets API says the style is unchanged AND the cell is inside
# coverage -- a genuine change is kept. Discounting it wholesale was a false green:
#     getRange("E16:K29").setNumberFormat("#,##0")   when only E16:K21 is style_editable
# yields ~49 cell_style/number_format violations that PASS offline and FAIL online.
# style_editable is non-empty in only 6 of 15 tasks and covers number_format (plus one
# border range in task_07), so font, fill and alignment are protected in every cell of
# every task. Nothing is blanket-discounted now; mog's noise is MEASURED instead.
RECONCILED = {}

# A sheet_objects violation can only be the agent's doing if the agent has some way to
# REACH that object. The implemented surface is generated from vocab/KEPT.txt, so we ask
# it directly rather than hardcoding the answer: if nothing in the agreed API mentions the
# object kind, no agent script can create, alter or delete one, and any diff the grader
# reports for it came from mog re-serialising the file. If a chart API is ever added to
# KEPT.txt this discount stops applying by itself.
# The grader's object kinds are fixed by grader/workbook.py:186 -- validations,
# conditional_formats, charts, pivots, tables. validations and conditional_formats have a
# real API in the surface (shim/65-*, shim/66-*), so an agent can genuinely change one and
# they stay graded. The rest have zero members in KEPT.txt.
OBJECT_API_KEYWORDS = {"charts": "chart", "pivots": "pivot", "tables": "table",
                       "validations": "validation", "conditional_formats": "conditionalformat"}


def unreachable_objects():
    kept = (ROOT / "vocab/KEPT.txt")
    if not kept.exists():
        return set()          # cannot prove it, so discount nothing
    surface = kept.read_text().lower()
    return {kind for kind, word in OBJECT_API_KEYWORDS.items() if word not in surface}


# mog omits two elements that Google and Excel always serialize: <bgColor .../> inside a
# solid patternFill, and <scheme val="minor"/> inside a font. Nothing an agent can call
# through the Apps Script surface sets either one -- there is no setBgColor, and no scheme
# control at all -- so a style that matches the original once BOTH sides are stripped of
# them differs only in how mog wrote the file, not in what the agent did.
#
# Measured: e2e/solution-task_07.js -- the KNOWN-CORRECT answer, no agent -- scored 25/25
# and failed on 10 of these at Meta Drivers G21:K21, so task_07 could not be passed by any
# agent. This is NOT a blanket cell_style amnesty (that was FG-1, and it produced false
# greens): a real recolor changes fgColor/rgb/theme, which survives stripping and still fails.
_SERIALIZATION_NOISE = re.compile(r"<bgColor[^>]*/>|<scheme[^>]*/>")


def _serialization_only(init_book, sub_book, v):
    """True when a cell_style violation is just mog's omitted elements."""
    if v.get("kind") != "cell_style" or init_book is None or sub_book is None:
        return False
    before, after = _state(init_book, v), _state(sub_book, v)
    if before is None or after is None or before == after:
        return False
    return _SERIALIZATION_NOISE.sub("", before) == _SERIALIZATION_NOISE.sub("", after)


def _matches_control(k, v, known_state, sub):
    """A control key is only an excuse if the submission holds what the CONTROL produced.
    No recorded state (pre-state control file) or no submission -> cannot verify -> do not
    excuse. Kinds with no cell (sheet_structure, defined_names) never reach here."""
    want = known_state.get(k)
    if want is None:
        return v.get("cell") is None      # workbook-wide kinds carry no state to compare
    if sub is None:
        return False
    got = _state(sub, v)
    return got is not None and got in want


def vkey(v):
    return "|".join(str(v.get(k, "")) for k in ("kind", "sheet", "cell", "field", "object"))


# grader/scoring.py:67-89 -- sheet_structure and defined_names are workbook-wide and carry
# no sheet; sheet_layout carries a sheet but no cell.
def describe(v):
    what = v.get("field") or v.get("object") or ""
    head = f"{v['kind']}{'/' + what if what else ''}"
    if v.get("cell"):
        return f"{head} at {v['sheet']}!{v['cell']}"
    if v.get("sheet"):
        return f"{head} on sheet '{v['sheet']}'"
    return f"{head} (workbook-wide)"


def load_controls(task):
    if not CONTROLS.exists():
        raise SystemExit(f"missing {CONTROLS} -- run: .venv/bin/python e2e/controls.py {task}")
    c = json.loads(CONTROLS.read_text()).get(task)
    if c is None:
        raise SystemExit(f"no control for {task} -- run: .venv/bin/python e2e/controls.py {task}")
    # The noise floor belongs to one binary. A control measured on a noisier build silently
    # forgives real damage when reused with a cleaner one, and nothing used to notice.
    mog = ROOT / ".mog/bin/mog"
    if mog.exists():
        import hashlib
        have = hashlib.sha256(mog.resolve().read_bytes()).hexdigest()[:16]
        want = c.get("mog_sha")
        if want is None:
            raise SystemExit(f"control for {task} predates binary pinning -- re-measure: "
                             f".venv/bin/python e2e/controls.py {task}")
        if want != have:
            raise SystemExit(f"control for {task} was measured with mog {want}, this is "
                             f"{have} -- re-measure: .venv/bin/python e2e/controls.py {task}")
    return c


def _state(book, v):
    """What the SUBMISSION holds at a violated cell, in the same shape controls.py records."""
    from grader.workbook import get_cell, raw
    from grader.scoring import cell_style
    sheet, cell = v.get("sheet"), v.get("cell")
    if not sheet or not cell:
        return None
    if v["kind"] == "cell_content":
        return json.dumps(raw(get_cell(book, sheet, cell)), sort_keys=True)
    if v["kind"] == "cell_style":
        return json.dumps(cell_style(book, sheet, cell).get(v.get("field")), sort_keys=True)
    return None


def classify(d, task, control=None, wrote_sheets=None, submission=None, initial=None):
    """-> (failures, discounted). Empty failures means PASS.

    `control` overrides the on-disk measurement; only the tests pass it.
    `wrote_sheets` is the list of sheet NAMES the agent actually wrote to, recorded at the
    shim's single write choke point (shim/10-runtime.js). None means "not recorded" --
    discount nothing, never guess.

    `submission` is the graded .xlsx. Without it a control key cannot be checked against what
    the agent actually left behind, so matching keys are NOT discounted -- vkey is value-blind
    and matching on it alone is an unconditional amnesty (measured: 768 free cell-fields on
    task_07, 1653 on task_15; painting protected cells red read as PASS)."""
    c = control if control is not None else load_controls(task)
    UNREACHABLE = unreachable_objects()
    # vkey() is kind|sheet|cell|field|object -- for sheet_objects that is
    # "sheet_objects|Forecast Model|||conditional_formats", carrying NO content. Matching a
    # control on that key forgave ANY object change the agent made on that sheet. Object
    # violations are therefore never discounted by the controls: they are judged by whether
    # the surface can reach the object at all, and by the recorded write set.
    known = {k for k in (set(c["baseline_violations"]) | set(c["golden_violations"])
                         | set(c.get("writepath_violations", [])))
             if not k.startswith("sheet_objects|")}
    # Cells mog cannot carry through a load -- it drops the literal and repopulates it on a
    # later recalc, so a content change there is mog's, not the agent's. Measured by
    # controls.lossy_cells as init.xlsx vs mog(init.xlsx); see its docstring. Older control
    # files predate the field, so absence means "discount nothing", not a crash.
    LOSSY = set(c.get("lossy_cells", []))
    KNOWN_STATE = c.get("known_state", {})
    sub = submission
    if submission is not None and not isinstance(submission, dict):
        from grader.workbook import load_workbook
        sub = load_workbook(str(submission))
    ini = initial
    if initial is not None and not isinstance(initial, dict):
        from grader.workbook import load_workbook
        ini = load_workbook(str(initial))
    failures, discounted = [], []

    # --- output values -------------------------------------------------------
    gc, gt = c["golden_correct"]
    if d["correct"] < d["total"]:
        floor = gt - gc                       # cells even the golden cannot score offline
        missed = d["total"] - d["correct"]
        if missed > floor:
            for f in d.get("output_failures", [])[:25]:
                # Say WHY. A `formula_required` cell can hold the right number and still
                # fail, and calling that "wrong value (got 0, want 0)" reads as a harness
                # bug when it is a correct, precise FAIL.
                why = ",".join(f.get("reasons") or []) or "wrong value"
                failures.append(f"{why} at {f.get('sheet')}!{f.get('cell')}"
                                + (f" (got {f.get('actual')!r}, want {f.get('expected')!r})"
                                   if "actual" in f else ""))
            if missed > 25:
                failures.append(f"...and {missed - 25} more wrong output cells")
        else:
            discounted.append(f"{missed} wrong output cell(s) -- the golden itself scores "
                              f"{gc}/{gt} offline, so this is mog's floor")

    # --- new error cells -----------------------------------------------------
    gerr = set(c.get("golden_new_errors", []))
    for e in d["execution"]["new_errors"]:
        at = f"{e['sheet']}!{e['cell']}"
        (discounted if at in gerr else failures).append(
            f"new error cell {at} = {e['error']}" + (" (present in golden control)" if at in gerr else ""))

    # --- requirements --------------------------------------------------------
    # Per CELL, never per id. task_08's golden fails `output_number_formats` offline (a mog
    # round-trip artifact), and discounting the whole requirement by NAME meant an agent
    # that set no number formats at all passed task_08 -- while online the check is
    # spec-driven against the submission (scoring.py:99-104) and fails. A list-shaped
    # control predates per-cell data, so it forgives nothing rather than guessing.
    gfail = c["golden_failed_requirements"]
    gfail = {} if isinstance(gfail, list) else gfail
    for r in d.get("requirements", []):
        if r["passed"]:
            continue
        excused = set(gfail.get(r["id"], []))
        mine = [x for x in r.get("failures", [])
                if f"{x.get('sheet')}|{x.get('cell')}" not in excused]
        if not mine:
            discounted.append(f"requirement '{r['id']}' ({len(r.get('failures', []))} cells) "
                              f"-- every failing cell also fails for the golden offline")
        else:
            r = dict(r, failures=mine)
            n = len(mine)
            detail = ", ".join(
                f"{x.get('sheet')}!{x.get('cell')}"
                + (f" [{x['number_format']}]" if "number_format" in x else "")
                + (f" [{x['field']}]" if "field" in x else "")
                for x in r.get("failures", [])[:8])
            failures.append(f"requirement '{r['id']}' failed on {n} cell(s): {detail}"
                            + (" ..." if n > 8 else ""))

    # --- preservation --------------------------------------------------------
    for v in d["preservation"]["violations"]:
        k = vkey(v)
        if k in known and _matches_control(k, v, KNOWN_STATE, sub):
            discounted.append(f"{describe(v)} -- mog produces this exact state here "
                              f"with no agent involved (baseline/golden/writepath control)")
        elif _serialization_only(ini, sub, v):
            discounted.append(f"{describe(v)} -- identical once mog's omitted <bgColor>/"
                              f"<scheme> elements are stripped from both sides; no Apps "
                              f"Script member can set either, so this is serialization")
        # LIVE: run_offline.py passes the recorded set. v1 keyed it on GAS.nid() handles and resolved them against a FRESH getSheets(),
        # whose handles are disjoint by construction -- measured: agent ["gas3"] vs probe
        # ["gas8".."gas11"], intersection empty, so `wrote_sheets` was always [] and EVERY
        # violation carrying a sheet was discounted. A total false green that read as 15/15.
        # Re-enable only with a test that exercises the id->name hop, not one that passes
        # names straight in (test_verdict.py did exactly that and missed it).
        elif wrote_sheets is not None and v.get("sheet") and v["sheet"] not in wrote_sheets:
            discounted.append(f"{describe(v)} -- the agent never wrote to sheet "
                              f"'{v['sheet']}' (recorded at the shim's write choke point)")
        # Lossy cells excuse cell_content ONLY on a sheet the agent did not write to. On its
        # own the lossy rule was the last unconditional discount in the file: it forgave a
        # cell_content violation from a property of the CELL regardless of what the agent
        # did, so an agent writing a wrong value into a lossy cell was forgiven. Composed
        # with the record, a lossy cell on a sheet the agent touched is judged, not excused.
        elif (v["kind"] == "cell_content"
              and f"{v.get('sheet')}|{v.get('cell')}" in LOSSY
              and (wrote_sheets is None or v.get("sheet") not in wrote_sheets)):
            discounted.append(f"{describe(v)} -- mog drops this cell's value on load "
                              f"(differs from the original workbook before any agent ran)")
        elif v["kind"] in RECONCILED:
            discounted.append(f"{describe(v)} -- {RECONCILED[v['kind']]}")
        elif v["kind"] == "sheet_objects" and v.get("object") in UNREACHABLE:
            discounted.append(f"{describe(v)} -- the Apps Script surface has no "
                              f"{v.get('object')} API, so no agent script can touch one")
        else:
            failures.append(f"preservation: {describe(v)} -- agent changed a protected cell/object")

    return failures, discounted


def main(path, task):
    d = json.loads(Path(path).read_text())
    failures, discounted = classify(d, task)
    print(f"  score {d['correct']}/{d['total']}   "
          f"preservation_violations {len(d['preservation']['violations'])}   "
          f"discounted {len(discounted)}")
    if failures:
        print("\n  FAIL:")
        for f in failures:
            print(f"    - {f}")
    print(f"\n  VERDICT: {'PASS' if not failures else 'FAIL'}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
