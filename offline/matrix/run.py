#!/usr/bin/env python3
"""Run the full suite offline (shim on mog) and write out/suite-offline.json."""
import sys, json, subprocess, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from lib.scratch import scratch
MOG = ROOT / ".mog/bin/mog"; BASE = ROOT / "matrix/base.xlsx"

BUILD_BASE = """
var ss = SpreadsheetApp.getActiveSpreadsheet(); var sh = ss.getSheets()[0];
prepSheet(sh, true);                    /* the base is defined ONCE, in matrix/sweep.js */
sh.getRange('A1').setValue('base');
"""
DRIVER = """
var ss = SpreadsheetApp.getActiveSpreadsheet(); var sh = ss.getSheets()[0];
var n = 0;
runSuite(sh, PLAN, function (id, thunk) {
  var res = fingerprint(thunk);
  __mogLog("__C__" + JSON.stringify([id, res]));     /* stream, never accumulate */
  n++;
});
__mogLog("__DONE__" + n);
"""

def bundle(plan, pools, extra):
    return "\n".join([(ROOT / "dist/appsscript.js").read_text(),
                      (ROOT / "matrix/fingerprint.js").read_text(),
                      f"var TASK_POOLS = {pools};",
                      (ROOT / "matrix/pools.js").read_text().replace("var TASK_POOLS = null;", ""),
                      (ROOT / "matrix/fixtures.js").read_text(),
                      (ROOT / "matrix/sweep.js").read_text(),
                      f"var PLAN = {plan};", extra])

def ingest(text):
    out, n, threw = {}, 0, 0
    for line in text.splitlines():
        i = line.find("__C__")
        if i >= 0:
            cid, res = json.loads(line[i + 5:])
            out[cid] = res
            if not res.get("ok"): threw += 1
        elif "__DONE__" in line:
            n = int(line.split("__DONE__")[1].strip())
    if not out:
        print(text[-1200:]); return 1
    (ROOT / "out/suite-offline.json").write_text(json.dumps(out, sort_keys=True))
    print(f"  offline: {len(out)} cases ({threw} threw), driver counted {n}"
          f" -> out/suite-offline.json")
    return 0


def main(argv):
    pools = (ROOT / "matrix/pools-from-tasks.json").read_text()
    plan = (ROOT / "matrix/plan.json").read_text()
    # The pinned mog binary is a native build per platform. --emit writes the exact bundle
    # so it can be run wherever that binary lives, and --ingest parses the log back.
    if "--emit" in argv:
        out = Path(argv[argv.index("--emit") + 1])
        out.write_text(bundle(plan, pools, DRIVER))
        print(f"  bundle: {out} ({out.stat().st_size} bytes)")
        return 0
    if "--ingest" in argv:
        return ingest(Path(argv[argv.index("--ingest") + 1]).read_text())
    if "--build-base" in argv:
        with scratch("base-") as sc:
            js = sc / "b.js"; js.write_text(bundle(plan, pools, BUILD_BASE))
            r = subprocess.run([str(MOG), "-f", str(js), "-o", str(BASE)],
                               capture_output=True, text=True, timeout=900)
            print(f"  base: {BASE.stat().st_size} bytes" if BASE.exists() else (r.stdout+r.stderr)[-600:])
        return 0
    with scratch("suite-") as sc:
        js = sc / "s.js"; js.write_text(bundle(plan, pools, DRIVER))
        r = subprocess.run([str(MOG), "-i", str(BASE), "-f", str(js), "-o", str(sc / "o.xlsx")],
                           capture_output=True, text=True, timeout=7200)
        return ingest(r.stdout + r.stderr)

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
