#!/usr/bin/env python3
"""Per-task controls that turn a judgement call into a lookup.

Two runs per task, neither involving an agent:

  baseline   grade(mog(init) -> mog(init))     a NO-OP edit.
             Every violation it reports was produced by mog writing the file,
             because nothing else happened.

  golden     grade(mog(init) -> mog(golden))   a PERFECT answer.
             Every violation or failed requirement it reports is what mog does
             to a known-correct workbook, so it is the artifact floor. Nothing
             an agent does can be blamed for it.

Anything an agent run reports that is NOT in these two sets is the agent's own
doing. That is what makes the verdict binary: no "needs a look", because the
controls already answered it.

Written to out/controls.json. Regenerate whenever the mog binary changes.
"""
import sys, os, json, subprocess, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]; PRISTINE = ROOT.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(PRISTINE))
from lib.scratch import scratch, mog_render
MOG_TIMEOUT = int(os.environ.get("MOG_TIMEOUT", "7200"))
MOG = ROOT / ".mog/bin/mog"; PY = ROOT / ".venv/bin/python"


def mog_id():
    """Identity of the binary that measured a control. The noise floor is binary-specific:
    a control measured on a NOISIER build silently forgives real agent damage when reused
    with a CLEANER one. Nothing caught that before -- load_controls only checked that the
    file existed."""
    import hashlib
    return hashlib.sha256(MOG.resolve().read_bytes()).hexdigest()[:16]


def _merge(*ds):
    out = {}
    for d in ds:
        for k, v in d.items():
            out.setdefault(k, set()).update(v)
    return out


def key(v):
    """Identity of a violation, ignoring anything run-specific."""
    return "|".join(str(v.get(k, "")) for k in ("kind", "sheet", "cell", "field", "object"))


def violation_state(book, v):
    """What the workbook actually holds at a violated cell. vkey alone is value-blind:
    "mog wobbled this fill" and "the agent painted it red" hash to the SAME key, so
    matching on the key is an unconditional amnesty. Recording the state the control
    produced lets the verdict discount only when the submission matches it."""
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


def states(book_path, grade_result):
    """vkey -> the state this control produced there."""
    from grader.workbook import load_workbook
    bk = load_workbook(str(book_path))
    out = {}
    for v in grade_result["preservation"]["violations"]:
        st = violation_state(bk, v)
        if st is not None:
            out.setdefault(key(v), set()).add(st)
    return out


def lossy_cells(init, base):
    """Cells mog cannot carry through a LOAD, measured by diffing the original workbook
    against mog's own render of it.

    task_15's `Formula Audit!D35` is a literal in init.xlsx -- `<c r="D35"><v>-92884</v></c>`,
    no formula. mog's render drops it to `<c r="D35" s="101"/>`, empty, and only repopulates
    it once other cells are written through the API and a recalc runs. The grader then sees
    base(empty) -> submission(48048.72) and calls it a cell_content violation on a sheet the
    agent never touched.

    Neither existing control sees this. The baseline round-trips base->base, so mog empties
    the cell identically on both sides and reports nothing. A no-op write control does not
    see it either -- writing a cell back with its own content changes nothing, so mog never
    recalculates (measured: 0 violations).

    The honest signal is upstream of all of it: if mog's own render of the untouched
    workbook already disagrees with the original, that cell is a mog blind spot, and any
    later change to it is mog repopulating what it dropped. Costs no extra mog run.
    """
    from grader.workbook import load_workbook, get_cell, raw, all_cells
    a, b = load_workbook(str(init)), load_workbook(str(base))
    out = set()
    for sheet, addr in sorted(all_cells(a) | all_cells(b)):
        if raw(get_cell(a, sheet, addr)) != raw(get_cell(b, sheet, addr)):
            out.add(f"{sheet}|{addr}")
    return out


def grade(task, initial, submission, golden, sc):
    out = Path(sc) / f"g-{task}.json"
    subprocess.run([str(PY), "-m", "grader.google_grade", "--task", task,
                    "--initial", str(initial), "--golden", str(golden),
                    "--submission", str(submission), "--out", str(out)],
                   cwd=str(PRISTINE), check=True, capture_output=True, timeout=1800)
    return json.loads(out.read_text())


def main(tasks):
    controls = {}
    path = ROOT / "out/controls.json"
    if path.exists():
        controls = json.loads(path.read_text())
    for t in tasks:
        init = PRISTINE / f"benchmarks/tasks/{t}/init.xlsx"
        golden = PRISTINE / f"benchmarks/tasks/{t}/golden.xlsx"
        if not (init.exists() and golden.exists()):
            continue
        with scratch(f"ctl-{t}-") as sc:
            base = mog_render(MOG, init, sc / "base.xlsx", sc)
            noop = mog_render(MOG, base, sc / "noop.xlsx", sc)
            gold = mog_render(MOG, golden, sc / "gold.xlsx", sc)

            # A semantic no-op that still DIRTIES the dependency graph: for every graded
            # output cell, write a sentinel and then write the original content straight
            # back. Final state is identical to base, but the write+recalc path runs.
            #
            # This is what catches mog's real churn. task_15's `Formula Audit!D35` is a
            # literal in the file (init and mog's render agree, so it is NOT a load-time
            # loss) yet mog treats it as a formula internally -- writing to `Forecast Model`
            # recalculates it from -92884 to 48048.72, on a sheet the agent never touched.
            # Neither other control sees it: `mog -r` leaves nothing dirty, and writing a
            # cell back with its own content does not dirty it either (measured: 0).
            nop = sc / "nowrite.xlsx"
            spec = json.loads((PRISTINE / f"benchmarks/grading_specs/{t}.json").read_text())
            js = ["var __s, __r, __f, __v;"]
            for sh, addrs in spec.get("outputs", {}).items():
                js.append("__s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(%s);"
                          % json.dumps(sh))
                for a in addrs:
                    js.append("__r = __s.getRange(%s); __f = __r.getFormula(); "
                              "__v = __r.getValue(); __r.setValue(0); "
                              "if (__f) { __r.setFormula(__f); } "
                              "else if (__v === '' || __v === null) { __r.clearContent(); } "
                              "else { __r.setValue(__v); }" % json.dumps(a))
            # Setting a number format is a write an agent legitimately makes (6 of 15 tasks
            # have a number_format requirement), and mog ADDS <scheme val="minor"/> to any
            # font it rewrites -- Google leaves it absent. Re-applying a cell's OWN format is
            # a semantic no-op that reproduces exactly that churn, so it gets measured
            # instead of being discovered as a mystery failure later.
            for sh, ranges in (spec.get("style_editable", {}).get("number_format") or {}).items():
                js.append("__s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(%s);"
                          % json.dumps(sh))
                for rng in ranges:
                    js.append("__r = __s.getRange(%s); __r.setNumberFormat(__r.getNumberFormat());"
                              % json.dumps(rng))
            src = sc / "nowrite.js"
            src.write_text((ROOT / "dist/appsscript.js").read_text() + "\n" + "\n".join(js))
            subprocess.run([str(MOG), "-i", str(base), "-f", str(src), "-o", str(nop)],
                           check=True, capture_output=True, timeout=MOG_TIMEOUT,
                           env={**os.environ, "MOG_SESSION_DIR": str(sc / ".sess-nw")})

            b = grade(t, base, noop, golden, sc)
            w = grade(t, base, nop, golden, sc)
            g = grade(t, base, gold, golden, sc)

            controls[t] = {
                "mog_sha": mog_id(),
                "baseline_violations": sorted({key(v) for v in b["preservation"]["violations"]}),
                "lossy_cells": sorted(lossy_cells(init, base)),
                # vkey -> the states mog produced there. A violation is excused only when
                # the submission MATCHES one of them; otherwise the agent did something else.
                "known_state": {k: sorted(v) for k, v in _merge(
                    states(noop, b), states(nop, w), states(gold, g)).items()},
                "writepath_violations": sorted({key(v) for v in w["preservation"]["violations"]}),
                "golden_violations": sorted({key(v) for v in g["preservation"]["violations"]}),
                # Per CELL, not per id: discounting a whole requirement by name let an
                # agent that did nothing at all pass task_08, because its golden fails
                # `output_number_formats` offline as a mog round-trip artifact.
                "golden_failed_requirements": {
                    r["id"]: sorted({f"{x.get('sheet')}|{x.get('cell')}"
                                     for x in r.get("failures", [])})
                    for r in g.get("requirements", []) if not r["passed"]},
                "golden_correct": [g["correct"], g["total"]],
                "golden_new_errors": sorted(f"{e['sheet']}!{e['cell']}" for e in g["execution"]["new_errors"]),
                # Object kinds mog cannot round-trip deterministically for THIS workbook.
                # If writing the golden already churns the charts, a chart diff carries no
                # signal about the agent -- on any sheet, not just the one that churned.
                "unstable_objects": sorted({v["object"] for v in g["preservation"]["violations"]
                                            if v["kind"] == "sheet_objects"}),
            }
            c = controls[t]
            print(f"  {t}  baseline={len(c['baseline_violations']):3d}  "
                  f"golden={len(c['golden_violations']):3d}  "
                  f"lossy={len(c['lossy_cells']):3d}  "
                  f"writepath={len(c['writepath_violations']):3d}  "
                  f"golden_reqs_failed={list(c['golden_failed_requirements']) or '-'}  "
                  f"golden_score={c['golden_correct'][0]}/{c['golden_correct'][1]}")
            path.parent.mkdir(parents=True, exist_ok=True)   # a fresh clone has no out/
    path.write_text(json.dumps(controls, indent=1, sort_keys=True))
    print(f"\n  wrote {path}")


if __name__ == "__main__":
    main(sys.argv[1:] or [f"task_{i:02d}" for i in range(1, 16)])
