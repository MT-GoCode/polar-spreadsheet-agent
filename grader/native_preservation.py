"""Preservation evidence from entered Sheets state, excluding computed/export artifacts."""
from .workbook import expand
from openpyxl.utils.cell import coordinate_to_tuple


def unpack(envelope):
    if (
        envelope.get("schema_version") != 1
        or envelope.get("complete") is not True
        or envelope.get("status") != "snapshot"
    ):
        raise ValueError("Incomplete native preservation snapshot")
    data = envelope.get("data", {})
    if (
        not data.get("spreadsheetId")
        or data["spreadsheetId"] != envelope.get("spreadsheetId")
        or "sheets" not in data
    ):
        raise ValueError("Invalid native preservation identity")
    sheets = {}
    for sheet in data["sheets"]:
        name = sheet["properties"]["title"]
        if name in sheets:
            raise ValueError("Duplicate native sheet")
        if not all(k in sheet for k in ("cells", "formats", "validations", "coverage")):
            raise ValueError("Native snapshot lacks entered-state coverage")
        cells = {}
        for address, value, fmt, validation in sheet["cells"]:
            if address in cells:
                raise ValueError("Native snapshot contains overlapping cells")
            cells[address] = {
                "userEnteredValue": value,
                "userEnteredFormat": sheet["formats"][fmt],
                "dataValidation": sheet["validations"][validation],
            }
        sheets[name] = {
            "cells": cells,
            "coverage": sheet["coverage"],
            "conditional_formats": sheet.get("conditionalFormats", []),
        }
    return sheets


def style_part(cell, field):
    fmt = cell.get("userEnteredFormat", {})
    keys = {
        "number_format": ["numberFormat"],
        "font": ["textFormat", "_textFormatRuns", "_chipRuns"],
        "fill": ["backgroundColor", "backgroundColorStyle"],
        "border": ["borders"],
        "alignment": [
            "horizontalAlignment",
            "verticalAlignment",
            "wrapStrategy",
            "textDirection",
            "textRotation",
            "padding",
        ],
    }.get(field)
    return {k: fmt.get(k) for k in keys} if keys else None


def reconcile(violations, spec, before, after):
    initial, actual = unpack(before), unpack(after)
    if before["spreadsheetId"] != after["spreadsheetId"]:
        raise ValueError("Native preservation snapshots belong to different workbooks")
    allowed = expand(spec.get("editable", {}))
    result = []
    discarded = []
    for violation in violations:
        kind, sheet, address = (
            violation["kind"],
            violation.get("sheet"),
            violation.get("cell"),
        )
        if kind == "cell_content":
            continue  # Rebuild from entered values/formulas, not export cells or calculated results.
        if sheet in initial and sheet in actual:
            old, new = initial[sheet], actual[sheet]
            a, b = old["cells"].get(address, {}), new["cells"].get(address, {})
            row, col = coordinate_to_tuple(address) if address else (0, 0)
            covered = all(
                row <= book["coverage"]["rows"] and col <= book["coverage"]["columns"]
                for book in (old, new)
            )
            if kind == "cell_style" and covered:
                x, y = style_part(a, violation["field"]), style_part(
                    b, violation["field"]
                )
                if x is not None and x == y:
                    discarded.append(violation)
                    continue
            if kind == "sheet_objects":
                field = violation["object"]
                if field == "conditional_formats" and old[field] == new[field]:
                    discarded.append(violation)
                    continue
        result.append(violation)
    entered_violations = []
    for sheet in sorted(set(initial) | set(actual)):
        old, new = initial.get(sheet, {}).get("cells", {}), actual.get(sheet, {}).get(
            "cells", {}
        )
        for address in sorted(set(old) | set(new)):
            if (sheet, address) in allowed:
                continue
            a, b = old.get(address, {}).get("userEnteredValue"), new.get(
                address, {}
            ).get("userEnteredValue")
            if a != b:
                entered_violations.append(
                    {"kind": "cell_content", "sheet": sheet, "cell": address}
                )
    entered_keys = {(x["sheet"], x["cell"]) for x in entered_violations}
    discarded.extend(
        x
        for x in violations
        if x["kind"] == "cell_content" and (x["sheet"], x["cell"]) not in entered_keys
    )
    result.extend(entered_violations)
    return result, discarded
