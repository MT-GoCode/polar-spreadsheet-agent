#!/usr/bin/env python3
"""Cluster offline-vs-online divergences by ROOT CAUSE, not by case.

2,510 differing cases were 8 bugs. A flat list of cases hides that; the first differing
PATH inside the recorded shape is what identifies the bug, so group on it."""
import json, re, sys, collections
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]


def first_diff(a, b, p=""):
    if type(a) is not type(b):
        return p, a, b
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return p + "/" + k, a.get(k), b.get(k)
            if a[k] != b[k]:
                return first_diff(a[k], b[k], p + "/" + k)
    elif isinstance(a, list):
        if len(a) != len(b):
            return p + "/len", len(a), len(b)
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                return first_diff(x, y, "%s[%d]" % (p, i))
    return p, a, b


def norm(s):
    """collapse indices and literal numbers so one bug is one row"""
    s = re.sub(r"\[\d+\]", "[i]", s)
    s = re.sub(r"\d+\.\d+", "N.N", s)
    return re.sub(r"\d{3,}", "N", s)


def main(top=30, width=52):
    off = json.loads((ROOT / "out/suite-offline.json").read_text())
    on = json.loads((ROOT / "out/suite-online.json").read_text())
    cl = collections.defaultdict(list)
    for k, v in off.items():
        if k in on and v != on[k]:
            path, a, b = first_diff(v, on[k])
            cl[(norm(path), norm(json.dumps(a)[:width]), norm(json.dumps(b)[:width]))].append(k)
    rows = sorted(cl.items(), key=lambda kv: -len(kv[1]))
    total = sum(len(v) for _, v in rows)
    print(f"  {len(rows)} causes / {total} cases / {len(off)} run\n")
    for (path, a, b), ks in rows[:top]:
        print(f"{len(ks):6d}  {path}")
        print(f"        mog    {a}")
        print(f"        google {b}")
        print(f"        {', '.join(sorted(ks)[:3])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(int(sys.argv[1]) if len(sys.argv) > 1 else 30))
