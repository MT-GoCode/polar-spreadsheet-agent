"""Semantic checks for ordinary binary spreadsheet print toggles.

Recognizes safe scalar Excel comparisons/boolean expressions; unsupported formula
syntax fails closed. Does not execute arbitrary Python or workbook code.
"""
import ast
import re
from xml.etree import ElementTree as ET
from openpyxl.utils.cell import (
    range_boundaries,
    coordinate_to_tuple,
    column_index_from_string,
    get_column_letter,
)


def covers(ranges, address):
    row, col = coordinate_to_tuple(address)
    for text in ranges.split():
        a, b, c, d = range_boundaries(text.replace("$", ""))
        if (a or 1) <= col <= (c or 16384) and (b or 1) <= row <= (d or 1048576):
            return True
    return False


def normalize_ref(text, sheet):
    return (
        text.replace("'" + sheet.replace("'", "''") + "'!", "")
        .replace(sheet + "!", "")
        .replace("$", "")
        .lstrip("=")
    )


def boolean_formula(formula, cell, value, sheet):
    text = normalize_ref(formula.strip(), sheet)
    text = text.replace("<>", "!=")
    text = re.sub(r"(?<![<>=!])=(?!=)", "==", text)
    tree = ast.parse(text, mode="eval")

    def visit(node):
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (
            str,
            int,
            float,
            bool,
        ):
            return node.value
        if isinstance(node, ast.Name):
            if node.id.upper() == cell.upper():
                return value
            if node.id.upper() in ("TRUE", "FALSE"):
                return node.id.upper() == "TRUE"
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            return (
                -visit(node.operand)
                if isinstance(node.op, ast.USub)
                else +visit(node.operand)
            )
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            a, b = visit(node.left), visit(node.comparators[0])
            op = node.ops[0]
            if isinstance(op, ast.Eq):
                return a == b
            if isinstance(op, ast.NotEq):
                return a != b
            if isinstance(op, ast.Gt):
                return a > b
            if isinstance(op, ast.GtE):
                return a >= b
            if isinstance(op, ast.Lt):
                return a < b
            if isinstance(op, ast.LtE):
                return a <= b
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and not node.keywords
        ):
            name = node.func.id.upper()
            args = [visit(x) for x in node.args]
            if name == "AND" and args:
                return all(args)
            if name == "OR" and args:
                return any(args)
            if name == "NOT" and len(args) == 1:
                return not args[0]
            if name in ("TRUE", "FALSE") and not args:
                return name == "TRUE"
        raise ValueError("Unsupported toggle formula")

    return bool(visit(tree))


def toggle_display(fmt, value):
    # Split sections without treating a quoted/escaped semicolon as a separator.
    tokens = re.findall(r'"[^"]*"|\\.|[^;]|;', fmt)
    sections = [""]
    for token in tokens:
        if token == ";":
            sections.append("")
        else:
            sections[-1] += token
    sections = sections[:3]
    conditional = any(re.search(r"\[(?:[<>=])", s) for s in sections)
    selected = None
    if conditional:
        for section in sections:
            match = re.search(r"\[([<>=]+)(-?\d+(?:\.\d+)?)\]", section)
            if not match or boolean_formula(
                "X1" + match[1] + match[2], "X1", value, ""
            ):
                selected = section
                break
    else:
        selected = sections[2] if value == 0 and len(sections) >= 3 else sections[0]
    if selected is None:
        return None
    selected = re.sub(r"\[[^]]*\]|_.|\*.", "", selected)
    literals = re.findall(r'"([^"]*)"|\\(.)', selected)
    residue = re.sub(r'"[^"]*"|\\.', "", selected).strip()
    return "".join(a or b for a, b in literals).strip() if not residue else None


def relative_formula(formula, ranges, target):
    """Resolve relative CF references at a target cell, retaining absolute locks."""
    a, b, _, _ = range_boundaries(ranges.split()[0].replace("$", ""))
    row, col = coordinate_to_tuple(target)
    dr = row - (b or 1)
    dc = col - (a or 1)

    def ref(m):
        c = column_index_from_string(m[2]) + (0 if m[1] else dc)
        r = int(m[4]) + (0 if m[3] else dr)
        if c < 1 or r < 1:
            raise ValueError("Invalid relative reference")
        return get_column_letter(c) + str(r)

    parts = re.split(r'("[^"]*")', formula)
    for i in range(0, len(parts), 2):
        parts[i] = re.sub(
            r"(?<![A-Za-z0-9_])(\$?)([A-Z]+)(\$?)([1-9]\d*)(?![A-Za-z0-9_])",
            ref,
            parts[i],
        )
    return "".join(parts)


def check_toggle(actual, check, style):
    sheet = check["sheet"]
    cell = check["cell"]
    objects = actual["sheets"].get(sheet, {}).get("objects", {})
    failures = []
    fmt = style(actual, sheet, cell).get("number_format", "General")
    if toggle_display(fmt, 0) != "no" or toggle_display(fmt, 1) != "yes":
        failures.append({"kind": "toggle_display", "cell": cell})
    validations = []
    for xml in objects.get("validations", []):
        rule = ET.fromstring(xml)
        if covers(rule.get("sqref", ""), cell):
            validations.append(rule)
    if not validations or any(
        v.get("type") != "list"
        or normalize_ref(v.findtext("formula1", ""), sheet) != check["source"]
        for v in validations
    ):
        failures.append({"kind": "toggle_validation", "cell": cell})
    for target in check["targets"]:
        matching = []
        for item in objects.get("conditional_formats", []):
            if not covers(item["range"], target):
                continue
            rule = ET.fromstring(item["rule"])
            dxf = ET.fromstring(item.get("style") or "<dxf/>")
            color = dxf.find("font/color")
            black = color is not None and color.get("rgb", "").upper() in (
                "000000",
                "FF000000",
            )
            good = False
            try:
                formula = relative_formula(
                    rule.findtext("formula", ""), item["range"], target
                )
                only_color = all(
                    x.tag == "font" and all(y.tag == "color" for y in x) for x in dxf
                )
                good = (
                    rule.get("type") == "expression"
                    and black
                    and only_color
                    and boolean_formula(formula, cell, 1, sheet)
                    and not boolean_formula(formula, cell, 0, sheet)
                )
            except (ValueError, SyntaxError, TypeError):
                pass
            matching.append(good)
        # Reject conflicting/unsupported overlapping rules rather than guessing precedence.
        if not matching or not all(matching):
            failures.append({"kind": "toggle_conditional_format", "cell": target})
    return failures
