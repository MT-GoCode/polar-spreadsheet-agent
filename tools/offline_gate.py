#!/usr/bin/env python3
"""Offline pass gate. Applies the real grading criterion (grader/scoring.py:138) and
strips two preservation artifacts the offline engine creates but Google Sheets does not.

The grader itself is never modified. This post-processes its grade.json so the offline
number approximates what native grading reports. Online,
grader/native_preservation.reconcile() discards every export-basis cell_content
violation and rebuilds from Sheets entered-state; these corrections mirror that.

  (b) cell_style font/fill, anywhere. The agent has NO way to change a cell's font or
      fill: there is no typed tool for either, and HATCH_BAN blocks setFont*/setBackground*
      in run_apps_script. Every offline font/fill diff is therefore the engine rewriting a
      cell's whole style record when it writes that cell's number format or border --
      measured: setting a cell's own EXISTING number format yields 7 violations on 3 cells,
      and Google Sheets' setNumberFormat does not touch font or fill.
      PREMISE: no tool can write font or fill. Enforced by the hatch-ban assertions in
      offline/toolpath_test.mjs. If a font or fill tool is ever added, delete this rule --
      it would then hide real violations. number_format, border, alignment and protection
      are NOT forgiven, because the agent can and does change those.
  (c) cell_content where both sides are plain numbers differing only in float
      serialization (engine shortens 52.910000000000004 to 52.91).

Correction (a) -- grading against a shim round-tripped init.xlsx -- is not here; it is
an input change, see offline/baseline.mjs.

ESTIMATE, NOT A GRADE. (b) can over-forgive: a cell where only number_format was
permitted has its font forgiven too. Only an online run certifies a pass
(grader/google_grade.py requires engine == 'google-apps-script' and stableSamples >= 3).
"""
import argparse, json, sys, os

REL_TOL = 1e-12  # last-ulp only: 52.910000000000004 vs 52.91 is 6.7e-17 relative


def float_only(before, after):
    """True when both cells are plain numbers equal to within float-serialization noise."""
    if before.get("formula") is not None or after.get("formula") is not None:
        return False
    b, a = before.get("value"), after.get("value")
    if isinstance(b, bool) or isinstance(a, bool):
        return False
    if not isinstance(b, (int, float)) or not isinstance(a, (int, float)):
        return False
    return abs(a - b) <= REL_TOL * max(1.0, abs(b))


def gate(spec, grade, initial, submission):
    from grader.workbook import get_cell
    real, dropped = [], {"engine_font_fill_rewrite": 0, "float_serialization": 0}
    for v in grade["preservation"]["violations"]:
        if v["kind"] == "cell_style" and v.get("field") in ("font", "fill"):
            dropped["engine_font_fill_rewrite"] += 1
            continue
        if v["kind"] == "cell_content" and initial is not None:
            if float_only(get_cell(initial, v["sheet"], v["cell"]),
                          get_cell(submission, v["sheet"], v["cell"])):
                dropped["float_serialization"] += 1
                continue
        real.append(v)
    failed_reqs = [c["id"] for c in grade.get("requirements", []) if not c["passed"]]
    new_errors = grade["execution"]["new_errors"]
    passed = (grade["correct"] == grade["total"] and not real
              and not failed_reqs and not new_errors
              and grade["execution"]["status"] == "completed")
    return {
        "task_id": grade["task_id"], "basis": "offline_estimate",
        "passed_offline": bool(passed), "score": grade["score"],
        "correct": grade["correct"], "total": grade["total"],
        "real_violations": real, "real_violation_count": len(real),
        "dropped_artifacts": dropped,
        "failed_requirements": failed_reqs, "new_error_count": len(new_errors),
        "output_failure_reasons": sorted({r for f in grade["output_failures"] for r in f["reasons"]}),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--task", required=True)
    p.add_argument("--grade", required=True)
    p.add_argument("--initial", required=True, help="the round-tripped baseline, not init.xlsx")
    p.add_argument("--submission", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, root)
    from grader.workbook import load_workbook
    spec = json.load(open(os.path.join(root, "benchmarks/grading_specs", a.task + ".json")))
    grade = json.load(open(a.grade))
    initial = load_workbook(a.initial) if os.path.exists(a.initial) else None
    submission = load_workbook(a.submission)
    r = gate(spec, grade, initial, submission)
    with open(a.out, "w") as f:
        json.dump(r, f, indent=1)
    extra = ""
    if not r["passed_offline"]:
        bits = []
        if r["correct"] != r["total"]:
            bits.append(f"{r['total'] - r['correct']} cells({','.join(r['output_failure_reasons'])})")
        if r["real_violation_count"]:
            bits.append(f"{r['real_violation_count']} viol")
        if r["failed_requirements"]:
            bits.append("req:" + ",".join(r["failed_requirements"]))
        if r["new_error_count"]:
            bits.append(f"{r['new_error_count']} new-errors")
        extra = " [" + "; ".join(bits) + "]"
    print(f"gate: {'PASS' if r['passed_offline'] else 'FAIL'} score={r['score']:.4f} "
          f"real_viol={r['real_violation_count']} dropped={sum(r['dropped_artifacts'].values())}{extra}")


if __name__ == "__main__":
    main()
