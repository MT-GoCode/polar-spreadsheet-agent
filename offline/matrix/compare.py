#!/usr/bin/env python3
"""Compare the suite offline (shim on mog) against online (real Apps Script).

Every case recorded three things, and a difference in ANY of them is a divergence:
  [0] what the call RETURNED
  [1] the cell's FULL state after   (value, formula, format, 11 style axes, isBlank)
  [2] the state it started FROM

A case that THREW on both sides with the same error is a MATCH, not a failure -- the shim
is supposed to raise what Apps Script raises. Only a differing error counts.
"""
import json, sys, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OFF = ROOT / "out/suite-offline.json"
ON = ROOT / "out/suite-online.json"

# Divergences verified against real Apps Script and consciously accepted, each with a reason.
# The gate is GREEN when only these appear and RED the moment anything new does.
ACCEPTED = {}

def norm(r):
    """Strip provenance; keep only the answer."""
    return {k: v for k, v in r.items() if k != "h"}

def main():
    if not ON.exists():
        print(f"  no {ON} yet -- run RUN in Apps Script and fetch matrix-online.json")
        return 2
    a = json.loads(OFF.read_text()); b = json.loads(ON.read_text())
    common = sorted(set(a) & set(b))
    only_off = sorted(set(a) - set(b)); only_on = sorted(set(b) - set(a))
    bad, accepted, both_threw = [], [], 0
    for k in common:
        x, y = norm(a[k]), norm(b[k])
        if x == y:
            if not x.get("ok"): both_threw += 1
            continue
        (accepted if k in ACCEPTED else bad).append(k)

    by = collections.Counter(k.split(".")[0] for k in bad)
    for k in bad[:40]:
        print(f"  DIVERGE {k}")
        print(f"     mog   : {json.dumps(norm(a[k]))[:190]}")
        print(f"     google: {json.dumps(norm(b[k]))[:190]}")
    if len(bad) > 40:
        print(f"  ... and {len(bad)-40} more")

    print(f"\n  {len(common)-len(bad)}/{len(common)} identical"
          f"   ({both_threw} of them threw identically on both sides)")
    print(f"  {len(accepted)} accepted, {len(bad)} NEW")
    if by: print(f"  divergences by kind: {dict(by.most_common())}")
    if only_off: print(f"  {len(only_off)} cases offline with no online result (online run incomplete?)")
    if only_on:  print(f"  {len(only_on)} cases online with no offline result")
    # A missing case is not a passing case. This used to exit 0 while printing
    # "11338 cases offline with no online result" as a note, so a run that died
    # part-way through read as a green gate on 0.3% coverage.
    if only_off or only_on:
        print(f"  INCOMPLETE: {len(only_off)} offline-only, {len(only_on)} online-only")
    return 1 if (bad or only_off or only_on) else 0

if __name__ == "__main__":
    sys.exit(main())
