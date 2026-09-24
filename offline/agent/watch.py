#!/usr/bin/env python3
"""Live transcript. Usage: agent/watch.py [run_dir]  (defaults to the newest run)
Tails events.jsonl and prints turns as they happen. Works on a finished run too."""
import json, sys, time, glob, os
args = [a for a in sys.argv[1:] if not a.startswith("--")]
d = args[0] if args else os.path.dirname(max(glob.glob("runs/*/events.jsonl"), key=os.path.getmtime))
p = os.path.join(d, "events.jsonl")
print(f"== {d}\n")
seen = 0
while True:
    lines = open(p).read().splitlines() if os.path.exists(p) else []
    for line in lines[seen:]:
        try: e = json.loads(line)
        except Exception: continue
        ev, t = e.get("ev"), e.get("n", "")
        if ev == "run.start":
            print(f"START {e['task']} seed {e['seed']}  {e['model']}/{e['effort']}  "
                  f"system {e['system_bytes']}B  first {e['first_bytes']}B\n")
        elif ev == "llm.response":
            u = e.get("usage", {}); det = u.get("input_tokens_details", {})
            print(f"--- turn {t}  {e['ms']/1000:.1f}s  in {u.get('input_tokens',0)} "
                  f"(cached {det.get('cached_tokens',0)})  out {u.get('output_tokens',0)}  "
                  f"{e.get('status')}")
            if e.get("text"): print("  MODEL: " + e["text"][:500])
        elif ev == "tool.call":
            print("  CODE:\n" + "\n".join("    " + l for l in e["code"].splitlines()[:40]))
        elif ev == "tool.result":
            out = (e.get("out") or "").strip()
            print(f"  -> {e['bytes']}B in {e['ms']/1000:.1f}s")
            for l in out.splitlines()[:15]: print("    " + l[:160])
            if len(out.splitlines()) > 15: print(f"    ... +{len(out.splitlines())-15} lines")
            print()
        elif ev in ("llm.retry", "tool.badargs", "tool.enginefail", "llm.fatal", "harness.error"):
            print(f"  !! {ev}: {json.dumps(e)[:300]}\n")
        elif ev == "run.end":
            print(f"\nEND {e['reason']}  {e['turns']} turns  {e['ms']/1000:.0f}s  "
                  f"${e['cost_usd']}  tokens {e['usage']}")
        elif ev == "verdict":
            print(f"VERDICT {'PASS' if e['pass'] else 'FAIL'}")
            for f in e.get("failures", [])[:10]: print("   - " + f)
    seen = len(lines)
    if any(json.loads(l).get("ev") in ("verdict", "harness.error") for l in lines if l.strip().endswith("}")): break
    if "--once" in sys.argv: break
    time.sleep(3)
