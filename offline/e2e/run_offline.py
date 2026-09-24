#!/usr/bin/env python3
"""END-TO-END offline: run a 'perfect agent' Apps Script through the shim on mog and
grade the result with the real grader. If a script that writes the golden's own answers
does not score PASS offline, the harness is not usable regardless of what the component
gates say."""
import sys, os, json, subprocess, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]; PRISTINE = ROOT.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(PRISTINE))
from lib.scratch import scratch, mog_render
MOG = ROOT / ".mog/bin/mog"; PY_BIN = ROOT / ".venv/bin/python"
# task_04 writes a 164x116 grid of SUMIFs; mog recalculates the whole grid and needs ~50 min.
MOG_TIMEOUT = int(os.environ.get("MOG_TIMEOUT", "7200"))

def main(task):
    init = PRISTINE / f"benchmarks/tasks/{task}/init.xlsx"
    golden = PRISTINE / f"benchmarks/tasks/{task}/golden.xlsx"
    sol = ROOT / f"e2e/solution-{task}.js"
    if not sol.exists():
        subprocess.run([str(PY_BIN), str(ROOT / "e2e/make_solution.py"), task], check=True)
    body = sol.read_text().replace("__LOG__", "__mogLog")
    with scratch(f"e2e-{task}-") as sc:
        base = mog_render(MOG, init, sc / "base.xlsx", sc)      # the agent's starting point
        script = sc / "agent.js"
        # The shim records which sheets the agent wrote to, BY NAME, resolved through the
        # agent's own handles. It returns null if it cannot vouch for the record, and the
        # verdict then discounts nothing.
        probe = ('\ntry{__mogLog("__WROTE__ "+JSON.stringify(GAS.writtenSheetNames()));}'
                 'catch(e){__mogLog("__WROTE__ null");}\n')
        script.write_text((ROOT / "dist/appsscript.js").read_text() + "\n" + body + probe)
        out = sc / "out.xlsx"
        r = subprocess.run([str(MOG), "-i", str(base), "-f", str(script), "-o", str(out)],
                           capture_output=True, text=True, timeout=MOG_TIMEOUT)
        log = (r.stdout + r.stderr).strip().splitlines()
        print("  agent script:", log[-1][:90] if log else f"exit {r.returncode}")
        if not out.exists():
            # The script threw, so there is nothing to grade. Apps Script would have
            # thrown too -- the shim raises the same exceptions Google does.
            print("\n  FAIL:\n    - the agent's script threw and produced no workbook:")
            for line in log[-4:]: print(f"        {line[:160]}")
            print("\n  E2E OFFLINE: FAIL")
            return 1
        g = sc / "grade.json"
        subprocess.run([str(PY_BIN), "-m", "grader.google_grade", "--task", task,
                        "--initial", str(base), "--golden", str(golden),
                        "--submission", str(out), "--out", str(g)],
                       cwd=str(PRISTINE), check=True, capture_output=True, timeout=1800)
        d = json.loads(g.read_text())
        # The raw grade still contains mog's own artifacts. verdict.classify subtracts
        # the per-task controls and returns only what the agent is responsible for.
        wrote = None
        for line in log:
            if line.startswith("__WROTE__ "):
                try: wrote = json.loads(line[len("__WROTE__ "):])
                except Exception: wrote = None
        from e2e.verdict import classify
        failures, discounted = classify(d, task, wrote_sheets=wrote, submission=out,
                                        initial=base)
        print(f"\n  score        {d['correct']}/{d['total']}  ({d['score']:.3f})")
        print(f"  violations   {len(d['preservation']['violations'])} raw, "
              f"{len(discounted)} discounted as mog artifacts")
        if failures:
            print("\n  FAIL:")
            for x in failures: print(f"    - {x}")
        print(f"\n  E2E OFFLINE: {'PASS' if not failures else 'FAIL'}")
        return 0 if not failures else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "task_09"))
