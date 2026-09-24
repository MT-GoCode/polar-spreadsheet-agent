#!/usr/bin/env python3
"""Pin the differ. The divergence COUNT is the number this project is steered by, so a
differ that silently changes what it groups makes every previous report unreadable.

An earlier version compared only `.v` and missed differences nested deeper, so unrelated
bugs collapsed into one meaningless row ("mog=null google=null", 1871 cases)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from causes import first_diff, norm

CASES = [
    # (a, b, expected path, expected pair)
    ({"v": 1}, {"v": 2}, "/v", (1, 2)),
    # the nesting the old differ was blind to
    ({"shape": {"items": [{"v": "1."}]}}, {"shape": {"items": [{"v": "1"}]}},
     "/shape/items[0]/v", ("1.", "1")),
    # a key present on one side only
    ({"error": None}, {"error": {"message": "x"}}, "/error", (None, {"message": "x"})),
    ({"a": 1}, {"a": 1, "b": 2}, "/b", (None, 2)),
    # length differences are reported as such, not as an element diff
    ({"i": [1, 2]}, {"i": [1]}, "/i/len", (2, 1)),
    # identical inputs must not be reported as differing
    ({"v": 1}, {"v": 1}, "", ({"v": 1}, {"v": 1})),
    # FIRST difference wins, so one bug does not report as two
    ({"a": 1, "z": 9}, {"a": 2, "z": 8}, "/a", (1, 2)),
]

NORMS = [
    ("/shape/items[3]/items[11]/v", "/shape/items[i]/items[i]/v"),
    ("1759215600000", "N"),
    ("45930.5729861", "N.N"),
    ("m/d/yyyy", "m/d/yyyy"),          # must NOT be mangled
]


def main():
    bad = 0
    for a, b, wp, wv in CASES:
        p, x, y = first_diff(a, b)
        ok = p == wp and (x, y) == wv
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'}  {wp or '(identical)':28s} -> {p!r} {(x, y)!r}")
    for s, want in NORMS:
        ok = norm(s) == want
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'}  norm {s:32s} -> {norm(s)!r}")
    print(f"\n  {len(CASES) + len(NORMS) - bad}/{len(CASES) + len(NORMS)} passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
