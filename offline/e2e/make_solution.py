#!/usr/bin/env python3
"""Generate a 'perfect agent' Apps Script for a task: it writes exactly the golden's
own answers into the graded output ranges. Running it BOTH ways and comparing the
grader's verdict tests the real claim -- offline-green implies online-green -- rather
than the individual components."""
import json, sys, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]; PRISTINE = ROOT.parent
sys.path.insert(0, str(PRISTINE))
from grader.workbook import load_workbook, get_cell
from grader.scoring import expand, cell_style


def js_value(v):
    """The grader projects a date cell as {'date': ISO}. Apps Script writes those with a
    real Date object, so emit one -- json.dumps would produce a JS object literal and the
    shim would (correctly) reject it."""
    if isinstance(v, dict) and "date" in v:
        return f'new Date({v["date"]!r})'.replace("'", '"')
    return json.dumps(v)


def array_spill(xlsx):
    """(sheet, address) for every NON-anchor cell covered by an array formula's ref."""
    import zipfile, re
    z = zipfile.ZipFile(xlsx)
    names = {}
    wb = z.read("xl/workbook.xml").decode("utf8", "replace")
    for i, m in enumerate(re.finditer(r'<sheet name="([^"]+)"', wb)):
        names[f"sheet{i+1}.xml"] = m.group(1).replace("&amp;", "&")
    out = set()
    for n in z.namelist():
        base = n.split("/")[-1]
        if base not in names or "/worksheets/" not in n:
            continue
        x = z.read(n).decode("utf8", "replace")
        # The gap between the <c> tag and its <f> must not cross ANOTHER cell. Guarding
        # only on "</c>" is not enough: an empty cell is written self-closing
        # (<c r="D45" s="94"/>) and carries no "</c>" to stop at, so the match ran on into
        # the NEXT cell's array formula and named the wrong anchor -- 'D&A Schedule'!E45
        # (=TRANSPOSE(...) over E45:I45, preceded by <c r="C45"/><c r="D45"/>) was reported
        # as its own spill cell and never written at all.
        for m in re.finditer(r'<c r="([A-Z]+\d+)"[^>]*>(?:(?!</?c[ />]).)*?<f[^>]*t="array"[^>]*ref="([^"]+)"', x, re.S):
            anchor, ref = m.group(1), m.group(2)
            for addr in expand({names[base]: [ref]}):
                if addr[1] != anchor:
                    out.add(addr)
    return out


def main(task):
    spec = json.loads((PRISTINE / f"benchmarks/grading_specs/{task}.json").read_text())
    gpath = PRISTINE / f"benchmarks/tasks/{task}/golden.xlsx"
    golden = load_workbook(gpath)
    cells = sorted(expand(spec["outputs"]))
    # An array formula owns its whole spill range: the anchor carries the formula and the
    # rest of the range carries no formula, only spilled values. Writing those spilled
    # cells individually is what Google refuses with "You cannot change part of an array
    # formula" -- and mog refuses it identically. Write the anchor and skip the spill.
    spilled = array_spill(gpath)
    cells = [c for c in cells if c not in spilled]

    def gcell(sheet, addr):
        """The golden's cell, with any NON-STRING formula reduced to a literal one.
        grader/workbook.py:96 returns {'kind','attributes'} for a formula openpyxl cannot
        render as text -- here an Excel DATA TABLE ('Operating Valuation'!D99 and D109,
        <f t="dataTable" ref="D99:H103">). A data table has no Apps Script representation
        at all, so the golden's own formula is simply unwritable; emitting its repr put a
        JS object into setFormula and mog rejected it. `formula_required` only asks that
        SOME formula be present, so write the cached value as one."""
        c = get_cell(golden, sheet, addr)
        f = c.get("formula")
        if f is not None and not isinstance(f, str):
            c = dict(c, formula="=" + json.dumps(c.get("value")))
        return c

    lines = ["var ss = SpreadsheetApp.getActiveSpreadsheet();"]
    by_sheet = {}
    for sheet, addr in cells:
        by_sheet.setdefault(sheet, []).append(addr)
    # Batch each ROW's contiguous run into one setValues/setFormulas call. Writing
    # cell-by-cell makes mog recalculate once PER CELL: task_04 (19,024 cells) then
    # exceeds a 20-minute timeout, while batched it is seconds. A real agent batches too.
    from grader.workbook import coordinates
    import re as _re
    def split(addr):
        m = _re.match(r"([A-Z]+)(\d+)$", addr)
        return m.group(1), int(m.group(2))
    def colnum(c):
        n = 0
        for ch in c: n = n * 26 + (ord(ch) - 64)
        return n
    def colname(n):
        s = ""
        while n > 0:
            n, r = divmod(n - 1, 26); s = chr(65 + r) + s
        return s
    for sheet, addrs in by_sheet.items():
        lines.append(f"var sh = ss.getSheetByName({sheet!r});")
        rows = {}
        for a in addrs:
            c, r = split(a); rows.setdefault(r, []).append(colnum(c))
        # If the output is one solid rectangle, write it in ONE setFormulas call:
        # mog recalculates per call, so 164 row-calls on task_04 costs 164 full
        # recalcs of a 19k-cell SUMIF grid. One call is one recalc.
        rs = sorted(rows)
        if rs and all(sorted(rows[r]) == sorted(rows[rs[0]]) for r in rs) and rs == list(range(rs[0], rs[-1]+1)):
            cols = sorted(rows[rs[0]])
            if cols == list(range(cols[0], cols[-1]+1)):
                grid = [[gcell(sheet, f"{colname(c)}{r}") for c in cols] for r in rs]
                if all(x.get("formula") is not None for row in grid for x in row):
                    a1 = f"{colname(cols[0])}{rs[0]}:{colname(cols[-1])}{rs[-1]}"
                    vals = [[x["formula"] for x in row] for row in grid]
                    lines.append(f"sh.getRange({a1!r}).setFormulas({json.dumps(vals)});")
                    continue
        for r in sorted(rows):
            cols = sorted(rows[r])
            run = [cols[0]]
            for c in cols[1:] + [None]:
                if c is not None and c == run[-1] + 1:
                    run.append(c); continue
                a1 = f"{colname(run[0])}{r}:{colname(run[-1])}{r}"
                run_cells = [gcell(sheet, f"{colname(x)}{r}") for x in run]
                if all(x.get("formula") is not None for x in run_cells):
                    vals = [x["formula"] for x in run_cells]
                    lines.append(f"sh.getRange({a1!r}).setFormulas([{json.dumps(vals)}]);")
                elif all(x.get("formula") is None for x in run_cells):
                    vals = [js_value(x.get("value")) for x in run_cells]
                    lines.append(f"sh.getRange({a1!r}).setValues([[{', '.join(vals)}]]);")
                else:
                    for x, cell in zip(run, run_cells):
                        ref = f"{colname(x)}{r}"
                        if cell.get("formula") is not None:
                            lines.append(f"sh.getRange({ref!r}).setFormula({cell['formula']!r});")
                        else:
                            lines.append(f"sh.getRange({ref!r}).setValue({js_value(cell.get('value'))});")
                if c is not None: run = [c]
    # A perfect agent must also satisfy number_format requirements, not just write values.
    # Without this the fixture fails task_08's `output_number_formats` on 48 cells -- which
    # was invisible while verdict.py discounted that requirement by NAME. Copy the golden's
    # own format for each cell the requirement covers: that is by definition what a correct
    # submission looks like.
    nfmt = 0
    for req in spec.get("requirements", []):
        if req.get("kind") != "number_format" or not isinstance(req.get("ranges"), dict):
            continue
        for sheet, addr in sorted(expand(req["ranges"])):
            f = cell_style(golden, sheet, addr).get("number_format")
            if f and f != "General":
                lines.append(f"ss.getSheetByName({sheet!r}).getRange({addr!r})"
                             f".setNumberFormat({f!r});")
                nfmt += 1
    lines.append('__LOG__("wrote " + %d + " cells, %d number formats");' % (len(cells), nfmt))
    out = ROOT / f"e2e/solution-{task}.js"
    out.write_text("\n".join(lines))
    print(f"  {task}: {len(cells)} output cells across {len(by_sheet)} sheet(s) -> {out.name}")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "task_09"))
