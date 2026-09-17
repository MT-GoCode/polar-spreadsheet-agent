"""Scoring is independent of Excel/Sheets execution and workbook I/O."""
from __future__ import annotations

import math
import re
from .workbook import all_cells, expand, get_cell, raw, STYLE_FIELDS


def values_match(actual, expected, abs_tol=1e-8, rel_tol=1e-6):
    # bool is a subclass of int in Python, but TRUE must not equal 1 here.
    if isinstance(actual, bool) or isinstance(expected, bool):
        return type(actual) is type(expected) and actual == expected
    if isinstance(expected, (int, float)):
        return (isinstance(actual, (int, float)) and math.isfinite(actual)
                and math.isfinite(expected)
                and abs(actual - expected) <= max(abs_tol, rel_tol * abs(expected)))
    return type(actual) is type(expected) and actual == expected


def cell_style(book, sheet, address):
    data = book["sheets"].get(sheet, {})
    return get_cell(book, sheet, address).get("style", data.get("default_style", {}))


def grade(spec, initial, golden, actual, *, recalculated=False, execution_status="completed", native_preservation=None):
    outputs = expand(spec["outputs"])
    if not outputs:
        raise ValueError("A task must have at least one scored output")
    editable = expand(spec.get("editable", spec["outputs"]))
    formula_required = expand(spec.get("formula_required", {}))
    hardcode_required = expand(spec.get("hardcode_required", {}))
    tolerance_overrides = [(expand(x["ranges"]), x) for x in spec.get("tolerance_overrides", [])]
    failures = []
    correct = 0
    for sheet, address in sorted(outputs):
        expected = get_cell(golden, sheet, address)
        observed = get_cell(actual, sheet, address)
        tolerance = spec.get("tolerance", {"absolute": 1e-8, "relative": 1e-6})
        for refs, override in tolerance_overrides:
            if (sheet, address) in refs:
                tolerance = override
        reasons = []
        if sheet not in actual["sheets"]:
            reasons.append("missing_sheet")
        elif expected.get("error"):
            if observed.get("error") != expected["error"]:
                reasons.append("wrong_error")
        elif observed.get("error") or not values_match(observed.get("value"), expected.get("value"),
                                                       tolerance["absolute"], tolerance["relative"]):
            reasons.append("wrong_value")
        if (sheet, address) in formula_required and observed.get("formula") is None:
            reasons.append("formula_required")
        if (sheet, address) in hardcode_required and observed.get("formula") is not None:
            reasons.append("hardcode_required")
        if expected.get("formula") is not None and expected.get("value") is None:
            reasons.append("missing_golden_cache")
        if observed.get("formula") is not None and observed.get("value") is None:
            reasons.append("missing_submission_cache")
        if reasons:
            failures.append({"sheet": sheet, "cell": address, "reasons": reasons,
                             "expected": expected.get("value"), "actual": observed.get("value")})
        else:
            correct += 1

    violations = []
    if initial.get("sheet_order") != actual.get("sheet_order"):
        violations.append({"kind": "sheet_structure"})
    if initial.get("defined_names") != actual.get("defined_names"):
        violations.append({"kind": "defined_names"})
    allowed_styles = {field: expand(spec.get("style_editable", {}).get(field, {}))
                      for field in STYLE_FIELDS}
    for sheet, address in sorted(all_cells(initial) | all_cells(actual)):
        before, after = get_cell(initial, sheet, address), get_cell(actual, sheet, address)
        if (sheet, address) not in editable and raw(before) != raw(after):
            violations.append({"kind": "cell_content", "sheet": sheet, "cell": address})
        old_style, new_style = cell_style(initial, sheet, address), cell_style(actual, sheet, address)
        for field in STYLE_FIELDS:
            if (sheet, address) not in allowed_styles[field] and old_style.get(field) != new_style.get(field):
                violations.append({"kind": "cell_style", "field": field, "sheet": sheet, "cell": address})
    for sheet, before in initial["sheets"].items():
        after = actual["sheets"].get(sheet)
        if after is None:
            continue
        if before.get("structure") != after.get("structure"):
            violations.append({"kind": "sheet_layout", "sheet": sheet})
        allowed_objects = spec.get("object_editable", {}).get(sheet, [])
        for kind, objects in before.get("objects", {}).items():
            if kind not in allowed_objects and objects != after.get("objects", {}).get(kind):
                violations.append({"kind": "sheet_objects", "sheet": sheet, "object": kind})

    ignored_export_differences = []
    if native_preservation is not None:
        from .native_preservation import reconcile
        violations, ignored_export_differences = reconcile(violations, spec, *native_preservation)

    requirements = []
    for check in spec.get("requirements", []):
        mismatches = []
        if check["kind"] == "style_matches_golden":
            for sheet, address in sorted(expand(check["ranges"])):
                for field in check["fields"]:
                    if cell_style(actual, sheet, address).get(field) != cell_style(golden, sheet, address).get(field):
                        mismatches.append({"sheet": sheet, "cell": address, "field": field})
        elif check["kind"] == "number_format":
            for sheet, address in sorted(expand(check["ranges"])):
                fmt = cell_style(actual, sheet, address).get("number_format", "General")
                if not number_format_matches(fmt, check["decimal_places"], check["percent"]):
                    mismatches.append({"sheet": sheet, "cell": address, "number_format": fmt})
        elif check["kind"] == "binary_toggle":
            from .toggle_checks import check_toggle
            mismatches.extend(check_toggle(actual, check, cell_style))
        elif check["kind"] == "objects_match_golden":
            for sheet in check["sheets"]:
                for kind in check["objects"]:
                    if actual["sheets"].get(sheet, {}).get("objects", {}).get(kind) != golden["sheets"][sheet]["objects"][kind]:
                        mismatches.append({"sheet": sheet, "object": kind})
        elif check["kind"] == "cell_value":
            for sheet, address in sorted(expand(check["ranges"])):
                cell = get_cell(actual, sheet, address)
                if cell.get("error") or not values_match(cell.get("value"), check["value"],
                                                         check.get("absolute", 1e-8), check.get("relative", 1e-6)):
                    mismatches.append({"sheet": sheet, "cell": address})
        else:
            raise ValueError(f"Unknown requirement kind: {check['kind']}")
        requirements.append({"id": check["id"], "passed": not mismatches, "failures": mismatches})

    errors = []
    for sheet, address in sorted(all_cells(actual)):
        before, after = get_cell(initial, sheet, address), get_cell(actual, sheet, address)
        error = after.get("error")
        def has_broken_ref(cell):
            f = cell.get("formula")
            return isinstance(f, str) and "#REF!" in re.sub(r'"(?:[^"]|"")*"', '', f)
        broken_ref, old_broken_ref = has_broken_ref(after), has_broken_ref(before)
        if (error and error != before.get("error")) or (broken_ref and not old_broken_ref):
            errors.append({"sheet": sheet, "cell": address, "error": error or "#REF!"})
    trusted = recalculated or actual.get("calculation") == "recalculated"
    passed_checks = correct == len(outputs) and not violations and all(c["passed"] for c in requirements) and not errors
    return {
        "task_id": spec["task_id"], "score": correct / len(outputs) if outputs else 0,
        "correct": correct, "total": len(outputs), "output_failures": failures,
        "preservation": {"passed": not violations, "violations": violations,
                         "basis": "native_entered_state_and_export_structure" if native_preservation is not None else "export",
                         "ignored_export_differences": ignored_export_differences},
        "requirements": requirements,
        "execution": {"status": execution_status, "calculation_verified": trusted,
                      "source_warnings": actual.get("source_warnings", []),
                      "new_errors": errors, "circular_reference_check": "not_implemented"},
        "passed": bool(passed_checks and execution_status == "completed") if trusted else None,
        "provisional": not trusted,
    }


def number_format_matches(fmt, decimal_places, percent):
    """Check fixed-decimal numeric sections; ignore unrequested presentation details.

    This deliberately supports ordinary fixed-point formats, not the whole Excel
    grammar. Reject scaling, conditional sections, scientific and fraction formats.
    A literal zero section (e.g. a dash) is permitted; hidden positives/negatives are not.
    """
    stripped = re.sub(r'"[^"]*"|\\.|_.|\*.', '', fmt)
    if re.search(r'\[(?:[<>=]|[hms])', stripped, re.I):
        return False
    stripped = re.sub(r'\[[^]]*\]', '', stripped)
    sections = stripped.split(';')[:3]
    for index, section in enumerate(sections):
        if not re.search(r'[0#]', section):
            if index == 2:
                continue
            return False
        if re.search(r'[Ee/]|[0#?],+(?:[^0#?]|$)', section):
            return False
        match = re.search(r'\.([0#?]+)', section)
        decimals = match.group(1) if match else ''
        if decimals != '0' * decimal_places or section.count('%') != int(percent):
            return False
    return bool(sections)
