#!/usr/bin/env python3
"""Boundary tests for the binary verdict. Run: .venv/bin/python e2e/test_verdict.py

verdict.classify decides whether a failure is the agent's or mog's. Getting it wrong in the
lenient direction means shipping a broken submission, so every violation kind the grader can
emit (grader/scoring.py:67-89) is pinned here with an expected verdict.
"""
import sys, json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from e2e.verdict import classify, unreachable_objects


def grade(**kw):
    d = {"correct": 10, "total": 10, "preservation": {"violations": []}, "requirements": [],
         "execution": {"new_errors": []}, "output_failures": []}
    d.update(kw)
    return d


def viol(v):
    return {"preservation": {"violations": [v]}}


def book(font):
    """Minimal workbook snapshot in the shape grader.workbook.load_workbook returns."""
    return {"sheets": {"S": {"cells": {"A1": {"value": 1, "formula": None, "error": None,
                                              "style": {"font": font}}}}}}


# A control with one known mog-lossy cell, for the two cases below. Everything else uses
# the real on-disk control for task_01.
# A clean, empty control. The boundary tests must not depend on out/controls.json --
# that is a measured artifact that takes ~40 min to regenerate, and a unit test that
# cannot run on a fresh checkout is a unit test that stops being run.
CLEAN_CTL = {"baseline_violations": [], "golden_violations": [], "golden_failed_requirements": {},
             "golden_correct": [10, 10], "golden_new_errors": [], "unstable_objects": [],
             "lossy_cells": []}

LOSSY_CTL = {"baseline_violations": [], "golden_violations": [], "golden_failed_requirements": [],
             "golden_correct": [10, 10], "golden_new_errors": [], "unstable_objects": [],
             "lossy_cells": ["S|A1"]}

# (name, grade, should_fail, control_or_None, wrote_sheets_or_None, submission_book_or_None)
CASES = [
    ("clean run", grade(), False),

    # the agent's own work -- always a real failure
    ("wrong output value", grade(correct=9, output_failures=[{"sheet": "S", "cell": "A1"}]), True),
    ("new error cell", grade(execution={"new_errors": [{"sheet": "S", "cell": "A1", "error": "#REF!"}]}), True),
    ("failed requirement", grade(requirements=[{"id": "unknown_req", "passed": False,
                                                "failures": [{"sheet": "S", "cell": "A1"}]}]), True),

    # cell_content is NOT deleted online -- reconcile re-derives it from userEnteredValue
    # (native_preservation.py:99-119), so an edit to a protected cell must FAIL offline too.
    # This case previously asserted False and pinned the false green as the spec.
    ("cell_content", grade(**viol({"kind": "cell_content", "sheet": "S", "cell": "A1"})), True),

    # cell_style is discarded online ONLY when the Sheets API says it is unchanged. A
    # genuine change is kept, so discounting it wholesale offline was a false green:
    # setNumberFormat one row past style_editable passed offline and failed online.
    ("cell_style", grade(**viol({"kind": "cell_style", "sheet": "S", "cell": "A1", "field": "fill"})), True),

    # objects with no API in the surface: the agent cannot reach one
    ("sheet_objects/charts", grade(**viol({"kind": "sheet_objects", "sheet": "S", "object": "charts"})), False),
    ("sheet_objects/pivots", grade(**viol({"kind": "sheet_objects", "sheet": "S", "object": "pivots"})), False),

    # objects the shim DOES implement: an agent really can change these
    ("sheet_objects/conditional_formats",
     grade(**viol({"kind": "sheet_objects", "sheet": "S", "object": "conditional_formats"})), True),
    ("sheet_objects/validations",
     grade(**viol({"kind": "sheet_objects", "sheet": "S", "object": "validations"})), True),

    # workbook-wide kinds, all reachable through the surface
    ("sheet_structure", grade(**viol({"kind": "sheet_structure"})), True),
    ("defined_names", grade(**viol({"kind": "defined_names"})), True),
    ("sheet_layout", grade(**viol({"kind": "sheet_layout", "sheet": "S"})), True),

    # an unrecognised kind must FAIL, never silently pass
    ("unknown kind", grade(**viol({"kind": "some_future_kind", "sheet": "S"})), True),

    # mog drops some literals on load and repopulates them on a later recalc (task_15's
    # Formula Audit). controls.lossy_cells measures exactly those cells by diffing the
    # original workbook against mog's render of it, so a content change there is mog's.
    ("cell_content on a mog-lossy cell",
     grade(**viol({"kind": "cell_content", "sheet": "S", "cell": "A1"})), False, LOSSY_CTL),
    # ...and the discount must be per-CELL, never per-sheet or blanket.
    ("cell_content on a neighbouring non-lossy cell",
     grade(**viol({"kind": "cell_content", "sheet": "S", "cell": "A2"})), True, LOSSY_CTL),
    # a lossy cell excuses CONTENT only -- style on the same cell is still the agent's
    # a lossy cell on a sheet the agent WROTE to is judged -- lossiness alone excuses nothing
    ("cell_content on a lossy cell the agent's sheet was written to",
     grade(**viol({"kind": "cell_content", "sheet": "S", "cell": "A1"})), True, LOSSY_CTL, ["S"]),
    ("cell_content on a lossy cell, sheet untouched",
     grade(**viol({"kind": "cell_content", "sheet": "S", "cell": "A1"})), False, LOSSY_CTL, ["Other"]),
    ("cell_style on a mog-lossy cell is not excused by lossiness",
     grade(**viol({"kind": "cell_style", "sheet": "S", "cell": "A1", "field": "font"})), True, LOSSY_CTL),
    # A control key alone excuses NOTHING -- vkey is value-blind, so "mog wobbled this fill"
    # and "the agent painted it red" are the same key. Measured free-damage window before
    # this: 768 cell-fields on task_07, 1653 on task_15; painting protected cells red and
    # bold on task_09 read as PASS with a violation count identical to a clean run.
    ("control key WITHOUT matching state excuses nothing",
     grade(**viol({"kind": "cell_style", "sheet": "S", "cell": "A1", "field": "font"})), True,
     dict(LOSSY_CTL, golden_violations=["cell_style|S|A1|font|"]), None, book("BOLD")),
    ("control key WITH matching state is excused",
     grade(**viol({"kind": "cell_style", "sheet": "S", "cell": "A1", "field": "font"})), False,
     dict(LOSSY_CTL, golden_violations=["cell_style|S|A1|font|"],
          known_state={"cell_style|S|A1|font|": [json.dumps("MOGFONT")]}), None, book("MOGFONT")),
    ("control key with a DIFFERENT state is the agent's",
     grade(**viol({"kind": "cell_style", "sheet": "S", "cell": "A1", "field": "font"})), True,
     dict(LOSSY_CTL, golden_violations=["cell_style|S|A1|font|"],
          known_state={"cell_style|S|A1|font|": [json.dumps("MOGFONT")]}), None, book("AGENTFONT")),

    # sheet_objects is NEVER discounted by a control key: vkey carries no object content,
    # so "sheet_objects|S|||conditional_formats" would forgive ANY CF change on that sheet.
    ("object violation is not excused by a matching control key",
     grade(**viol({"kind": "sheet_objects", "sheet": "S", "object": "conditional_formats"})), True,
     dict(LOSSY_CTL, golden_violations=["sheet_objects|S|||conditional_formats"])),

    # requirements are excused per CELL, never per id -- otherwise an agent that does
    # nothing passes a task whose golden fails that requirement offline (task_08).
    ("requirement excused only on the cells the golden also failed",
     grade(requirements=[{"id": "fmt", "passed": False,
                          "failures": [{"sheet": "S", "cell": "A1"}, {"sheet": "S", "cell": "B2"}]}]),
     True, dict(LOSSY_CTL, golden_failed_requirements={"fmt": ["S|A1"]})),
    ("requirement fully excused when every failing cell matches",
     grade(requirements=[{"id": "fmt", "passed": False,
                          "failures": [{"sheet": "S", "cell": "A1"}]}]),
     False, dict(LOSSY_CTL, golden_failed_requirements={"fmt": ["S|A1"]})),
    ("a list-shaped (pre-per-cell) control excuses nothing",
     grade(requirements=[{"id": "fmt", "passed": False,
                          "failures": [{"sheet": "S", "cell": "A1"}]}]),
     True, dict(LOSSY_CTL, golden_failed_requirements=["fmt"])),

    # The shim records which sheets the agent wrote to. mog recalculates cells that are
    # literals in the file, so a violation on a sheet nobody wrote to is mog's, not the
    # agent's (task_15). This is a record, not a guess -- and when it is absent we discount
    # nothing rather than assume.
    ("violation on a sheet the agent never wrote to",
     grade(**viol({"kind": "cell_content", "sheet": "Untouched", "cell": "A1"})), False, None, ["Edited"]),
    ("violation on a sheet the agent DID write to",
     grade(**viol({"kind": "cell_content", "sheet": "Edited", "cell": "A1"})), True, None, ["Edited"]),
    ("no write record -> discount nothing",
     grade(**viol({"kind": "cell_content", "sheet": "Untouched", "cell": "A1"})), True, None, None),
    ("empty write record still fails an editable-sheet violation",
     grade(**viol({"kind": "sheet_structure"})), True, None, []),
]


def main():
    assert unreachable_objects() == {"charts", "pivots", "tables"}, \
        f"surface changed: {unreachable_objects()}"
    test_serialization_artifacts()
    print("  ok    serialization artifacts discounted; a real recolor still fails")
    bad = 0
    for case in CASES:
        name, d, should_fail = case[0], case[1], case[2]
        ctl = case[3] if len(case) > 3 and case[3] is not None else CLEAN_CTL
        wrote = case[4] if len(case) > 4 else None
        sub = case[5] if len(case) > 5 else None
        failures, _ = classify(d, "task_01", ctl, wrote, sub)
        got = bool(failures)
        ok = got == should_fail
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'}  {name:36s} -> {'FAIL' if got else 'PASS'}")
    print(f"\n  {len(CASES) - bad}/{len(CASES)} passed")
    return 1 if bad else 0



# --- serialization artifacts (bgColor / scheme) --------------------------------------
# mog omits <bgColor/> and <scheme/>; Google and Excel always write them. No Apps Script
# member sets either, so their absence alone cannot be the agent's doing. Measured: the
# KNOWN-CORRECT solution for task_07 scored 25/25 and failed on 10 of these, making the
# task unpassable by any agent. Pinned in BOTH directions.
def _style_book(xml):
    return {"sheets": {"S": {"cells": {"A1": {"style": {"fill": xml}, "value": 1,
                                              "formula": None, "error": None}}}}}


def test_serialization_artifacts():
    from e2e.verdict import _serialization_only
    v = {"kind": "cell_style", "sheet": "S", "cell": "A1", "field": "fill"}
    keep = '<fill><patternFill patternType="solid"><fgColor rgb="1F3864"/><bgColor indexed="64"/></patternFill></fill>'
    drop = '<fill><patternFill patternType="solid"><fgColor rgb="1F3864"/></patternFill></fill>'
    red  = '<fill><patternFill patternType="solid"><fgColor rgb="FF0000"/></patternFill></fill>'
    assert _serialization_only(_style_book(keep), _style_book(drop), v), \
        "dropped <bgColor> must read as serialization"
    assert not _serialization_only(_style_book(keep), _style_book(red), v), \
        "an agent painting the cell red must NOT be excused as serialization"


if __name__ == "__main__":
    sys.exit(main())