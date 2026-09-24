#!/usr/bin/env python3
"""Integration test for the write record. Run: .venv/bin/python e2e/test_writerecord.py

This exists because test_verdict.py could not have caught the bug that mattered. It passes
sheet NAMES straight into classify(), so the id->name hop -- the only part that can fail --
was never exercised. The first version of the record keyed on GAS.nid() handles and resolved
them against a FRESH getSheets(), whose handles are disjoint by construction. The result was
always [], every violation carrying a sheet was discounted, and a full sweep read 15/15 while
checking nothing.

So this runs real Apps Script through real mog and asserts on what comes back.
"""
import sys, os, subprocess, json, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]; PRISTINE = ROOT.parent
sys.path.insert(0, str(ROOT))
from lib.scratch import scratch
MOG = ROOT / ".mog/bin/mog"
INIT = PRISTINE / "benchmarks/tasks/task_09/init.xlsx"
SHEET = "Trading Comps"

CASES = [
    ("a plain write is recorded BY NAME, not by handle",
     f'ss.getSheetByName("{SHEET}").getRange("A1").setValue(42);', [SHEET]),
    ("clearConditionalFormatRules counts as a write (cfQuery{method:'clear'} mutates)",
     f'ss.getSheetByName("{SHEET}").clearConditionalFormatRules();', [SHEET]),
    ("a read-only run records nothing",
     f'ss.getSheetByName("{SHEET}").getRange("A1").getValue();', []),
    ("a mutation naming no worksheet makes the record INCOMPLETE -> null, never []",
     'ss.getSheets()[0].setName("Renamed");', None),
]


def run(body, sc, n):
    src = sc / f"w{n}.js"
    src.write_text((ROOT / "dist/appsscript.js").read_text() +
                   "\nvar ss = SpreadsheetApp.getActiveSpreadsheet();\n" + body +
                   '\n__mogLog("__WROTE__ " + JSON.stringify(GAS.writtenSheetNames()));\n')
    env = {**os.environ, "MOG_SESSION_DIR": str(sc / f".s{n}")}
    (sc / f".s{n}").mkdir(exist_ok=True, mode=0o700)
    r = subprocess.run([str(MOG), "-i", str(INIT), "-f", str(src), "-o", str(sc / f"o{n}.xlsx")],
                       capture_output=True, text=True, timeout=900, env=env)
    for line in (r.stdout + r.stderr).splitlines():
        if line.startswith("__WROTE__ "):
            return json.loads(line[len("__WROTE__ "):])
    raise SystemExit(f"no __WROTE__ line; mog said: {(r.stdout + r.stderr)[-300:]}")


def main():
    bad = 0
    with scratch("wrec-") as sc:
        for n, (name, body, want) in enumerate(CASES):
            got = run(body, sc, n)
            ok = got == want
            bad += not ok
            print(f"  {'ok  ' if ok else 'FAIL'}  {name}\n        got {got!r}, want {want!r}")
    print(f"\n  {len(CASES) - bad}/{len(CASES)} passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
